# Purifai security research: scope, measurements, and limits

Date: 2026-08-02.

Evidence labels: **[empirical]** means reproduced by the repository commands;
**[normative]** refers to browser/security guidance; **[inference]** is a design
conclusion rather than a proof.

## 1. Security contract

Purifai solves one narrow problem: reduce HTML-like input to plain reader text.
It does not preserve safe markup and is not a drop-in replacement for DOMPurify,
sanitize-html, xss, or rehype-sanitize when formatting must remain.

The contextual APIs are separate:

- `sanitize()` strips markup and removes scriptable/raw-text container bodies.
- `escape()` encodes lossless text for an HTML text context.
- `escapeAttribute()` encodes a serialized HTML attribute value.
- `escapeUrl()` restricts URL schemes to a caller-selected subset of `http`,
  `https`, and `mailto`; custom options cannot enable executable schemes.
- `analyze()` and `isDangerous()` are advisory telemetry, not authorization or
  authentication decisions.

Normal framework text interpolation remains preferable to any HTML injection
sink. Purifai does not make arbitrary `innerHTML` use safe.

## 2. Scanner design and denial-of-service resistance

Earlier releases used a backtracking expression to remove dangerous tags and
their bodies. **[empirical]** repeated incomplete `<script ` prefixes exhibited
quadratic growth.

The current implementation uses a forward scanner:

1. Parse complete HTML-like tags while respecting quoted attributes.
2. Strip ordinary tags and preserve their reader-visible text.
3. Remove scriptable/raw-text containers, including script, style, iframe,
   object, SVG, MathML, form, template, noscript, title, and textarea, together
   with their bodies.
4. Count nested same-name containers; an unclosed container consumes the
   remainder (fail closed).
5. Treat an incomplete tag-like suffix as escaped prose at the top level, or as
   the consumed remainder inside a dropped container.

Every scanner cursor advances monotonically. `test/verify-performance.js`
measures two malformed shapes from 2–128 KiB using medians after warm-up.

**[empirical, Node 26.3.0 / Apple Silicon]**

| Shape | 2 KiB | 128 KiB | Input growth | Time growth | Normalized growth |
|---|---:|---:|---:|---:|---:|
| Top-level incomplete `<script ` prefixes | 0.0257 ms | 1.7350 ms | 64× | 67.55× | 1.06× |
| Incomplete `<a ` prefixes inside `<script>` | 0.0139 ms | 0.8318 ms | 64× | 59.88× | 0.94× |

These measurements support the intended near-linear behavior on the tested
runtime. They are regression evidence, not a universal performance guarantee.

## 3. Correctness hardening

Regression coverage now includes:

- benign equals text (`London=Paris`, `online=true`);
- comparison-like prose/code (`a<b && c>d`);
- percent-encoded prose (`100%20off`) without broad URL decoding;
- valid astral numeric entities and invalid null, surrogate, control, and
  out-of-range entities (invalid scalars become U+FFFD);
- nested, mixed-case, malformed, and unclosed raw-text containers;
- idempotence and hostile non-string inputs;
- protocol-relative URLs, backslash network paths, and attempts to enable
  `javascript:` through custom protocol options.

Ordinary markup transformation is no longer reported as a threat merely because
the output differs. `getStats()` no longer claims a protection percentage.

## 4. Fair comparison methodology

`test/fair-benchmark.js` reports independent axes:

- **No executable output:** 84 attack outputs are parsed and re-parsed in jsdom;
  neither tree may contain a script node, an event-handler attribute, or a
  dangerous URL.
- **Exact text:** visible output must exactly match each of 15 benign fixtures.
- **Markup kept:** safe markup retention for preserving sanitizers.
- **Raw body removed:** exact removal of script/style/iframe/SVG/template bodies.
- **Throughput:** median of seven same-process samples after warm-up, with the
  slowest of those samples shown as a small-run p95; compare only within a category.

Synthetic delete-all and identity functions are printed after the package
results solely to audit the metric. They are controls, not rivals, and do not
appear in public package comparison tables.

**[empirical snapshot, Node 26.3.0 / Apple Silicon]**

| Library | Category | No executable output* | Exact text | Markup kept | Raw body removed | Median ops/sec | p95 µs/op |
|---|---|---:|---:|---:|---:|---:|---:|
| Purifai.sanitize | strip-to-text | 100% | 100% | 0% | 100% | 526,709 | 2.050 |
| Purifai.escape | encode-as-text | 100% | 40% | 0% | 0% | 596,421 | 3.627 |
| striptags | strip-to-text | 100% | 100% | 0% | 20% | 633,697 | 1.836 |
| DOMPurify (jsdom) | preserve-safe-html | 100% | 100% | 100% | 60% | 1,686 | 698.853 |
| sanitize-html | preserve-safe-html | 100% | 100% | 100% | 60% | 88,492 | 14.731 |
| xss | preserve-safe-html | 100% | 100% | 100% | 0% | 335,448 | 4.079 |
| rehype-sanitize | preserve-safe-html | 100% | 100% | 100% | 40% | 24,522 | 44.439 |
| escape-html | encode-as-text | 100% | 40% | 0% | 0% | 2,238,804 | 0.452 |
| validator.escape | encode-as-text | 100% | 40% | 0% | 0% | 735,565 | 1.494 |
| entities.escapeUTF8 | encode-as-text | 100% | 40% | 0% | 0% | 1,208,824 | 1.453 |
| html-entities | encode-as-text | 100% | 40% | 0% | 0% | 869,440 | 1.203 |
| he.escape | encode-as-text | 100% | 40% | 0% | 0% | 952,948 | 1.242 |

\* Observed corpus result, not a security guarantee. DOMPurify is loaded through
`isomorphic-dompurify`, so this Node benchmark labels its jsdom environment.

The results do not show that Purifai is “more secure” than preserving
sanitizers. They show different behavior for different contracts. In the
strip-to-text rows, striptags is smaller and faster in this snapshot; Purifai
combines exact benign text with full raw-container body removal and measured
bounded scaling on malformed input.

## 5. Remaining limits

- Purifai is a bounded string scanner, not the browser's full HTML parser.
- The real-browser suite currently covers Chromium; Firefox and WebKit may have
  parser-specific behavior.
- The attack corpus can regress known behavior but cannot enumerate every future
  browser or payload.
- Output safety still depends on using the correct destination context. A value
  safe as text is not automatically safe as a URL, CSS value, script, or SQL.

## Sources

- [cure53/DOMPurify — Attack Classes & Bypass History](https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History)
- [PortSwigger — Bypassing DOMPurify again with mutation XSS](https://portswigger.net/research/bypassing-dompurify-again-with-mutation-xss)
- [Securitum — Mutation XSS via namespace confusion](https://www.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2.0.17-bypass.html)
- [OWASP DOM-based XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html)
- [MDN: `javascript:` URLs](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/javascript)
