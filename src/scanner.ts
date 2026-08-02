import {
  decodeReference,
  type ReferenceContext,
  type ReferenceDecision,
} from './entities.js';
import { MAX_ENTITY_KEY_LENGTH } from './generated/entities.js';
import {
  getTagPolicy,
  type DroppedTag,
  type SelectedAttributes,
  type SemanticTag,
  type TagPolicy,
} from './policy.js';

export interface ScannerHost {
  retainToken(units: number): void;
  releaseToken(units: number): void;
  probeToken(units: number): void;
  pushDepth(): void;
  popDepth(count: number): void;
  text(value: string, mode: 'normal' | 'pre'): void;
  start(tag: SemanticTag, attributes: SelectedAttributes): void;
  end(tag: SemanticTag): void;
  dropped(tag: DroppedTag): void;
}

type ScannerState = 'data' | 'tag-open' | 'end-tag-open' | 'tag' | 'markup-probe' | 'comment' | 'declaration';

interface Frame {
  readonly tag: SemanticTag;
  readonly previousSame: number;
  readonly retainedToken: number;
}

interface ParsedTag {
  readonly end: boolean;
  readonly name: string;
  readonly attributes: SelectedAttributes;
}

interface RawState {
  readonly tag: SemanticTag;
  readonly closing: string;
  readonly preserve: boolean;
  readonly decode: boolean;
  readonly plaintext: boolean;
  candidate: string | null;
}

interface OrdinaryDropState {
  readonly tag: DroppedTag;
  depth: number;
  token: string | null;
  quote: '"' | "'" | null;
}

const COMMENT_PREFIX = '<!--';
const TAG_SPECIAL = /["'>]/g;
const REFERENCE_CACHE_SIZE = 32;

function isAsciiAlpha(character: string): boolean {
  const code = character.charCodeAt(0);
  return (code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A);
}

function isAsciiAlphaNumeric(character: string): boolean {
  const code = character.charCodeAt(0);
  return (
    (code >= 0x30 && code <= 0x39)
    || (code >= 0x41 && code <= 0x5A)
    || (code >= 0x61 && code <= 0x7A)
  );
}

function isReferenceReady(source: string): boolean {
  if (source.length < 2) return false;
  const last = source[source.length - 1] ?? '';
  if (source[1] !== '#') {
    return last === ';'
      || !isAsciiAlphaNumeric(last)
      || source.length - 1 >= MAX_ENTITY_KEY_LENGTH;
  }
  if (source.length === 2) return false;
  const hexadecimal = source[2] === 'x' || source[2] === 'X';
  if (hexadecimal && source.length === 3) return false;
  if (last === ';') return true;
  const code = last.charCodeAt(0);
  return !(
    (code >= 0x30 && code <= 0x39)
    || (hexadecimal && code >= 0x41 && code <= 0x46)
    || (hexadecimal && code >= 0x61 && code <= 0x66)
  );
}

function isHtmlWhitespace(character: string): boolean {
  return character === '\t' || character === '\n' || character === '\f' || character === '\r' || character === ' ';
}

function asciiLower(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    result += code >= 0x41 && code <= 0x5A ? String.fromCharCode(code + 0x20) : value[index];
  }
  return result;
}

function decodeAttribute(value: string): string {
  let result = '';
  let cursor = 0;
  while (cursor < value.length) {
    if (value[cursor] !== '&') {
      result += value[cursor];
      cursor += 1;
      continue;
    }
    const decision = decodeReference(value, cursor, 'attribute', true);
    if (decision.kind === 'match') {
      result += decision.value;
      cursor += decision.consumed;
    } else {
      result += '&';
      cursor += 1;
    }
  }
  return result;
}

