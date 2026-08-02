/**
 * PURIFAI - bounded strip-to-text sanitizer and contextual encoders.
 *
 * `sanitize()` removes markup; it does not preserve safe HTML. Use `escape()`,
 * `escapeAttribute()`, or `escapeUrl()` when the destination context is known.
 *
 * @version 2.0.3
 * @license MIT
 */

const NULL_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;
const HAS_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/;
const ENCODED_SYNTAX = /%3[ce]|\\u[0-9a-f]{4}|\\x[0-9a-f]{2}|&#(?:\d+|x[0-9a-f]+);/i;
const DANGEROUS_CONTAINER_PATTERN = /<\s*\/?\s*(?:script|style|iframe|object|applet|svg|math|form|template|noscript|noframes|xmp|plaintext|head|title|textarea|frameset)\b/i;
const EVENT_HANDLER_PATTERN = /\bo\s*n\s*(?:abort|afterprint|animationend|animationiteration|animationstart|beforeinput|beforeprint|beforeunload|begin|blur|canplay|change|click|close|contextmenu|copy|cut|dblclick|drag|drop|durationchange|ended|error|focus|focusin|focusout|hashchange|input|invalid|keydown|keypress|keyup|load|loadeddata|loadedmetadata|loadstart|message|mousedown|mouseenter|mouseleave|mousemove|mouseout|mouseover|mouseup|offline|online|open|pagehide|pageshow|paste|pause|play|playing|popstate|progress|ratechange|reset|resize|scroll|search|seeked|seeking|select|show|stalled|start|storage|submit|suspend|timeupdate|toggle|touchcancel|touchend|touchmove|touchstart|transitionend|unload|volumechange|waiting|wheel)\s*=/i;
const DANGEROUS_PROTOCOL_PATTERN = /(?:j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t|v\s*b\s*s\s*c\s*r\s*i\s*p\s*t|l\s*i\s*v\s*e\s*s\s*c\s*r\s*i\s*p\s*t|m\s*o\s*c\s*h\s*a)\s*:|data\s*:\s*(?:text\/html|image\/svg\+xml)/i;
const DANGEROUS_CODE_PATTERN = /(?:\b(?:eval|expression|Function|constructor|document\.write|insertAdjacentHTML)\s*\(|@import\b|\{\{|<%|<\?|\${|#\{)/i;

const DROP_BODY_TAGS = new Set([
  'applet', 'form', 'frameset', 'head', 'iframe', 'math', 'noframes',
  'noscript', 'object', 'plaintext', 'script', 'style', 'svg', 'template',
  'textarea', 'title', 'xmp',
]);

const SAFE_URL_PROTOCOLS = new Set(['http', 'https', 'mailto']);

/**
 * Escape markup delimiters left in otherwise-benign text.
 *
 * Only `<` and `>` are escaped. `&` is deliberately left alone: escaping it
 * would rewrite legitimate content such as `?a=1&b=2`, and with every tag
 * already removed there is no attribute context for an entity to break out of.
 */
function escapeAngleBrackets(str: string): string {
  return str.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Purifai Configuration Options
 */
export interface PurifaiOptions {
  /** Maximum input length (default: 1MB) */
  maxLength?: number;
  /** Subset of the built-in safe URL protocols (default: http, https, mailto) */
  allowedProtocols?: string[];
  /** @deprecated Retained for source compatibility; strip-to-text is always used. */
  aggressiveMode?: boolean;
}

/**
 * Purifai Sanitization Result
 */
export interface PurifaiResult {
  /** Sanitized content */
  content: string;
  /** Advisory: whether a known dangerous pattern was detected */
  hadThreats: boolean;
  /** Processing time in milliseconds */
  processingTime: number;
  /** Threat level: 'none' | 'low' | 'medium' | 'high' | 'critical' */
  threatLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Defaults live at module scope, not as a class member.
 *
 * They used to be `private static defaultOptions` read through `this`, which
 * broke every detached use of the API (`import { sanitize }`): in ESM `this` is
 * undefined and the call threw, while in CJS `this` became the module exports
 * object and sanitization silently ran with NO defaults.
 */
const DEFAULT_OPTIONS: Required<PurifaiOptions> = {
  maxLength: 1000000, // 1MB
  allowedProtocols: ['http', 'https', 'mailto'],
  aggressiveMode: true
};

const VERSION = '2.0.3';

function isDisallowedScalar(codePoint: number): boolean {
  return !Number.isInteger(codePoint) ||
    codePoint <= 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
    (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) ||
    (codePoint >= 0x7f && codePoint <= 0x9f);
}

function scalarFromDigits(digits: string, radix: number): string {
  const codePoint = Number.parseInt(digits, radix);
  return isDisallowedScalar(codePoint) ? '\ufffd' : String.fromCodePoint(codePoint);
}

/** Decode only syntax-relevant encodings, leaving prose such as `100%20off`. */
function decodeEncodingBypasses(str: string): string {
  return str
    .replace(/%3c/gi, '<')
    .replace(/%3e/gi, '>')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => scalarFromDigits(hex, 16))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) => scalarFromDigits(hex, 16))
    .replace(/&#(\d+);/g, (_, digits: string) => scalarFromDigits(digits, 10))
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, digits: string) => scalarFromDigits(digits, 16));
}

function isAsciiLetter(char: string | undefined): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
}

function isTagNameChar(char: string | undefined): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return isAsciiLetter(char) ||
    (code >= 48 && code <= 57) ||
    char === ':' ||
    char === '-';
}

interface ParsedTag {
  closing: boolean;
  end: number;
  name: string;
  selfClosing: boolean;
}

const INCOMPLETE_TAG = Symbol('incomplete-tag');

/** Parse one complete HTML-like tag. An incomplete candidate is treated as text. */
function parseTag(input: string, start: number): ParsedTag | typeof INCOMPLETE_TAG | null {
  if (input[start] !== '<') return null;

  let cursor = start + 1;
  let closing = false;
  if (input[cursor] === '/') {
    closing = true;
    cursor++;
    while (isAsciiWhitespace(input[cursor])) cursor++;
  }

  if (!isAsciiLetter(input[cursor])) return null;
  const nameStart = cursor;
  while (isTagNameChar(input[cursor])) cursor++;
  const name = input.slice(nameStart, cursor).toLowerCase();

  const boundary = input[cursor];
  if (boundary === undefined) return INCOMPLETE_TAG;
  if (boundary !== '>' && boundary !== '/' && !isAsciiWhitespace(boundary)) return null;

  // Preserve code-like comparisons such as `a<b && c>d`: `&` cannot start a
  // normal attribute in the contract this scanner recognizes.
  if (isAsciiWhitespace(boundary)) {
    let next = cursor;
    while (isAsciiWhitespace(input[next])) next++;
    if (input[next] === '&') return null;
  }

  let quote = '';
  let selfClosing = false;
  for (; cursor < input.length; cursor++) {
    const char = input[cursor];
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') {
      let before = cursor - 1;
      while (before > start && isAsciiWhitespace(input[before])) before--;
      selfClosing = input[before] === '/';
      return { closing, end: cursor + 1, name, selfClosing };
    }
  }

  return INCOMPLETE_TAG;
}

