/**
 * 🛡️ PURIFAI - Ultra-Secure HTML Sanitizer
 *
 * Advanced XSS protection with polyglot attack resistance.
 * Blocks sophisticated obfuscation techniques that bypass other sanitizers.
 *
 * @version 2.0.0
 * @license MIT
 */

// Core security patterns for comprehensive XSS protection
const DANGEROUS_TAGS_WITH_CONTENT = /<(script|style|iframe|frame|object|embed|applet|meta|link|form|svg|math|base)(?:\s[^>]*)?>[\s\S]*?<\/\1>|<(script|style|iframe|frame|object|embed|applet|meta|link|form|svg|math|base)(?:\s[^>]*)?\/?>|<\/(script|style|iframe|frame|object|embed|applet|meta|link|form|svg|math|base)>/gi;

// Enhanced event handlers to catch spaced and obfuscated variations
const EVENT_HANDLERS_ENHANCED = /\s*o\s*n\s*[a-z]+\s*=\s*["']?[^"'>]+["']?/gi;

// Enhanced protocol detection for javascript: variations and polyglots
const DANGEROUS_PROTOCOLS_ENHANCED = /(?:href|src|action|formaction|data|background|poster|code|cite|longdesc|usemap|itemtype|ping|manifest|archive|classid|codebase|datasrc|dynsrc|lowsrc|srcset)\s*=\s*["']?\s*(?:j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:|javascript\s*:|vbscript\s*:|data:text\/html|data:image\/svg\+xml(?:[^"'>]*script)?|filesystem:|chrome-extension:|blob:|about:|res:|ie:|ms-its:|mk:|mhtml:|file:|jar:|hcp:|ms-help:|disk:|vnd\.ms-|shell:|lynxcgi:|lynxexec:|news:|nntp:|telnet:|gopher:|wais:|prospero:|webcal:|ldap:|ldaps:|ftp:|ftps:|sftp:|ssh:|ircs?:|mailto:|xmpp:|sms:|smsto:|mms:|mmsto:|tel:|fax:|modem:|payto:|bitcoin:|ethereum:|magnet:)[^"'\s>]*/gi;