function parseTag(token: string): ParsedTag | null {
  const contentEnd = token.length - 1;
  let cursor = 1;
  let end = false;
  if (token[cursor] === '/') {
    end = true;
    cursor += 1;
  }
  const nameStart = cursor;
  while (cursor < contentEnd) {
    const character = token[cursor];
    if (character === undefined || isHtmlWhitespace(character) || character === '/' || character === '>') break;
    cursor += 1;
  }
  if (cursor === nameStart) return null;
  const name = asciiLower(token.slice(nameStart, cursor));
  const attributes: SelectedAttributes = {};
  if (end) return { end, name, attributes };

  while (cursor < contentEnd) {
    while (cursor < contentEnd && isHtmlWhitespace(token[cursor] ?? '')) cursor += 1;
    if (cursor >= contentEnd || token[cursor] === '/') break;
    const attributeStart = cursor;
    while (cursor < contentEnd) {
      const character = token[cursor];
      if (
        character === undefined
        || isHtmlWhitespace(character)
        || character === '='
        || character === '/'
        || character === '>'
      ) break;
      cursor += 1;
    }
    if (cursor === attributeStart) {
      cursor += 1;
      continue;
    }
    const attributeName = asciiLower(token.slice(attributeStart, cursor));
    while (cursor < contentEnd && isHtmlWhitespace(token[cursor] ?? '')) cursor += 1;
    let value = '';
    if (token[cursor] === '=') {
      cursor += 1;
      while (cursor < contentEnd && isHtmlWhitespace(token[cursor] ?? '')) cursor += 1;
      const quote = token[cursor];
      if (quote === '"' || quote === "'") {
        cursor += 1;
        const valueStart = cursor;
        const quoteEnd = token.indexOf(quote, cursor);
        cursor = quoteEnd < 0 || quoteEnd >= contentEnd ? contentEnd : quoteEnd;
        value = token.slice(valueStart, cursor);
        if (token[cursor] === quote) cursor += 1;
      } else {
        const valueStart = cursor;
        while (cursor < contentEnd && !isHtmlWhitespace(token[cursor] ?? '') && token[cursor] !== '>') cursor += 1;
        value = token.slice(valueStart, cursor);
      }
    }
    if (
      (attributeName === 'href' || attributeName === 'alt' || attributeName === 'start' || attributeName === 'value')
      && attributes[attributeName] === undefined
    ) {
      attributes[attributeName] = decodeAttribute(value);
    }
  }
  return { end, name, attributes };
}

export class HtmlScanner {
  private readonly host: ScannerHost;
  private readonly frames: Frame[] = [];
  private readonly topByName: Record<string, number | undefined> = Object.create(null) as Record<string, number | undefined>;
  private readonly referenceCache = new Map<string, ReferenceDecision>();
  private state: ScannerState = 'data';
  private token = '';
  private quote: '"' | "'" | null = null;
  private commentTail = '';
  private referenceBuffer: string | null = null;
  private pendingCarriageReturn = false;
  private preDepth = 0;
  private raw: RawState | null = null;
  private ordinaryDrop: OrdinaryDropState | null = null;
  private specialReference: string | null = null;
  private inHead = false;
  private finished = false;

  constructor(host: ScannerHost) {
    this.host = host;
  }

  write(chunk: string): void {
    if (this.finished) throw new TypeError('HTML scanner is already finished');
    let offset = 0;
    while (offset < chunk.length) {
      if (this.pendingCarriageReturn) {
        this.pendingCarriageReturn = false;
        this.consume('\n');
        if (chunk[offset] === '\n') {
          offset += 1;
          continue;
        }
      }
      if (this.state === 'comment') {
        offset = this.consumeCommentSpan(chunk, offset);
        continue;
      }
      if (this.state === 'declaration') {
        const end = chunk.indexOf('>', offset);
        if (end < 0) return;
        this.state = 'data';
        offset = end + 1;
        continue;
      }
      if (this.raw !== null && !this.raw.preserve && this.raw.candidate === null) {
        offset = this.consumeDroppedRawSpan(chunk, offset);
        continue;
      }
      if (this.ordinaryDrop !== null && this.ordinaryDrop.token === null) {
        const next = chunk.indexOf('<', offset);
        if (next < 0) return;
        offset = next;
      }
      if (
        this.raw === null
        && this.ordinaryDrop === null
        && this.state === 'data'
        && this.referenceBuffer !== null
      ) {
        offset = this.consumeReferenceSpan(chunk, offset);
        continue;
      }
      if (
        this.raw === null
        && this.ordinaryDrop === null
        && this.state === 'data'
        && this.referenceBuffer === null
        && !this.inHead
      ) {
        const next = this.consumeDataSpan(chunk, offset);
        if (next > offset) {
          offset = next;
          continue;
        }
      }
      if (
        this.raw === null
        && this.ordinaryDrop === null
        && this.state === 'tag'
      ) {
        offset = this.consumeTagSpan(chunk, offset);
        continue;
      }
      const codePoint = chunk.codePointAt(offset);
      if (codePoint === undefined) break;
      const inputCharacter = String.fromCodePoint(codePoint);
      offset += inputCharacter.length;
      if (inputCharacter === '\r') {
        this.pendingCarriageReturn = true;
      } else {
        this.consume(inputCharacter === '\u0000' ? '\uFFFD' : inputCharacter);
      }
    }
  }