function skipCommentOrDeclaration(input: string, start: number): number | null {
  if (input.startsWith('<!--', start)) {
    const end = input.indexOf('-->', start + 4);
    return end === -1 ? input.length : end + 3;
  }
  if (input.startsWith('<!', start) || input.startsWith('<?', start)) {
    const end = input.indexOf('>', start + 2);
    return end === -1 ? input.length : end + 1;
  }
  return null;
}

/**
 * Skip a scriptable/raw-text container without rescanning its prefix. Nested
 * same-name tags are counted so malformed input fails closed.
 */
function skipContainerBody(input: string, cursor: number, containerName: string): number {
  let depth = 1;
  while (cursor < input.length) {
    const nextOpen = input.indexOf('<', cursor);
    if (nextOpen === -1) return input.length;

    const specialEnd = skipCommentOrDeclaration(input, nextOpen);
    if (specialEnd !== null) {
      cursor = specialEnd;
      continue;
    }

    const tag = parseTag(input, nextOpen);
    if (tag === INCOMPLETE_TAG) return input.length;
    if (!tag) {
      cursor = nextOpen + 1;
      continue;
    }
    cursor = tag.end;
    if (tag.name !== containerName) continue;
    if (tag.closing) {
      depth--;
      if (depth === 0) return cursor;
    } else if (!tag.selfClosing) {
      depth++;
    }
  }
  return input.length;
}