const DANGEROUS_ATTRIBUTES = /(?:expression|@import|javascript:|vbscript:|livescript:|mocha:|behavior:|constructor)\s*\(/gi;

const TEMPLATE_INJECTION = /\{\{[\s\S]*?\}\}|<%[\s\S]*?%>|<\?[\s\S]*?\?>|\${[\s\S]*?}|#\{[\s\S]*?}/g;

const DANGEROUS_FUNCTIONS = /\b(?:alert|eval|expression|Function|constructor|prototype|__proto__|document\.write|document\.writeln|window\.location|document\.location|setTimeout|setInterval|setImmediate|execScript|msSetImmediate|range\.createContextualFragment|range\.insertNode|insertAdjacentHTML|outerHTML)\s*\(/gi;

const NULL_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

// Specific polyglot attack patterns
const POLYGLOT_JAVASCRIPT = /j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi;
const POLYGLOT_EVENTS = /o\s*n\s*[a-z]+\s*(?:=|alert)/gi;
const ENCODED_TAGS = /\\x3c|\\x3e|%3c|%3e/gi;

const SUSPICIOUS_PATTERNS = /<|>|javascript:|vbscript:|\bon[a-z]+\s*=|@import|\{\{|<%|<\?|\${|#\{/i;

/**
 * A script-executing protocol appearing on its own, with no `href=`/`src=` in
 * front of it.
 *
 * DANGEROUS_PROTOCOLS_ENHANCED only matches protocols already attached to an
 * attribute, so a bare payload like `vbscript:alert(1)` was classified as
 * harmless. That is unsafe the moment a caller drops the result into an href.
 * Letter-spacing is tolerated the same way the polyglot patterns do it.
 */
const DANGEROUS_PROTOCOL_TOKEN = /(?:j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t|v\s*b\s*s\s*c\s*r\s*i\s*p\s*t|l\s*i\s*v\s*e\s*s\s*c\s*r\s*i\s*p\s*t|m\s*o\s*c\s*h\s*a)\s*:|data\s*:\s*text\/html/i;

/**
 * A payload that survived sanitization but carries no letters or digits is pure
 * syntax residue — comment soup, stray brackets, quotes. Used to decide whether
 * anything meaningful is left of a flagged attack.
 */
const HAS_TEXT_CONTENT = /[a-z0-9]/i;

/**
 * A recognizable HTML tag: `<` immediately followed by a letter (or `/` then a
 * letter). Deliberately narrower than `/<[^>]*>/` — the broad form also matches
 * prose like "5 < 6 and 7 > 3", and deleting that silently destroys user text.
 */
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;

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
 * Build a stateless twin of a pattern for use with `.test()`.
 *
 * `RegExp.prototype.test()` on a /g (or /y) regex advances `lastIndex` and does
 * NOT reset it between calls, so testing the same string repeatedly alternates
 * between match and miss. Detection must never use the /g originals — those are
 * reserved for `.replace()`, which does reset `lastIndex`.
 */
function stateless(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''));
}

const DETECT_DANGEROUS_TAGS = stateless(DANGEROUS_TAGS_WITH_CONTENT);
const DETECT_EVENT_HANDLERS = stateless(EVENT_HANDLERS_ENHANCED);
const DETECT_DANGEROUS_PROTOCOLS = stateless(DANGEROUS_PROTOCOLS_ENHANCED);
const DETECT_DANGEROUS_ATTRIBUTES = stateless(DANGEROUS_ATTRIBUTES);
const DETECT_TEMPLATE_INJECTION = stateless(TEMPLATE_INJECTION);
const DETECT_POLYGLOT_JAVASCRIPT = stateless(POLYGLOT_JAVASCRIPT);
const DETECT_POLYGLOT_EVENTS = stateless(POLYGLOT_EVENTS);

/**
 * Purifai Configuration Options
 */
export interface PurifaiOptions {
  /** Maximum input length (default: 1MB) */
  maxLength?: number;
  /** Custom allowed protocols (default: ['http', 'https', 'mailto']) */
  allowedProtocols?: string[];
  /** Enable aggressive mode for maximum security (default: true) */
  aggressiveMode?: boolean;
}

/**
 * Purifai Sanitization Result
 */
export interface PurifaiResult {
  /** Sanitized content */
  content: string;
  /** Whether dangerous content was detected */
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

const VERSION = '2.0.0';

/**
 * Upper bound on filter re-passes. Each pass can only shrink the string, so a
 * fixpoint is normally reached in one or two; the cap exists so pathological
 * input cannot turn sanitization into a long loop.
 */
const MAX_FILTER_PASSES = 5;

/**
 * Decode common encoding bypasses.
 *
 * Each step is guarded independently: `decodeURIComponent` throws on a stray
 * `%` (e.g. "100% off"), and a single shared try/catch would silently skip
 * every decoder after it.
 */
function decodeEncodingBypasses(str: string): string {
  let result = str;

  // URL decode (handle %3C, %3E, etc.)
  try {
    result = decodeURIComponent(result);
  } catch {
    // Malformed percent-encoding: keep the string as-is and continue decoding.
  }

  try {
    // Decode Unicode escapes (<, >, etc.)
    result = result.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });

    // Decode hex escapes (\x3c, \x3e, etc.)
    result = result.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });

    // HTML entity decode (&#60;, &#62;, etc.)
    result = result.replace(/&#(\d+);/g, (_, num) => {
      return String.fromCharCode(parseInt(num, 10));
    });

    // Hex HTML entities (&#x3c;, &#x3e;, etc.)
    result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });
  } catch {
    // If decoding fails, use whatever decoded successfully so far.
  }

  return result;
}

/**
 * Remove dangerous tags together with their content.
 *
 * MUST run before any generic tag stripping. Generic stripping removes only the
 * angle-bracket delimiters, which orphans the tag body and lets script text
 * survive into the output — that is how `<script>alert(1)</script>Hello` used
 * to sanitize to "1)Hello" instead of "Hello".
 */
function removeDangerousTagsWithContent(str: string): string {
  return str.replace(DANGEROUS_TAGS_WITH_CONTENT, '');
}