  finish(): void {
    if (this.finished) throw new TypeError('HTML scanner is already finished');
    this.finished = true;
    if (this.pendingCarriageReturn) {
      this.pendingCarriageReturn = false;
      this.consume('\n');
    }
    this.finishSpecialState();
    if (this.state === 'data') {
      this.resolveReference(true);
    } else if (this.state === 'tag-open' || this.state === 'end-tag-open' || this.state === 'tag') {
      const literal = this.token;
      this.releaseTokenBuffer();
      this.emitText(literal);
    } else if (this.state === 'comment') {
      this.host.releaseToken(this.commentTail.length);
      this.commentTail = '';
    } else if (this.state === 'markup-probe') {
      this.releaseTokenBuffer();
    }
    this.state = 'data';
    this.closeFramesTo(0);
  }

  private consume(character: string): void {
    if (this.raw !== null) {
      this.consumeRaw(character);
      return;
    }
    if (this.ordinaryDrop !== null) {
      this.consumeOrdinaryDrop(character);
      return;
    }
    switch (this.state) {
      case 'data': this.consumeData(character); break;
      case 'tag-open': this.consumeTagOpen(character); break;
      case 'end-tag-open': this.consumeEndTagOpen(character); break;
      case 'tag': this.consumeTag(character); break;
      case 'markup-probe': this.consumeMarkupProbe(character); break;
      case 'comment': this.consumeComment(character); break;
      case 'declaration':
        if (character === '>') this.state = 'data';
        break;
    }
  }

  private consumeData(character: string): void {
    if (this.inHead) {
      if (isHtmlWhitespace(character)) return;
      if (character !== '<') this.exitHead();
    }
    if (this.referenceBuffer !== null) {
      this.retainReference(this.referenceBuffer + character);
      if (isReferenceReady(this.referenceBuffer)) this.resolveReference(false);
      return;
    }
    if (character === '&') {
      this.retainReference('&');
    } else if (character === '<') {
      this.startToken('<', 'tag-open');
    } else {
      this.emitText(character);
    }
  }

  private consumeTagOpen(character: string): void {
    if (character === '!') {
      this.appendToken(character);
      this.state = 'markup-probe';
    } else if (character === '/') {
      this.appendToken(character);
      this.state = 'end-tag-open';
    } else if (isAsciiAlpha(character)) {
      this.appendToken(character);
      this.state = 'tag';
    } else {
      this.releaseTokenBuffer();
      this.state = 'data';
      this.emitText('<');
      this.consumeData(character);
    }
  }

  private consumeEndTagOpen(character: string): void {
    if (isAsciiAlpha(character)) {
      this.appendToken(character);
      this.state = 'tag';
    } else {
      this.releaseTokenBuffer();
      this.state = 'data';
      this.emitText('</');
      this.consumeData(character);
    }
  }

  private consumeTag(character: string): void {
    this.appendToken(character);
    if (this.quote !== null) {
      if (character === this.quote) this.quote = null;
      return;
    }
    if (character === '"' || character === "'") {
      this.quote = character;
    } else if (character === '>') {
      this.emitToken();
    }
  }