/**
 * Strip markup in one forward pass. Each source position is consumed once;
 * incomplete tag-like text terminates scanning as escaped prose instead of
 * triggering repeated end-of-string searches.
 */
function stripToText(input: string): string {
  const output: string[] = [];
  let textStart = 0;
  let cursor = 0;

  while (cursor < input.length) {
    const nextOpen = input.indexOf('<', cursor);
    if (nextOpen === -1) break;

    const specialEnd = skipCommentOrDeclaration(input, nextOpen);
    if (specialEnd !== null) {
      output.push(input.slice(textStart, nextOpen));
      cursor = specialEnd;
      textStart = cursor;
      continue;
    }

    const tag = parseTag(input, nextOpen);
    if (tag === INCOMPLETE_TAG) {
      output.push(input.slice(textStart));
      textStart = input.length;
      cursor = input.length;
      break;
    }
    if (!tag) {
      cursor = nextOpen + 1;
      continue;
    }

    output.push(input.slice(textStart, nextOpen));
    cursor = tag.end;
    if (!tag.closing && !tag.selfClosing && DROP_BODY_TAGS.has(tag.name)) {
      cursor = skipContainerBody(input, cursor, tag.name);
    }
    textStart = cursor;
  }

  if (textStart < input.length) output.push(input.slice(textStart));
  const text = output.join('').replace(/\s+/g, ' ').trim();
  return text.includes('<') || text.includes('>') ? escapeAngleBrackets(text) : text;
}

function coerceInput(input: unknown): string {
  if (input === null || input === undefined) return '';
  try {
    if (typeof input === 'string') return input;
    if (typeof input === 'object') {
      const serialized = JSON.stringify(input);
      return typeof serialized === 'string' ? serialized : '';
    }
    return String(input);
  } catch {
    return '';
  }
}

function resolveMaxLength(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : DEFAULT_OPTIONS.maxLength;
}

/**
 * Assess threat level of input content
 */
