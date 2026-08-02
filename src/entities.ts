import {
  ENTITY_MAP,
  LEGACY_ENTITY_PREFIX_MAP,
  MAX_ENTITY_KEY_LENGTH,
} from './generated/entities.js';

export type ReferenceContext = 'data' | 'attribute';

export type ReferenceDecision =
  | { readonly kind: 'match'; readonly consumed: number; readonly examined: number; readonly value: string }
  | { readonly kind: 'literal'; readonly consumed: 1; readonly examined: number; readonly value: '&' }
  | { readonly kind: 'need-more' };

const C1_REPLACEMENTS: Readonly<Record<number, number>> = Object.freeze({
  0x80: 0x20AC,
  0x82: 0x201A,
  0x83: 0x0192,
  0x84: 0x201E,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02C6,
  0x89: 0x2030,
  0x8A: 0x0160,
  0x8B: 0x2039,
  0x8C: 0x0152,
  0x8E: 0x017D,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201C,
  0x94: 0x201D,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02DC,
  0x99: 0x2122,
  0x9A: 0x0161,
  0x9B: 0x203A,
  0x9C: 0x0153,
  0x9E: 0x017E,
  0x9F: 0x0178,
});
const LITERAL_REFERENCES: Array<ReferenceDecision | undefined> = [];
const NEED_MORE_REFERENCE: ReferenceDecision = Object.freeze({ kind: 'need-more' });

function isAsciiAlphaNumericOrEquals(character: string): boolean {
  if (character === '=') return true;
  const code = character.charCodeAt(0);
  return (
    (code >= 0x30 && code <= 0x39)
    || (code >= 0x41 && code <= 0x5A)
    || (code >= 0x61 && code <= 0x7A)
  );
}

function isAsciiAlphaNumeric(character: string): boolean {
  const code = character.charCodeAt(0);
  return (
    (code >= 0x30 && code <= 0x39)
    || (code >= 0x41 && code <= 0x5A)
    || (code >= 0x61 && code <= 0x7A)
  );
}

function numericValue(value: number): string {
  if (value === 0 || value > 0x10FFFF || (value >= 0xD800 && value <= 0xDFFF)) {
    return '\uFFFD';
  }
  return String.fromCodePoint(C1_REPLACEMENTS[value] ?? value);
}

function decodeNumeric(
  source: string,
  ampersandOffset: number,
  final: boolean,
): ReferenceDecision {
  let cursor = ampersandOffset + 2;
  let radix = 10;
  if (cursor === source.length) return final ? literal(cursor - ampersandOffset) : NEED_MORE_REFERENCE;
  const prefix = source[cursor];
  if (prefix === 'x' || prefix === 'X') {
    radix = 16;
    cursor += 1;
    if (cursor === source.length) return final ? literal(cursor - ampersandOffset) : NEED_MORE_REFERENCE;
  }

  const firstDigit = cursor;
  let value = 0;
  while (cursor < source.length) {
    const code = source.charCodeAt(cursor);
    let digit = -1;
    if (code >= 0x30 && code <= 0x39) digit = code - 0x30;
    else if (radix === 16 && code >= 0x41 && code <= 0x46) digit = code - 0x41 + 10;
    else if (radix === 16 && code >= 0x61 && code <= 0x66) digit = code - 0x61 + 10;
    if (digit < 0) break;
    if (value <= 0x110000) value = value * radix + digit;
    cursor += 1;
  }
  if (cursor === firstDigit) return literal(Math.min(source.length, cursor + 1) - ampersandOffset);
  if (cursor === source.length && !final) return NEED_MORE_REFERENCE;
  const examined = Math.min(source.length, cursor + 1) - ampersandOffset;
  if (source[cursor] === ';') cursor += 1;
  return {
    kind: 'match',
    consumed: cursor - ampersandOffset,
    examined,
    value: numericValue(value),
  };
}

function literal(examined = 1): ReferenceDecision {
  if (examined <= MAX_ENTITY_KEY_LENGTH + 2) {
    const cached = LITERAL_REFERENCES[examined];
    if (cached !== undefined) return cached;
    const decision: ReferenceDecision = Object.freeze({
      kind: 'literal',
      consumed: 1,
      examined,
      value: '&',
    });
    LITERAL_REFERENCES[examined] = decision;
    return decision;
  }
  return { kind: 'literal', consumed: 1, examined, value: '&' };
}

export function decodeReference(
  source: string,
  ampersandOffset: number,
  context: ReferenceContext,
  final: boolean,
): ReferenceDecision {
  if (source[ampersandOffset] !== '&') return literal();
  let cursor = ampersandOffset + 1;
  if (cursor === source.length) return final ? literal(cursor - ampersandOffset) : NEED_MORE_REFERENCE;
  if (source[cursor] === '#') return decodeNumeric(source, ampersandOffset, final);

  let terminalValue: string | null = null;
  let terminalCursor = -1;
  let walked = 0;
  let endedBySemicolon = false;
  const nameStart = cursor;
  while (cursor < source.length && walked < MAX_ENTITY_KEY_LENGTH) {
    const character = source[cursor];
    if (character === undefined || (!isAsciiAlphaNumeric(character) && character !== ';')) break;
    cursor += 1;
    walked += 1;
    if (character === ';') {
      endedBySemicolon = true;
      break;
    }
  }

  if (endedBySemicolon) {
    const value = ENTITY_MAP[source.slice(nameStart, cursor)];
    if (value !== undefined) {
      terminalValue = value;
      terminalCursor = cursor;
    }
  }
  if (terminalValue === null) {
    let legacyCandidate = '';
    for (let index = nameStart; index < cursor; index += 1) {
      const character = source[index];
      if (character === undefined || character === ';') break;
      legacyCandidate += character;
      const value = LEGACY_ENTITY_PREFIX_MAP[legacyCandidate];
      if (value === undefined) break;
      if (value !== null) {
        terminalValue = value;
        terminalCursor = index + 1;
      }
    }
  }

  if (cursor === source.length && !final && !endedBySemicolon && walked < MAX_ENTITY_KEY_LENGTH) {
    return NEED_MORE_REFERENCE;
  }
  const examined = cursor < source.length && !endedBySemicolon && walked < MAX_ENTITY_KEY_LENGTH
    ? cursor + 1 - ampersandOffset
    : cursor - ampersandOffset;
  if (terminalValue === null || terminalCursor < 0) return literal(examined);

  const hasSemicolon = source[terminalCursor - 1] === ';';
  if (!hasSemicolon && context === 'attribute') {
    if (terminalCursor === source.length && !final) return NEED_MORE_REFERENCE;
    const following = source[terminalCursor];
    if (following !== undefined && isAsciiAlphaNumericOrEquals(following)) return literal(examined);
  }
  return {
    kind: 'match',
    consumed: terminalCursor - ampersandOffset,
    examined,
    value: terminalValue,
  };
}