  private consumeMarkupProbe(character: string): void {
    this.appendToken(character);
    if (COMMENT_PREFIX.startsWith(this.token)) {
      if (this.token === COMMENT_PREFIX) {
        this.releaseTokenBuffer();
        this.state = 'comment';
      }
      return;
    }
    const ended = character === '>';
    this.releaseTokenBuffer();
    this.state = ended ? 'data' : 'declaration';
  }

  private consumeComment(character: string): void {
    this.host.retainToken(character.length);
    this.commentTail += character;
    if (this.commentTail.endsWith('-->')) {
      this.host.releaseToken(this.commentTail.length);
      this.commentTail = '';
      this.state = 'data';
    } else if (this.commentTail.length > 2) {
      const released = this.commentTail.length - 2;
      this.host.releaseToken(released);
      this.commentTail = this.commentTail.slice(-2);
    }
  }

  private consumeCommentSpan(chunk: string, offset: number): number {
    const prior = this.commentTail;
    const combined = prior + chunk.slice(offset);
    const end = combined.indexOf('-->');
    const peak = Math.min(3, combined.length);
    if (peak > prior.length) this.host.retainToken(peak - prior.length);
    this.host.releaseToken(peak);
    this.commentTail = '';
    if (end < 0) {
      const tail = combined.slice(-2);
      if (tail.length > 0) this.host.retainToken(tail.length);
      this.commentTail = tail;
      return chunk.length;
    }
    this.state = 'data';
    return offset + Math.max(0, end + 3 - prior.length);
  }

  private consumeDataSpan(chunk: string, offset: number): number {
    const maximumBufferedOutput = 65_536;
    let cursor = offset;
    let buffered = '';
    while (cursor < chunk.length) {
      const start = cursor;
      while (cursor < chunk.length) {
        const code = chunk.charCodeAt(cursor);
        if (code === 0 || code === 0x0D || code === 0x26 || code === 0x3C) break;
        cursor += 1;
      }
      if (cursor > start) {
        const value = chunk.slice(start, cursor);
        if (buffered.length > 0 && buffered.length + value.length > maximumBufferedOutput) {
          this.emitText(buffered);
          buffered = '';
        }
        if (value.length >= maximumBufferedOutput) this.emitText(value);
        else buffered += value;
      }
      if (cursor >= chunk.length) break;
      const code = chunk.charCodeAt(cursor);
      if (code !== 0x26) break;
      if (chunk[cursor + 1] === '#') {
        let literalEnd = cursor;
        let maximumExamined = 0;
        while (chunk[literalEnd] === '&' && chunk[literalEnd + 1] === '#') {
          let digitOffset = literalEnd + 2;
          let hexadecimal = false;
          if (chunk[digitOffset] === 'x' || chunk[digitOffset] === 'X') {
            hexadecimal = true;
            digitOffset += 1;
          }
          if (digitOffset >= chunk.length) break;
          const digitCode = chunk.charCodeAt(digitOffset);
          const validDigit = (digitCode >= 0x30 && digitCode <= 0x39)
            || (hexadecimal && digitCode >= 0x41 && digitCode <= 0x46)
            || (hexadecimal && digitCode >= 0x61 && digitCode <= 0x66);
          if (validDigit) break;
          maximumExamined = Math.max(maximumExamined, digitOffset + 1 - literalEnd);
          const trigger = chunk[digitOffset];
          literalEnd = trigger === '&' || trigger === '<' ? digitOffset : digitOffset + 1;
          if (trigger !== '&') break;
        }
        if (literalEnd > cursor) {
          this.host.probeToken(maximumExamined);
          buffered += chunk.slice(cursor, literalEnd);
          cursor = literalEnd;
          continue;
        }
      }
      const decision = this.decodeReference(chunk, cursor, 'data', false);
      if (decision.kind === 'need-more') {
        if (buffered.length > 0) this.emitText(buffered);
        this.retainReference(chunk.slice(cursor));
        return chunk.length;
      }
      this.host.probeToken(decision.examined);
      if (decision.kind === 'match') {
        buffered += decision.value;
        cursor += decision.consumed;
      } else {
        let literalEnd = cursor + decision.examined;
        const trigger = chunk[literalEnd - 1];
        if (trigger === '&' || trigger === '<') literalEnd -= 1;
        buffered += chunk.slice(cursor, literalEnd);
        cursor = literalEnd;
      }
      if (buffered.length >= maximumBufferedOutput) {
        this.emitText(buffered);
        buffered = '';
      }
    }
    if (buffered.length > 0) this.emitText(buffered);
    return cursor;
  }