function assessThreatLevel(input: string): 'none' | 'low' | 'medium' | 'high' | 'critical' {
  if (!input) return 'none';

  if (/<\s*\/?\s*script\b/i.test(input) || DANGEROUS_PROTOCOL_PATTERN.test(input) || EVENT_HANDLER_PATTERN.test(input)) {
    return 'critical';
  }
  if (DANGEROUS_CONTAINER_PATTERN.test(input) || /\beval\s*\(/i.test(input)) {
    return 'high';
  }
  if (DANGEROUS_CODE_PATTERN.test(input) || /<\s*(?:link|meta|base)\b/i.test(input)) {
    return 'medium';
  }
  return 'none';
}

/**
 * Check if input contains dangerous patterns
 */
function isDangerous(input: string): boolean {
  if (!input) return false;
  return DANGEROUS_CONTAINER_PATTERN.test(input) ||
    EVENT_HANDLER_PATTERN.test(input) ||
    DANGEROUS_PROTOCOL_PATTERN.test(input) ||
    DANGEROUS_CODE_PATTERN.test(input);
}

/**
 * Convert HTML-like input to inert plain text using a bounded forward scanner.
 */
function sanitize(input: unknown, options?: PurifaiOptions): string {
  const config = { ...DEFAULT_OPTIONS, ...options };
  let str = coerceInput(input);
  const maxLength = resolveMaxLength(config.maxLength);
  if (str.length > maxLength) str = str.slice(0, maxLength);

  if (!str) return '';

  // Most calls are already plain text. Avoid six decoding passes and the tag
  // scanner when no raw/encoded delimiter or control character is present.
  if (!str.includes('<') && !str.includes('>') &&
      !HAS_CONTROL_CHARS.test(str) && !ENCODED_SYNTAX.test(str)) {
    return str.replace(/\s+/g, ' ').trim();
  }

  try {
    const decoded = decodeEncodingBypasses(str.replace(NULL_CONTROL_CHARS, ''))
      .replace(NULL_CONTROL_CHARS, '');
    return stripToText(decoded);
  } catch {
    return escapeAngleBrackets(str.replace(NULL_CONTROL_CHARS, ''))
      .replace(/\s+/g, ' ')
      .trim();
  }
}

/**
 * Sanitize input and return detailed analysis
 */
function analyze(input: unknown, options?: PurifaiOptions): PurifaiResult {
  const startTime = performance.now();
  const config = { ...DEFAULT_OPTIONS, ...options };
  const originalStr = coerceInput(input).slice(0, resolveMaxLength(config.maxLength));

  const sanitized = sanitize(originalStr, options);
  const processingTime = performance.now() - startTime;
  const decodedForAnalysis = decodeEncodingBypasses(originalStr.replace(NULL_CONTROL_CHARS, ''));
  const threatLevel = assessThreatLevel(decodedForAnalysis);
  const hadThreats = isDangerous(originalStr) || isDangerous(decodedForAnalysis);

  return {
    content: sanitized,
    hadThreats,
    processingTime,
    threatLevel
  };
}

/**
 * Batch sanitize multiple inputs for optimal performance
 */
function sanitizeBatch(inputs: unknown[], options?: PurifaiOptions): string[] {
  return inputs.map(input => {
    try {
      return sanitize(input, options);
    } catch {
      return '';
    }
  });
}

/**
 * Escape text for insertion into an HTML body context.
 *
 * Lossless apart from control characters: this is the correct choice when the
 * input is plain text rather than markup and exact text fidelity matters.
 */
function escape(input: unknown): string {
  if (input === null || input === undefined) return '';
  const str = typeof input === 'string' ? input : String(input);
  return str
    // Control characters are dropped or replaced by the HTML parser anyway, and
    // they are a standard bypass trick (`<scri\x00pt>`). Removing them here
    // keeps escape() faithful: what it returns is what the parser will show.
    .replace(NULL_CONTROL_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape text for insertion into an HTML attribute value.
 *
 * Stricter than `escape()`: every character outside `[a-zA-Z0-9]` is
 * hex-encoded, which stays safe even in an unquoted attribute — the case that
 * breaks naive escaping, since a bare space or backtick can end the value and
 * start a new attribute such as `onerror=`.
 */
function escapeAttribute(input: unknown): string {
  if (input === null || input === undefined) return '';
  const str = (typeof input === 'string' ? input : String(input)).replace(NULL_CONTROL_CHARS, '');
  let out = '';
  for (const char of str) {
    const code = char.codePointAt(0)!;
    if (/[a-zA-Z0-9]/.test(char)) {
      out += char;
    } else if (code < 256) {
      out += `&#x${code.toString(16).padStart(2, '0')};`;
    } else {
      out += `&#x${code.toString(16)};`;
    }
  }
  return out;
}

/**
 * Escape and validate a value used as a URL.
 *
 * Returns '' when the protocol is not in the caller-selected subset of the
 * built-in safe protocols. Script-bearing schemes and protocol-relative URLs
 * cannot be enabled through options.
 */
function escapeUrl(input: unknown, options?: PurifaiOptions): string {
  if (input === null || input === undefined) return '';
  const config = { ...DEFAULT_OPTIONS, ...options };
  const str = (typeof input === 'string' ? input : String(input)).trim();
  if (!str) return '';

  // Strip control characters and whitespace an attacker can use to break up a
  // protocol token ("java\tscript:").
  const normalized = str.replace(/[\x00-\x20\x7F-\x9F]/g, '');
  if (normalized.startsWith('//') || normalized.startsWith('\\\\')) return '';

  const configuredProtocols = Array.isArray(config.allowedProtocols)
    ? config.allowedProtocols
    : [];
  const requestedProtocols = new Set(
    configuredProtocols
      .filter((protocol): protocol is string => typeof protocol === 'string')
      .map((protocol) => protocol.toLowerCase())
      .filter((protocol) => SAFE_URL_PROTOCOLS.has(protocol)),
  );

  // A protocol is only present when a colon appears before any '/', '?' or '#'.
  const colon = normalized.indexOf(':');
  if (colon !== -1) {
    const beforeColon = normalized.slice(0, colon);
    if (!/[/?#]/.test(beforeColon)) {
      const protocol = beforeColon.toLowerCase();
      if (!requestedProtocols.has(protocol)) return '';
    }
  }

  return escapeAttribute(normalized);
}

/**
 * Get version information
 */
function getVersion(): string {
  return VERSION;
}

/**
 * Get performance and security statistics
 */
function getStats(): { version: string; securityLevel: string; performance: string } {
  return {
    version: getVersion(),
    securityLevel: 'Plain-text output with contextual encoders',
    performance: 'Measure with the included benchmark on your target runtime'
  };
}

/**
 * Purifai - bounded strip-to-text sanitizer
 *
 * Converts HTML-like input to plain text and exposes separate contextual
 * encoders for HTML text, attributes, and URLs.
 *
 * Every method delegates to a module-level function and reads no instance or
 * class state, so `Purifai.sanitize` and the standalone `sanitize` export are
 * interchangeable and neither depends on its call-site receiver.
 */
export class Purifai {
  /**
   * Convert HTML-like input to plain text
   *
   * @param input - Content to sanitize (string, object, or any type)
   * @param options - Optional configuration
   * @returns Plain-text string; render it through normal text interpolation
   *
   * @example
   * ```typescript
   * import { Purifai } from 'purifai';
   *
   * const clean = Purifai.sanitize('<script>alert("xss")</script>Hello World');
   * console.log(clean); // "Hello World"
   * ```
   */
  static sanitize(input: unknown, options?: PurifaiOptions): string {
    return sanitize(input, options);
  }

  /**
   * Sanitize input and return detailed analysis
   *
   * @param input - Content to sanitize
   * @param options - Optional configuration
   * @returns Detailed sanitization result with threat analysis
   *
   * @example
   * ```typescript
   * const result = Purifai.analyze('<script>alert("xss")</script>Hello');
   * console.log(result.content); // "Hello"
   * console.log(result.hadThreats); // true
   * console.log(result.threatLevel); // "critical"
   * ```
   */
  static analyze(input: unknown, options?: PurifaiOptions): PurifaiResult {
    return analyze(input, options);
  }

  /**
   * Check if input contains dangerous patterns
   *
   * @param input - Content to check
   * @returns true if dangerous content detected
   *
   * @example
   * ```typescript
   * const isDangerous = Purifai.isDangerous('<script>alert("xss")</script>');
   * console.log(isDangerous); // true
   * ```
   */
  static isDangerous(input: string): boolean {
    return isDangerous(input);
  }

  /**
   * Batch sanitize multiple inputs for optimal performance
   *
   * @param inputs - Array of inputs to sanitize
   * @param options - Optional configuration
   * @returns Array of sanitized strings
   *
   * @example
   * ```typescript
   * const cleaned = Purifai.sanitizeBatch([
   *   '<script>alert("xss")</script>Hello',
   *   '<img src=x onerror=alert(1)>World'
   * ]);
   * console.log(cleaned); // ["Hello", "World"]
   * ```
   */
  static sanitizeBatch(inputs: unknown[], options?: PurifaiOptions): string[] {
    return sanitizeBatch(inputs, options);
  }

  /**
   * Escape text for an HTML body context (lossless — nothing is removed)
   *
   * @example
   * ```typescript
   * Purifai.escape('if (a<b && c>d)'); // "if (a&lt;b &amp;&amp; c&gt;d)"
   * ```
   */
  static escape(input: unknown): string {
    return escape(input);
  }

  /**
   * Escape text for an HTML attribute value, safe even when unquoted
   *
   * @example
   * ```typescript
   * `<div title="${Purifai.escapeAttribute(userInput)}">`
   * ```
   */
  static escapeAttribute(input: unknown): string {
    return escapeAttribute(input);
  }

  /**
   * Escape a URL, returning '' if its protocol is not allowed
   *
   * @example
   * ```typescript
   * Purifai.escapeUrl('javascript:alert(1)'); // ""
   * Purifai.escapeUrl('https://example.com'); // escaped, safe for href
   * ```
   */
  static escapeUrl(input: unknown, options?: PurifaiOptions): string {
    return escapeUrl(input, options);
  }

  /**
   * Get version information
   */
  static getVersion(): string {
    return getVersion();
  }

  /**
   * Get performance and security statistics
   */
  static getStats(): { version: string; securityLevel: string; performance: string } {
    return getStats();
  }
}

// Export convenience functions. These are the same module-level implementations
// the class delegates to, so destructuring them is always safe.
export { sanitize, analyze, isDangerous, sanitizeBatch, escape, escapeAttribute, escapeUrl };

// Default export
export default Purifai;
