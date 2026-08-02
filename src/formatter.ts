import { displayUrl, type ValidatedConfig } from './config.js';
import { createsBlockBoundary, getTagPolicy, type SelectedAttributes, type SemanticTag } from './policy.js';

interface ListFrame {
  readonly kind: 'ordered' | 'unordered' | 'description';
  next: number;
  readonly indent: number;
}

interface TableFrame {
  cells: number;
}

interface FormatFrame {
  readonly tag: SemanticTag;
  readonly serial: number;
  readonly pendingWhitespace: boolean;
  readonly pendingBreaks: number;
  readonly pendingTab: boolean;
  readonly pendingListPrefix: string | null;
  readonly suppressed: boolean;
  readonly linkHref: string | null;
}

export function isHtmlWhitespace(value: string): boolean {
  return value === '\t' || value === '\n' || value === '\f' || value === '\r' || value === ' ';
}

export function splitOutputChunk(value: string, maximum: number): [string, string] {
  let end = Math.min(maximum, value.length);
  if (
    end > 0
    && end < value.length
    && value.charCodeAt(end - 1) >= 0xD800
    && value.charCodeAt(end - 1) <= 0xDBFF
  ) {
    end -= 1;
  }
  return [value.slice(0, end), value.slice(end)];
}

function nonNegativeSafeInteger(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

export class ReaderFormatter {
  private readonly config: ValidatedConfig;
  private readonly writeOutput: (value: string, splittable: boolean) => void;
  private readonly frames: FormatFrame[] = [];
  private readonly lists: ListFrame[] = [];
  private readonly tables: TableFrame[] = [];
  private readonly preInitialLineFeeds: boolean[] = [];
  private pendingWhitespace = false;
  private pendingBreaks = 0;
  private pendingTab = false;
  private pendingListPrefix: string | null = null;
  private quoteDepth = 0;
  private suppressedLinkDepth = 0;
  private hasOutput = false;
  private atLineStart = true;
  private trailingNewlines = 0;
  private serial = 0;

  constructor(config: ValidatedConfig, writeOutput: (value: string, splittable: boolean) => void) {
    this.config = config;
    this.writeOutput = writeOutput;
  }

  text(value: string, mode: 'normal' | 'pre'): void {
    if (this.suppressedLinkDepth > 0) return;
    if (mode === 'pre' && this.config.layout === 'readable') {
      for (const character of value) {
        const initialIndex = this.preInitialLineFeeds.length - 1;
        if (initialIndex >= 0 && this.preInitialLineFeeds[initialIndex]) {
          this.preInitialLineFeeds[initialIndex] = false;
          if (character === '\n') continue;
        }
        this.emitPre(character);
      }
      return;
    }

    let cursor = 0;
    while (cursor < value.length) {
      if (isHtmlWhitespace(value[cursor] ?? '')) {
        if (this.hasOutput) this.pendingWhitespace = true;
        cursor += 1;
        continue;
      }
      const start = cursor;
      while (cursor < value.length && !isHtmlWhitespace(value[cursor] ?? '')) cursor += 1;
      this.emitNormal(value.slice(start, cursor));
    }
  }

  start(tag: SemanticTag, attributes: SelectedAttributes): void {
    const policy = getTagPolicy(tag);
    const startsSuppression = tag === 'a' && this.config.links === 'drop';
    const suppressed = this.suppressedLinkDepth > 0 || startsSuppression;
    if (policy?.kind !== 'void') {
      this.frames.push({
        tag,
        serial: this.serial,
        pendingWhitespace: this.pendingWhitespace,
        pendingBreaks: this.pendingBreaks,
        pendingTab: this.pendingTab,
        pendingListPrefix: this.pendingListPrefix,
        suppressed,
        linkHref: tag === 'a' && this.config.links === 'label-and-url'
          ? attributes.href ?? null
          : null,
      });
    }
    if (startsSuppression) this.suppressedLinkDepth += 1;
    if (suppressed) return;

    if (tag === 'img') {
      this.image(attributes.alt);
      return;
    }

    if (tag === 'br') {
      this.boundary(1);
    } else if (tag === 'hr') {
      this.boundary(2);
    } else if (tag === 'blockquote') {
      this.boundary(2);
      this.quoteDepth += 1;
    } else if (tag === 'ol' || tag === 'ul' || tag === 'menu' || tag === 'dl') {
      this.boundary(this.lists.length > 0 ? 1 : 2);
      const start = nonNegativeSafeInteger(attributes.start);
      this.lists.push({
        kind: tag === 'ol' ? 'ordered' : tag === 'dl' ? 'description' : 'unordered',
        next: start ?? 1,
        indent: this.lists.length,
      });
    } else if (tag === 'li') {
      this.boundary(1);
      this.pendingListPrefix = this.listPrefix(attributes.value);
    } else if (tag === 'dt' || tag === 'dd') {
      this.boundary(1);
    } else if (tag === 'table') {
      this.boundary(2);
      this.tables.push({ cells: 0 });
    } else if (tag === 'tr') {
      this.boundary(1);
      const table = this.tables[this.tables.length - 1];
      if (table !== undefined) table.cells = 0;
    } else if (tag === 'td' || tag === 'th') {
      const table = this.tables[this.tables.length - 1];
      if (table !== undefined) {
        if (table.cells > 0) this.pendingTab = true;
        table.cells += 1;
      }
    } else if (tag === 'pre') {
      this.boundary(2);
      this.preInitialLineFeeds.push(true);
    } else if (createsBlockBoundary(tag) && getTagPolicy(tag)?.kind !== 'table') {
      this.boundary(2);
    }
  }

  end(tag: SemanticTag): void {
    const frame = this.frames.pop();
    if (frame?.suppressed) {
      if (tag === 'a' && this.config.links === 'drop') {
        this.suppressedLinkDepth = Math.max(0, this.suppressedLinkDepth - 1);
      }
      this.pendingWhitespace = frame.pendingWhitespace;
      this.pendingBreaks = frame.pendingBreaks;
      this.pendingTab = frame.pendingTab;
      this.pendingListPrefix = frame.pendingListPrefix;
      return;
    }
    if (tag === 'blockquote') {
      this.quoteDepth = Math.max(0, this.quoteDepth - 1);
    } else if (tag === 'ol' || tag === 'ul' || tag === 'menu' || tag === 'dl') {
      this.lists.pop();
    } else if (tag === 'li') {
      this.pendingListPrefix = null;
    } else if (tag === 'table') {
      this.tables.pop();
    } else if (tag === 'pre') {
      this.preInitialLineFeeds.pop();
    }

    if (tag === 'a' && frame?.linkHref !== null && frame?.linkHref !== undefined) {
      const url = displayUrl(frame.linkHref, this.config.baseUrl);
      if (url !== null) this.appendUrl(url);
    }

    if (frame !== undefined && frame.tag === tag && frame.serial === this.serial) {
      this.pendingWhitespace = frame.pendingWhitespace;
      this.pendingBreaks = frame.pendingBreaks;
      this.pendingTab = frame.pendingTab;
      this.pendingListPrefix = frame.pendingListPrefix;
      return;
    }

    if (tag === 'li' || tag === 'dt' || tag === 'dd' || tag === 'tr') {
      this.boundary(1);
    } else if (tag === 'td' || tag === 'th' || tag === 'caption' || tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
      return;
    } else if (createsBlockBoundary(tag)) {
      this.boundary(2);
    }
  }

  finish(): void {
    this.pendingWhitespace = false;
    this.pendingBreaks = 0;
    this.pendingTab = false;
    this.pendingListPrefix = null;
  }

  private listPrefix(valueAttribute: string | undefined): string | null {
    const list = this.lists[this.lists.length - 1];
    if (list === undefined || list.kind === 'description') return null;
    const indentation = '  '.repeat(list.indent);
    if (list.kind === 'unordered') return `${indentation}- `;
    const explicitValue = nonNegativeSafeInteger(valueAttribute);
    if (explicitValue !== null) list.next = explicitValue;
    const current = list.next;
    if (list.next < Number.MAX_SAFE_INTEGER) list.next += 1;
    return `${indentation}${current}. `;
  }

  private image(alt: string | undefined): void {
    if (this.hasOutput) this.pendingWhitespace = true;
    if (this.config.images === 'alt' && alt !== undefined && /[^\t\n\f\r ]/.test(alt)) {
      this.text(alt, 'normal');
    }
    if (this.hasOutput) this.pendingWhitespace = true;
  }

  private appendUrl(url: string): void {
    if (this.hasOutput) this.pendingWhitespace = true;
    for (const character of `[${url}]`) this.emitNormal(character);
  }

  private boundary(lines: number): void {
    if (!this.hasOutput) return;
    this.pendingTab = false;
    if (this.config.layout === 'compact') {
      this.pendingWhitespace = true;
      return;
    }
    this.pendingWhitespace = false;
    this.pendingBreaks = Math.max(this.pendingBreaks, lines);
  }

  private takeSeparator(): string {
    if (!this.hasOutput) return '';
    let separator = '';
    if (this.config.layout === 'compact') {
      if (this.pendingWhitespace || this.pendingBreaks > 0 || this.pendingTab) separator = ' ';
    } else if (this.pendingTab) {
      separator = '\t';
    } else if (this.pendingBreaks > 0) {
      separator = '\n'.repeat(Math.max(0, this.pendingBreaks - this.trailingNewlines));
    } else if (this.pendingWhitespace) {
      separator = ' ';
    }
    this.pendingWhitespace = false;
    this.pendingBreaks = 0;
    this.pendingTab = false;
    return separator;
  }

  private takePrefixes(lineStart: boolean): string {
    let prefixes = '';
    if (this.config.layout === 'readable' && lineStart && this.quoteDepth > 0) {
      prefixes += '> '.repeat(this.quoteDepth);
    }
    if (this.pendingListPrefix !== null) {
      prefixes += this.config.layout === 'compact'
        ? this.pendingListPrefix.replace(/^ +/, '')
        : this.pendingListPrefix;
      this.pendingListPrefix = null;
    }
    return prefixes;
  }

  private emitNormal(character: string): void {
    const separator = this.takeSeparator();
    const lineStart = !this.hasOutput || this.atLineStart || separator.includes('\n');
    const firstWidth = (character.codePointAt(0) ?? 0) > 0xFFFF ? 2 : 1;
    this.write(separator + this.takePrefixes(lineStart) + character.slice(0, firstWidth));
    if (character.length > firstWidth) this.write(character.slice(firstWidth), true);
  }

  private emitPre(character: string): void {
    const separator = this.takeSeparator();
    const lineStart = !this.hasOutput || this.atLineStart || separator.includes('\n');
    const prefixes = character === '\n' ? '' : this.takePrefixes(lineStart);
    this.write(separator + prefixes + character);
  }

  private write(value: string, splittable = false): void {
    if (value.length === 0) return;
    this.writeOutput(value, splittable);
    this.serial += 1;
    this.hasOutput = true;
    this.atLineStart = value.endsWith('\n');
    let newlines = 0;
    for (let index = value.length - 1; index >= 0 && value[index] === '\n'; index -= 1) newlines += 1;
    this.trailingNewlines = newlines;
  }
}