  private consumeDroppedRawSpan(chunk: string, offset: number): number {
    const raw = this.raw;
    if (raw === null || raw.preserve || raw.candidate !== null) return offset;
    const next = chunk.indexOf('<', offset);
    if (next < 0) return chunk.length;
    const target = raw.closing;
    let matched = 0;
    while (matched < target.length && next + matched < chunk.length) {
      const code = chunk.charCodeAt(next + matched);
      const lower = code >= 0x41 && code <= 0x5A ? code + 0x20 : code;
      if (lower !== target.charCodeAt(matched)) break;
      matched += 1;
    }
    if (matched < target.length && next + matched < chunk.length) {
      const retained = matched + 1;
      this.host.probeToken(retained);
      return next + 1;
    }
    const end = Math.min(chunk.length, next + target.length);
    for (let cursor = next; cursor < end; cursor += 1) this.consumeRaw(chunk[cursor] ?? '');
    return end;
  }

  private consumeReferenceSpan(chunk: string, offset: number): number {
    const source = this.referenceBuffer;
    if (source === null) return offset;
    let end = offset;
    if (source === '&' && chunk[end] === '#') {
      end += 1;
    } else if (source === '&#') {
      end += 1;
    } else {
      const numeric = source[1] === '#';
      const hexadecimal = numeric && (source[2] === 'x' || source[2] === 'X');
      let remaining = numeric ? Number.MAX_SAFE_INTEGER : MAX_ENTITY_KEY_LENGTH - (source.length - 1);
      while (end < chunk.length && remaining > 0) {
        const character = chunk[end] ?? '';
        const code = character.charCodeAt(0);
        const valid = numeric
          ? (code >= 0x30 && code <= 0x39)
            || (hexadecimal && code >= 0x41 && code <= 0x46)
            || (hexadecimal && code >= 0x61 && code <= 0x66)
          : isAsciiAlphaNumeric(character);
        end += 1;
        remaining -= 1;
        if (!valid || character === ';') break;
      }
    }
    if (end === offset) end += 1;
    this.retainReference(source + chunk.slice(offset, end));
    if (isReferenceReady(this.referenceBuffer ?? '')) this.resolveReference(false);
    return end;
  }

  private consumeTagSpan(chunk: string, offset: number): number {
    let cursor = offset;
    while (cursor < chunk.length && this.state === 'tag') {
      if (this.quote !== null) {
        const end = chunk.indexOf(this.quote, cursor);
        if (end < 0) {
          this.appendTokenValue(chunk.slice(cursor));
          return chunk.length;
        }
        this.appendTokenValue(chunk.slice(cursor, end + 1));
        this.quote = null;
        cursor = end + 1;
        continue;
      }
      TAG_SPECIAL.lastIndex = cursor;
      const match = TAG_SPECIAL.exec(chunk);
      const end = match?.index ?? chunk.length;
      if (end > cursor) this.appendTokenValue(chunk.slice(cursor, end));
      if (end >= chunk.length) return end;
      const special = chunk[end] ?? '';
      this.appendTokenValue(special);
      cursor = end + 1;
      if (special === '>') this.emitToken();
      else this.quote = special as '"' | "'";
    }
    return cursor;
  }

  private startToken(value: string, state: ScannerState): void {
    this.host.retainToken(value.length);
    this.token = value;
    this.state = state;
  }

  private appendToken(character: string): void {
    this.host.retainToken(character.length);
    this.token += character;
  }

  private appendTokenValue(value: string): void {
    this.host.retainToken(value.length);
    this.token += value;
  }

  private releaseTokenBuffer(): void {
    this.host.releaseToken(this.token.length);
    this.token = '';
    this.quote = null;
  }