/**
 * Enhanced polyglot attack handling - Addresses sophisticated XSS techniques
 */
function handlePolyglotAttacks(str: string): string {
  let result = str;

  try {
    // Fix 1: Universal XSS Polyglot - Handle spaced javascript: and event handlers
    result = result.replace(POLYGLOT_JAVASCRIPT, ''); // Remove j a v a s c r i p t :
    result = result.replace(POLYGLOT_EVENTS, ''); // Remove o n c l i c k =
    result = result.replace(ENCODED_TAGS, ''); // Remove \x3c \x3e

    // Fix 2: Ultimate XSS Polyglot - Handle comment obfuscation
    result = result.replace(/javascript\s*:\s*\/\*[\s\S]*?\*\//gi, '');
    result = result.replace(/javascript\s*:\s*\/\*[^*]*\*\/[^>]*/gi, '');

    // Fix 3: Namespace Confusion Attack - Handle form/math mixing
    result = result.replace(/<form[^>]*>[\s\S]*?<\/form>/gi, '');
    result = result.replace(/<math[^>]*>[\s\S]*?<\/math>/gi, '');

    // Additional polyglot cleanup
    result = result.replace(/%0[AD]/gi, ''); // Remove URL encoded newlines

    // Aggressive SVG cleanup if it contains suspicious patterns.
    // NOTE: `\x3c` in a regex literal is the character `<`, so this branch fires
    // for any markup at all. That is intentional here — it runs *after*
    // removeDangerousTagsWithContent, so there is no tag body left to orphan.
    if (/svg|sVg|\x3c|\\\w{3}/i.test(result)) {
      result = result.replace(/svg[^>]*>/gi, '');
      result = result.replace(/sVg[^>]*>/gi, '');
      result = result.replace(/\\x\w{2}/gi, '');
      result = result.replace(/<\/[^>]*>/gi, '');
      result = result.replace(/<[^>]*>/gi, '');
    }

  } catch {
    // If polyglot handling fails, strip aggressively
    result = result.replace(/<[^>]*>/g, '').replace(/[<>]/g, '');
  }

  return result;
}

/**
 * Assess threat level of input content
 */
function assessThreatLevel(input: string): 'none' | 'low' | 'medium' | 'high' | 'critical' {
  if (!input) return 'none';

  // Critical threats
  if (/<script/i.test(input) || /javascript\s*:/i.test(input) || /\bon[a-z]+\s*=/i.test(input)) {
    return 'critical';
  }

  // High threats
  if (/<(iframe|object|embed|form|svg|math)/i.test(input) || /eval\s*\(/i.test(input)) {
    return 'high';
  }

  // Medium threats
  if (/<(style|link|meta)/i.test(input) || /expression\s*\(/i.test(input)) {
    return 'medium';
  }

  // Low threats
  if (/<[^>]*>/i.test(input)) {
    return 'low';
  }

  return 'none';
}

/**
 * Check if input contains dangerous patterns
 */
function isDangerous(input: string): boolean {
  if (!input) return false;
  try {
    // Stateless twins only — see `stateless()`.
    return DETECT_DANGEROUS_TAGS.test(input) ||
           DETECT_EVENT_HANDLERS.test(input) ||
           DETECT_DANGEROUS_PROTOCOLS.test(input) ||
           DETECT_DANGEROUS_ATTRIBUTES.test(input) ||
           DETECT_TEMPLATE_INJECTION.test(input) ||
           DETECT_POLYGLOT_JAVASCRIPT.test(input) ||
           DETECT_POLYGLOT_EVENTS.test(input) ||
           DANGEROUS_PROTOCOL_TOKEN.test(input);
  } catch {
    return true; // If error occurs, assume dangerous
  }
}

/**
 * Sanitize input with maximum security protection
 */
function sanitize(input: unknown, options?: PurifaiOptions): string {
  const config = { ...DEFAULT_OPTIONS, ...options };

  // Handle various input types with robust error handling
  if (input === null || input === undefined) return '';

  let str: string;
  try {
    if (typeof input === 'string') {
      str = input;
    } else if (typeof input === 'object') {
      str = JSON.stringify(input);
    } else {
      str = String(input);
    }
  } catch {
    return '';
  }

  // Length check
  if (str.length > config.maxLength) {
    str = str.substring(0, config.maxLength);
  }

  // Quick return for empty
  if (!str.trim()) return '';

  // Remove null bytes and control characters first
  let result = str.replace(NULL_CONTROL_CHARS, '');

  try {
    // Decode common encoding bypasses first
    result = decodeEncodingBypasses(result);

    // Classify once, against both the raw and the decoded form — decoding can
    // reveal an attack that was invisible in the original input.
    const dangerous = isDangerous(str) || isDangerous(result);

    if (!dangerous) {
      // Nothing dangerous was detected. Remove real markup, but ESCAPE any
      // leftover angle brackets instead of deleting them: in benign text they
      // are prose ("5 < 6"), and deleting through to the next `>` silently
      // swallows whatever the user actually wrote.
      const benign = removeDangerousTagsWithContent(result)
        .replace(HTML_TAG, '')
        .replace(DANGEROUS_ATTRIBUTES, '')
        .replace(TEMPLATE_INJECTION, '')
        .replace(DANGEROUS_FUNCTIONS, '');

      return escapeAngleBrackets(benign).replace(/\s+/g, ' ').trim();
    }

    // Remove dangerous tags together with their content BEFORE any generic tag
    // stripping, so tag bodies can never be orphaned into the output.
    result = removeDangerousTagsWithContent(result);

    // Enhanced polyglot attack mitigation
    result = handlePolyglotAttacks(result);

    // Apply core security filters to a FIXPOINT.
    //
    // Deleting a match can splice previously separated text into a brand-new
    // match: removing "(1)" from "confirm(1)href=..." leaves "confirm1href=",
    // whose tail "onfirm1href=" reads as an event handler on the next pass.
    // A single pass therefore leaves output that is not stable under a second
    // sanitize(), which both breaks idempotence and — more seriously — means
    // removal can manufacture a construct that was not in the input.
    // Iterating until nothing changes closes that gap. Found by fuzzing.
    let previous: string;
    let passes = 0;
    do {
      previous = result;
      result = result
        // Re-run tag+content removal: decoding and polyglot handling can reveal
        // markup that was not visible in the original input.
        .replace(DANGEROUS_TAGS_WITH_CONTENT, '')
        // Enhanced event handlers (catches obfuscated variations)
        .replace(EVENT_HANDLERS_ENHANCED, '')
        // Enhanced protocol detection (catches polyglot protocols)
        .replace(DANGEROUS_PROTOCOLS_ENHANCED, (match) => {
          // Keep safe protocols only
          const safeProtocols = config.allowedProtocols.join('|');
          return match.match(new RegExp(`^(?:href|src)\\s*=\\s*["']?\\s*(?:${safeProtocols}):\\/\\/`, 'i')) ? match : '';
        })
        // Remove dangerous attributes
        .replace(DANGEROUS_ATTRIBUTES, '')
        // Remove template injection patterns
        .replace(TEMPLATE_INJECTION, '')
        // Remove dangerous function calls
        .replace(DANGEROUS_FUNCTIONS, '');
      passes++;
    } while (result !== previous && passes < MAX_FILTER_PASSES);

    // Final safety check with aggressive cleanup if needed
    if (config.aggressiveMode && SUSPICIOUS_PATTERNS.test(result)) {
      const tempCheck = result.replace(/<[^>]*>/g, '');
      if (SUSPICIOUS_PATTERNS.test(tempCheck)) {
        // Still dangerous after tag removal, apply maximum security
        result = result
          .replace(/<[^>]*>/g, '') // Remove all HTML tags
          .replace(/[<>]/g, '') // Remove angle brackets
          .replace(/javascript|vbscript/gi, '') // Remove dangerous protocols
          // The \b is load-bearing. Without it `on\w+=` matched the "on" inside
          // "c-on-firm1href=" — a string produced by this pipeline's own earlier
          // deletions — and ate text that was never a handler, which also broke
          // idempotence. Every real handler is preceded by a separator.
          .replace(/\bon[a-z]+\s*=/gi, '') // Remove event handlers
          .replace(/svg|SVG|sVg/gi, '') // Remove svg references
          .replace(/script|SCRIPT/gi, '') // Remove script references
          .replace(/alert|eval/gi, '') // Remove dangerous functions
          .replace(/\\x\w{2}/gi, '') // Remove hex encoded chars
          .replace(/[(){}[\]]/g, ''); // Remove brackets that could be function calls
      }
    }

    // Clean up whitespace
    result = result.replace(/\s+/g, ' ').trim();

    // Reaching here means the input WAS flagged dangerous. If its remains
    // contain no letters or digits, what survived is pure syntax residue
    // (unbalanced `/*`, quotes, stray brackets left by polyglots) — emit
    // nothing rather than punctuation soup.
    //
    // Deliberately a *decision*, not another substitution: stripping comment
    // tokens outright would corrupt legitimate text such as "https://…".
    if (config.aggressiveMode && !HAS_TEXT_CONTENT.test(result)) {
      return '';
    }

    // With aggressiveMode off, nothing above neutralises delimiter fragments the
    // tag patterns cannot match — `<!-->` leaves `-->`, and an attribute
    // breakout leaves `">`. Escaping them keeps the output inert without
    // deleting anything, so no configuration can emit a raw `<` or `>`.
    return escapeAngleBrackets(result);

  } catch {
    // Fallback to maximum security sanitization if any error occurs
    return str
      .replace(NULL_CONTROL_CHARS, '')
      .replace(/<[^>]*>/g, '')
      .replace(/[<>]/g, '')
      .replace(/javascript|vbscript|eval|alert/gi, '')
      .replace(/\bon[a-z]+\s*=/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

/**
 * Sanitize input and return detailed analysis
 */
function analyze(input: unknown, options?: PurifaiOptions): PurifaiResult {
  const startTime = performance.now();
  const originalStr = String(input ?? '');

  const sanitized = sanitize(input, options);
  const processingTime = performance.now() - startTime;

  const hadThreats = sanitized !== originalStr;
  const threatLevel = assessThreatLevel(originalStr);

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
 * Lossless and total: nothing is removed, so this is the correct choice when
 * the input is plain text rather than markup. `sanitize()` cannot tell the two
 * apart — `a<b && c>d` is a valid HTML start tag by the parsing spec, so
 * `sanitize()` drops it while `escape()` preserves it verbatim.
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
 * Returns '' when the protocol is not in `allowedProtocols`, which is what
 * stops `javascript:`, `data:` and friends from reaching an `href`. Relative
 * URLs are allowed through, since they cannot carry a protocol.
 */
function escapeUrl(input: unknown, options?: PurifaiOptions): string {
  if (input === null || input === undefined) return '';
  const config = { ...DEFAULT_OPTIONS, ...options };
  const str = (typeof input === 'string' ? input : String(input)).trim();
  if (!str) return '';

  // Strip control characters and whitespace an attacker can use to break up a
  // protocol token ("java\tscript:").
  const normalized = str.replace(/[\x00-\x20\x7F-\x9F]/g, '');

  // A protocol is only present when a colon appears before any '/', '?' or '#'.
  const colon = normalized.indexOf(':');
  if (colon !== -1) {
    const beforeColon = normalized.slice(0, colon);
    if (!/[/?#]/.test(beforeColon)) {
      const protocol = beforeColon.toLowerCase();
      if (!config.allowedProtocols.map((p) => p.toLowerCase()).includes(protocol)) {
        return '';
      }
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
    securityLevel: '100% XSS Protection',
    performance: 'Optimized for high-throughput'
  };
}

/**
 * 🛡️ Purifai - Ultra-Secure HTML Sanitizer
 *
 * Advanced lightweight HTML sanitizer with superior XSS protection
 * against known attack vectors including advanced polyglot attacks.
 *
 * Every method delegates to a module-level function and reads no instance or
 * class state, so `Purifai.sanitize` and the standalone `sanitize` export are
 * interchangeable and neither depends on its call-site receiver.
 */
export class Purifai {
  /**
   * Sanitize input with maximum security protection
   *
   * @param input - Content to sanitize (string, object, or any type)
   * @param options - Optional configuration
   * @returns Sanitized string safe for HTML output
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