  private retainReference(value: string): void {
    const priorLength = this.referenceBuffer?.length ?? 0;
    this.host.retainToken(value.length - priorLength);
    this.referenceBuffer = value;
  }

  private resolveReference(final: boolean): void {
    const source = this.referenceBuffer;
    if (source === null) return;
    const decision = this.decodeReference(source, 0, 'data', final);
    if (decision.kind === 'need-more') return;
    this.host.releaseToken(source.length);
    this.referenceBuffer = null;
    if (decision.kind === 'match') this.emitText(decision.value);
    else this.emitText('&');
    const remainder = source.slice(decision.consumed);
    this.consumeResolvedRemainder(remainder);
    if (final && this.referenceBuffer !== null) this.resolveReference(true);
  }

  private consumeResolvedRemainder(value: string): void {
    let offset = 0;
    while (offset < value.length) {
      if (this.state !== 'data' || this.referenceBuffer !== null) {
        for (const character of value.slice(offset)) this.consume(character);
        return;
      }
      const ampersand = value.indexOf('&', offset);
      const lessThan = value.indexOf('<', offset);
      let special = value.length;
      if (ampersand >= 0) special = Math.min(special, ampersand);
      if (lessThan >= 0) special = Math.min(special, lessThan);
      if (special > offset) this.emitText(value.slice(offset, special));
      if (special >= value.length) return;
      this.consumeData(value[special] ?? '');
      offset = special + 1;
    }
  }

  private emitToken(): void {
    const parsed = parseTag(this.token);
    this.releaseTokenBuffer();
    this.state = 'data';
    if (parsed !== null) this.emitParsedTag(parsed);
  }

  private emitParsedTag(parsed: ParsedTag): void {
    const policy = getTagPolicy(parsed.name);
    if (this.inHead && this.handleHeadTag(parsed, policy)) return;
    if (policy === null) return;
    if (parsed.end) this.closeTag(policy);
    else this.openTag(policy, parsed.attributes);
  }

  private openTag(policy: TagPolicy, attributes: SelectedAttributes): void {
    if (policy.kind === 'raw-drop') {
      this.host.pushDepth();
      this.host.dropped(policy.name as DroppedTag);
      this.raw = {
        tag: policy.name,
        closing: `</${policy.name}`,
        preserve: false,
        decode: false,
        plaintext: false,
        candidate: null,
      };
      return;
    }
    if (policy.kind === 'ordinary-drop' || policy.kind === 'foreign-drop') {
      this.host.pushDepth();
      this.host.dropped(policy.name as DroppedTag);
      this.ordinaryDrop = {
        tag: policy.name as DroppedTag,
        depth: 1,
        token: null,
        quote: null,
      };
      return;
    }
    if (policy.kind === 'raw-preserve') {
      this.openVisibleTag(policy, attributes);
      this.raw = {
        tag: policy.name,
        closing: `</${policy.name}`,
        preserve: true,
        decode: policy.name === 'textarea',
        plaintext: policy.name === 'plaintext',
        candidate: null,
      };
      return;
    }
    if (policy.kind === 'head') {
      this.openVisibleTag(policy, attributes);
      this.inHead = true;
      return;
    }
    this.openVisibleTag(policy, attributes);
  }

  private openVisibleTag(policy: TagPolicy, attributes: SelectedAttributes): void {
    if (policy.kind === 'void') {
      this.host.start(policy.name, attributes);
      return;
    }
    this.host.pushDepth();
    const retainedToken = policy.name === 'a' ? attributes.href?.length ?? 0 : 0;
    if (retainedToken > 0) this.host.retainToken(retainedToken);
    const previousSame = this.topByName[policy.name] ?? -1;
    this.frames.push({ tag: policy.name, previousSame, retainedToken });
    this.topByName[policy.name] = this.frames.length - 1;
    if (policy.name === 'pre') this.preDepth += 1;
    this.host.start(policy.name, attributes);
  }

  private closeTag(policy: TagPolicy): void {
    if (policy.kind === 'void') return;
    const index = this.topByName[policy.name];
    if (index === undefined) return;
    this.closeFramesTo(index);
  }

  private closeFramesTo(index: number): void {
    const count = this.frames.length - index;
    if (count <= 0) return;
    while (this.frames.length > index) {
      const frame = this.frames.pop();
      if (frame === undefined) break;
      if (frame.previousSame < 0) delete this.topByName[frame.tag];
      else this.topByName[frame.tag] = frame.previousSame;
      this.host.end(frame.tag);
      if (frame.retainedToken > 0) this.host.releaseToken(frame.retainedToken);
      if (frame.tag === 'pre') this.preDepth = Math.max(0, this.preDepth - 1);
    }
    this.host.popDepth(count);
  }

  private emitText(value: string): void {
    this.host.text(value, this.preDepth > 0 ? 'pre' : 'normal');
  }

  private handleHeadTag(parsed: ParsedTag, policy: TagPolicy | null): boolean {
    if (parsed.end && parsed.name === 'head') {
      const head = getTagPolicy('head');
      if (head !== null) this.closeTag(head);
      this.inHead = false;
      return true;
    }
    if (!parsed.end && parsed.name === 'body') {
      this.exitHead();
      if (policy !== null) this.openTag(policy, parsed.attributes);
      return true;
    }
    const metadata = parsed.name === 'html'
      || parsed.name === 'head'
      || parsed.name === 'base'
      || parsed.name === 'link'
      || parsed.name === 'meta'
      || parsed.name === 'title'
      || parsed.name === 'script'
      || parsed.name === 'style'
      || parsed.name === 'noscript'
      || parsed.name === 'noembed';
    if (metadata) {
      if (policy === null) return true;
      if (parsed.end) this.closeTag(policy);
      else if (parsed.name !== 'head') this.openTag(policy, parsed.attributes);
      return true;
    }
    if (parsed.end) return true;
    this.exitHead();
    if (policy !== null) this.openTag(policy, parsed.attributes);
    return true;
  }

  private exitHead(): void {
    if (!this.inHead) return;
    const head = getTagPolicy('head');
    if (head !== null) this.closeTag(head);
    this.inHead = false;
  }

  private consumeRaw(character: string): void {
    const raw = this.raw;
    if (raw === null) return;
    if (raw.plaintext) {
      this.host.text(character, 'pre');
      return;
    }
    if (this.specialReference !== null) {
      this.retainSpecialReference(this.specialReference + character);
      this.resolveSpecialReference(false);
      return;
    }
    if (raw.candidate !== null) {
      this.consumeRawCandidate(character);
      return;
    }
    if (character === '<') {
      this.host.retainToken(1);
      raw.candidate = '<';
    } else if (raw.preserve && raw.decode && character === '&') {
      this.retainSpecialReference('&');
    } else if (raw.preserve) {
      this.host.text(character, 'pre');
    }
  }

  private consumeRawCandidate(character: string): void {
    const raw = this.raw;
    if (raw === null || raw.candidate === null) return;
    this.host.retainToken(character.length);
    raw.candidate += character;
    const lower = asciiLower(raw.candidate);
    const target = raw.closing;
    if (target.startsWith(lower)) return;
    if (lower.startsWith(target)) {
      const suffix = lower.slice(target.length);
      if (suffix === '>') {
        this.closeRawState();
        return;
      }
      const first = suffix[0];
      if (first === '/' || (first !== undefined && isHtmlWhitespace(first))) {
        if (character === '>') this.closeRawState();
        return;
      }
    }
    this.failRawCandidate();
  }

  private failRawCandidate(): void {
    const raw = this.raw;
    if (raw === null || raw.candidate === null) return;
    const value = raw.candidate;
    this.host.releaseToken(value.length);
    raw.candidate = null;
    if (raw.preserve) this.host.text('<', 'pre');
    for (const character of value.slice(1)) this.consume(character);
  }

  private closeRawState(): void {
    const raw = this.raw;
    if (raw === null || raw.candidate === null) return;
    this.host.releaseToken(raw.candidate.length);
    raw.candidate = null;
    this.raw = null;
    if (raw.preserve) {
      const policy = getTagPolicy(raw.tag);
      if (policy !== null) this.closeTag(policy);
    } else {
      this.host.popDepth(1);
    }
  }

  private retainSpecialReference(value: string): void {
    const priorLength = this.specialReference?.length ?? 0;
    this.host.retainToken(value.length - priorLength);
    this.specialReference = value;
  }

  private resolveSpecialReference(final: boolean): void {
    const source = this.specialReference;
    if (source === null) return;
    const decision = this.decodeReference(source, 0, 'data', final);
    if (decision.kind === 'need-more') return;
    this.host.releaseToken(source.length);
    this.specialReference = null;
    if (decision.kind === 'match') this.host.text(decision.value, 'pre');
    else this.host.text('&', 'pre');
    for (const character of source.slice(decision.consumed)) this.consume(character);
    if (final && this.specialReference !== null) this.resolveSpecialReference(true);
  }

  private consumeOrdinaryDrop(character: string): void {
    const drop = this.ordinaryDrop;
    if (drop === null) return;
    if (drop.token === null) {
      if (character === '<') {
        this.host.retainToken(1);
        drop.token = '<';
      }
      return;
    }
    this.host.retainToken(character.length);
    drop.token += character;
    if (drop.quote !== null) {
      if (character === drop.quote) drop.quote = null;
      return;
    }
    if (character === '"' || character === "'") {
      drop.quote = character;
      return;
    }
    if (character !== '>') return;

    const token = drop.token;
    const parsed = parseTag(token);
    this.host.releaseToken(token.length);
    drop.token = null;
    drop.quote = null;
    if (parsed?.name !== drop.tag) return;
    if (parsed.end) {
      drop.depth -= 1;
      this.host.popDepth(1);
      if (drop.depth === 0) this.ordinaryDrop = null;
    } else {
      this.host.pushDepth();
      drop.depth += 1;
    }
  }

  private finishSpecialState(): void {
    if (this.raw !== null) {
      const raw = this.raw;
      if (this.specialReference !== null) this.resolveSpecialReference(true);
      if (raw.candidate !== null) {
        const candidate = raw.candidate;
        this.host.releaseToken(candidate.length);
        raw.candidate = null;
        if (raw.preserve) this.emitRawLiteral(candidate, raw.decode);
      }
      this.raw = null;
      if (!raw.preserve) this.host.popDepth(1);
    }
    if (this.ordinaryDrop !== null) {
      const drop = this.ordinaryDrop;
      if (drop.token !== null) this.host.releaseToken(drop.token.length);
      this.host.popDepth(drop.depth);
      this.ordinaryDrop = null;
    }
  }

  private emitRawLiteral(value: string, decode: boolean): void {
    if (!decode) {
      this.host.text(value, 'pre');
      return;
    }
    let cursor = 0;
    while (cursor < value.length) {
      if (value[cursor] !== '&') {
        this.host.text(value[cursor] ?? '', 'pre');
        cursor += 1;
        continue;
      }
      const decision = this.decodeReference(value, cursor, 'data', true);
      if (decision.kind === 'match') {
        this.host.text(decision.value, 'pre');
        cursor += decision.consumed;
      } else {
        this.host.text('&', 'pre');
        cursor += 1;
      }
    }
  }

  private decodeReference(
    source: string,
    ampersandOffset: number,
    context: ReferenceContext,
    final: boolean,
  ): ReferenceDecision {
    if (source[ampersandOffset + 1] === '#') {
      return decodeReference(source, ampersandOffset, context, final);
    }
    const keyEnd = Math.min(source.length, ampersandOffset + MAX_ENTITY_KEY_LENGTH + 2);
    const key = `${context === 'data' ? 'd' : 'a'}${final ? '1' : '0'}${source.slice(ampersandOffset, keyEnd)}`;
    const cached = this.referenceCache.get(key);
    if (cached !== undefined) return cached;
    const decision = decodeReference(source, ampersandOffset, context, final);
    if (this.referenceCache.size >= REFERENCE_CACHE_SIZE) {
      const oldest = this.referenceCache.keys().next().value;
      if (oldest !== undefined) this.referenceCache.delete(oldest);
    }
    this.referenceCache.set(key, decision);
    return decision;
  }
}
