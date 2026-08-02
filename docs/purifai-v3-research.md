# Purifai v3 — research and design review

Date: 2026-08-02. Scope: review the proposed clean-break v3 in
`docs/superpowers/specs/2026-08-02-purifai-v3-design.md`; no backward
compatibility is assumed.

Evidence grading: **[normative]** = a standard or security guideline;
**[authoritative]** = first-party package/runtime documentation or source;
**[empirical]** = a measurement reproduced during this review;
**[inference]** = a design conclusion from that evidence.

## 1. Decision

**Proceed with the product direction, but revise the draft before writing the
parser.** There is a defensible reason for Purifai to exist, but it is narrower
than the current promise:

> Convert untrusted HTML to readable, size-bounded plain text in Web-standard
> JavaScript runtimes, without a DOM/tree or runtime dependencies.

The combination is defensible; none of its parts is unique by itself:

- `striptags` is already zero-dependency and its v4 alpha already exposes a
  persistent streaming state machine, but stable v3 is a flat tag stripper and
  does not provide document formatting or whole-container omission.
- `html-to-text` already provides much richer readable formatting, selectors,
  custom formatters, tables, links, word wrapping, and an input limit, but v10
  targets Node >=20.19/ES2022, has five runtime dependencies, and parses a
  document structure.
- DOMPurify and `sanitize-html` preserve safe HTML. They solve a different and
  harder sink problem and should remain recommended when markup must survive.

The release will not have a compelling advantage if it ships as only another
tag stripper, if limits can silently corrupt data, or if its scanner is
described as WHATWG-conforming without implementing HTML tree construction.
The value must be demonstrated by fixtures and adversarial scaling, not by
calling the package “more secure” than mature HTML sanitizers.

## 2. Current alternatives and the actual gap

Versions below are the current npm releases on 2026-08-02.

| Package | Current contract | Runtime/dependency facts | Consequence for v3 |
|---|---|---|---|
| `html-to-text` 10.0.0 | `convert`/`htmlToText`, plus `compile` for repeated conversions; document formatting, links, images, selectors, formatter hooks, tables, wrapping | Node >=20.19, ES2022, five dependencies (`htmlparser2`, `dom-serializer`, selector packages, and merge utility); default `maxInputLength` is 16,777,216 | The rival already has an input bound and far more fidelity. Purifai can win on Worker portability, no tree, a smaller fixed policy, output/depth bounds, and predictable worst-case work—not merely “HTML to text.” ([README](https://github.com/html-to-text/node-html-to-text/blob/master/packages/html-to-text/README.md), [package.json](https://github.com/html-to-text/node-html-to-text/blob/master/packages/html-to-text/package.json), [defaults/source](https://github.com/html-to-text/node-html-to-text/blob/master/packages/html-to-text/src/html-to-text.js)) |
| `striptags` 3.2.0 | `striptags(html, allowableTags?, tagReplacement?)`; flat stripping with optional tag preservation/replacement | Zero dependencies; ES6; no unsafe stripping regexes | Stable v3 is the closest comparison for simple stripping. The fair differentiator is readable structure plus dropping selected container bodies, not zero dependencies alone. ([npm](https://www.npmjs.com/package/striptags)) |
| `striptags` 4 alpha | Typed `striptags(text, options)` and persistent `StateMachine.consume()` for chunks; allowed/disallowed tags and replacement text | Zero dependencies; explicitly alpha | Purifai must not claim to be the only zero-dependency state machine or imply that a later streaming API is novel. Comparisons must say whether they test stable v3 or v4 alpha. ([maintainer README](https://github.com/ericnorris/striptags/blob/main/README.md)) |
| DOMPurify 3.4.12 | DOM-based allowlist sanitizer returning safe-preserved HTML by default; supports HTML, SVG, MathML, hooks and profiles | Zero direct npm dependencies in the browser; server use requires a DOM, for which the maintainers recommend current `jsdom` and warn that the DOM implementation is part of the security boundary | Correct alternative when markup must remain. “DOM-free on the server/Worker” is a real deployment distinction; “safer than DOMPurify” is unsupported. ([maintainer README](https://github.com/cure53/DOMPurify), [npm](https://www.npmjs.com/package/dompurify)) |
| `sanitize-html` 2.17.6 | Allowlisted HTML and attributes, URL-scheme policy, transforms, filters, and optional complete discard of disallowed element contents | Node-oriented, seven dependencies, based on `htmlparser2`; browser use requires bundling | Also a preserve-HTML sanitizer, not the primary benchmark category. Its ability to `completelyDiscard` selected elements means body removal is not unique, only simpler in Purifai's fixed profile. ([maintainer README](https://github.com/apostrophecms/apostrophe/tree/main/packages/sanitize-html), [npm](https://www.npmjs.com/package/sanitize-html)) |

**[inference]** The draft's category separation is correct. Benchmarks should
compare text fidelity and scaling with `html-to-text`, and flat stripping/body
omission with stable `striptags`. DOMPurify and `sanitize-html` belong in a
decision table, not a composite performance/security ranking.

## 3. Runtime claims

The Worker motivation is real but should be precise.

- **[authoritative]** Cloudflare Workers favors Web Platform APIs; Node
  compatibility is a separately enabled, incomplete surface. Workers also have
  concrete resource pressure: the Free plan lists 10 ms CPU per HTTP request
  and each isolate has 128 MB memory. A small iterative converter with capped
  allocations fits this environment better than a DOM emulation stack.
  ([runtime APIs](https://developers.cloudflare.com/workers/runtime-apis/),
  [Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/),
  [limits](https://developers.cloudflare.com/workers/platform/limits/))
- **[authoritative]** Deno provides the standard `URL` API and now runs most
  pure-JavaScript npm/Node code. Bun likewise supports Web APIs, Node
  compatibility, ESM and CommonJS. Avoiding Node built-ins therefore improves
  portability, but it is a much stronger differentiator for Workers than for
  current Deno or Bun.
  ([Deno `URL`](https://docs.deno.com/api/web/~/URL),
  [Deno npm/Node compatibility](https://docs.deno.com/runtime/fundamentals/node/),
  [Bun module systems](https://bun.sh/docs/runtime/module-resolution),
  [Bun Node compatibility](https://bun.sh/docs/runtime/nodejs-compat))

The runtime claim should be earned by testing the published artifact in each
runtime. “Runtime-neutral ES2020” is an implementation constraint, not evidence
of compatibility. ESM is the portable core; CommonJS is useful for Node users
but does not strengthen the edge proposition.

“Resource-bounded” also needs a narrower definition. The caller has already
allocated the complete JavaScript string before Purifai receives it. v3 can
bound code units examined, output retained, structural state, and its own
temporary allocations; it cannot bound the memory or I/O used to obtain the
original string. The README should say **bounded conversion work**, not imply
bounded end-to-end ingestion.

## 4. HTML semantics: the current draft overpromises

### 4.1 A tokenizer is not the HTML parser

**[normative]** WHATWG defines the HTML parser as tokenization plus tree
construction. Tree construction has insertion modes, implied end tags, table
foster parenting, the adoption-agency algorithm, namespaces, and fragment
context. A forward-only event scanner can intentionally avoid building a tree,
but then its malformed-input and output-order behavior is its own extraction
grammar, not browser parsing.
([HTML parsing](https://html.spec.whatwg.org/multipage/parsing.html))

This matters most for tables, misnested formatting, templates, and foreign
content. “Browser-specific DOM repair is not reproduced” is directionally
honest, but it is too vague for a security-positioned package. The spec should
publish deterministic lexical rules and test them directly. It should use
phrasing such as “HTML-aware extraction scanner” and “WHATWG character-reference
data,” not “conforming HTML parser.”

### 4.2 Raw text, RCDATA, script data, and plaintext are not one rule

The draft currently treats all dropped containers as matchable nested
containers. That conflicts with HTML tokenization:

- `style`, `xmp`, `iframe`, `noembed`, and `noframes` use RAWTEXT; `title` and
  `textarea` use RCDATA; `script` has its own script-data states; `noscript`
  depends on the scripting flag and parsing context.
- RAWTEXT/RCDATA/script-data recognize an **appropriate end tag**. A textual
  `<script>` inside script data does not open a nested script element, so
  tracking nested same-name starts is not browser behavior.
- `<plaintext>` switches to PLAINTEXT until EOF; there is no matching
  `</plaintext>` escape.

([text-only element algorithms](https://html.spec.whatwg.org/multipage/parsing.html#parsing-elements-that-contain-only-text),
[RAWTEXT end-tag states](https://html.spec.whatwg.org/multipage/parsing.html#rawtext-end-tag-name-state),
[script-data end-tag states](https://html.spec.whatwg.org/multipage/parsing.html#script-data-end-tag-name-state),
[PLAINTEXT state](https://html.spec.whatwg.org/multipage/parsing.html#plaintext-state))

**Required correction:** use state-specific lexical skipping for genuine
raw-text/RCDATA/script elements. For ordinary dropped elements such as
`template` or `object`, explicitly define a capped lexical nesting policy and
label it non-browser-equivalent. `<plaintext>` must consume to bounded EOF.

### 4.3 A self-closing slash does not close these HTML elements

The draft says self-closing forms of dropped tags do not begin a skipped body.
That is a material semantic error. In HTML, a trailing slash sets a token flag;
for non-void HTML elements, failure to acknowledge it is a parse error and the
element remains open. Thus `<script/>payload</script>` enters script data, and
`<form/>labels</form>` is not an empty form. Only void elements are immediately
popped in the relevant tree-building rules.
([self-closing flag](https://html.spec.whatwg.org/multipage/parsing.html#self-closing-start-tag-state),
[in-body rules](https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inbody))

**Required correction:** ignore the slash for non-void HTML drop containers.
Do not offer `recognizeSelfClosing`-style configurability; it would make a small
security-facing contract harder to reason about.

### 4.4 Dropping `<form>` is not justified

The `<form>` element does not make its textual descendants executable in a
plain-text result. Forms commonly contain visible labels, legends, option text,
instructions, and button text; the HTML Standard's own examples put all of that
reader-visible content inside `<form>`.
([HTML forms introduction](https://html.spec.whatwg.org/multipage/forms.html#introduction-4))

Dropping the entire form therefore directly contradicts “presentation-quality
reader text” and creates surprising losses such as:

```html
<form><h2>Contact us</h2><label>Email <input></label><button>Send</button></form>
```

becoming empty. **Remove `form` from the dropped-container list.** Treat the
form wrapper as a block, keep labels/legends/button/option text, and omit void
control markup. Whether default `<textarea>` content is retained is a product
choice, but dropping it because it is RCDATA is not a security requirement.

The same distinction applies elsewhere: “raw text” is a tokenizer category,
not a synonym for “dangerous.” `xmp`, `plaintext`, `textarea`, SVG text, MathML,
and `object` fallback can contain meaningful reader-visible material. A narrow
v3 can still omit them for predictable simplicity, but the rationale must be
fidelity policy, not XSS prevention.

A better initial policy is:

- definitely drop `script`, `style`, `template`, `head`, and document metadata;
- choose and document a scripting-enabled policy for `noscript`/`noframes`;
- omit embedded-resource containers (`iframe`, `embed`, `applet`) as a product
  choice;
- preserve ordinary descendants of `form`;
- defer SVG/MathML semantic extraction, but report that text may be lost;
- specify `object`, `xmp`, `plaintext`, `textarea`, and `title` individually
  instead of calling all of them active containers.

### 4.5 Character references require context, not just a table

Using the complete WHATWG table is correct, and decoding after tokenization so
that `&lt;script&gt;` remains text is essential. Completeness also requires the
algorithm:

- named references use longest-match behavior;
- missing-semicolon legacy names behave differently in text and attributes;
- some names decode to two code points;
- numeric references map zero, out-of-range values, and surrogate values to
  U+FFFD, but C1 numeric references use the standard's replacement table (for
  example `&#x80;` becomes U+20AC), so “invalid Unicode scalars become U+FFFD”
  is incomplete.

([named-reference state](https://html.spec.whatwg.org/multipage/parsing.html#named-character-reference-state),
[numeric-reference end state](https://html.spec.whatwg.org/multipage/parsing.html#numeric-character-reference-end-state),
[named reference data](https://html.spec.whatwg.org/entities.json))

The generated data must be revision-pinned and tested against Web Platform
Tests or generated exhaustive fixtures. Selected attributes (`href`, `alt`)
must use attribute-context character-reference behavior rather than the text
decoder.

### 4.6 Whitespace and “presentation quality” are Purifai policy

HTML tokenization normalizes CR/CRLF to LF and defines ASCII whitespace as tab,
LF, form feed, CR, and space. Browser-visible line layout additionally depends
on DOM tree construction, CSS `display` and `white-space`, and `innerText`-like
rendering rules. A source-only converter cannot claim to reproduce it.
([input preprocessing](https://html.spec.whatwg.org/multipage/parsing.html#preprocessing-the-input-stream),
[ASCII whitespace](https://infra.spec.whatwg.org/#ascii-whitespace))

Readable/compact formatting is therefore a useful Purifai opinion, not WHATWG
conformance. Document it as such. Also decide whether `<pre>` mirrors HTML's
authoring convenience of stripping the first LF after the start tag; the
standard does so.
([`pre`](https://html.spec.whatwg.org/multipage/grouping-content.html#the-pre-element))

### 4.7 URL policy needs an explicit parse-then-filter contract

Use the standard `URL` implementation, serialize `url.href`, and then filter
the parsed protocol and credentials. Relative references require a base URL.
The WHATWG parser removes leading/trailing C0 controls or spaces and removes
ASCII tabs/newlines during parsing; if the product promise is to **reject**
control-bearing input rather than normalize it, precheck the decoded attribute
before calling `new URL`. Protocol-relative and backslash forms also need
explicit lexical fixtures because special-URL parsing can normalize them.
([URL parsing](https://url.spec.whatwg.org/#concept-basic-url-parser),
[`URL` constructor](https://url.spec.whatwg.org/#dom-url-url),
[credentials](https://url.spec.whatwg.org/#include-credentials))

Displayed URLs are text, not navigation, so this is primarily an anti-spoofing
and output-quality policy. The URL Standard itself warns that rendering URLs
has spoofing risks. Do not call the result a generally “safe URL.”

## 5. API review

The functional clean break is a good decision. Removing the class, threat
score, `isDangerous`, implicit coercion, and broad contextual helpers makes the
contract easier to understand. The following changes would improve it further.

### 5.1 Do not silently truncate the primary string API

As drafted, `toText()` discards all truncation metadata even though limits are
on by default. A legitimate 1,000,001-code-unit document silently becomes a
different document. This is a data-integrity footgun and makes bounded behavior
hard to operate.

Recommended shape:

```ts
export function toText(html: string, options?: ToTextOptions): string;

export function convert(
  html: string,
  options: ToTextOptions & { overflow: 'truncate' },
): ConversionResult;
```

- `toText` uses bounded defaults and `overflow: 'throw'`; exceeding input or
  output bounds throws a dedicated `PurifaiLimitError` with the limit kind.
- Deliberate truncation is available through `convert(..., { overflow:
  'truncate' })`, which cannot lose the metadata.
- Keep deliberate truncation out of a native `TransformStream`: the Streams
  Standard defines controller termination to close the readable side but error
  the writable side. Streaming limit overflow should therefore error explicitly
  instead of presenting a partial prefix as a normal close.
- If one behavior across both functions is preferred, make `toText` return the
  result object too. Silent default truncation is the option to avoid.

The report should also expose `processedInputLength` or `scanComplete`.
`droppedContainers` currently covers only the processed prefix when output
fills early, which otherwise looks like complete-document telemetry.

### 5.2 Tighten names and modes

- Rename `escapeHtml` to `escapeHtmlText`. OWASP explicitly treats HTML text,
  HTML attribute, JavaScript, CSS, and URL output as different contexts; the
  narrower name prevents the helper from being mistaken for a universal HTML
  sanitizer/encoder.
- Rename link modes to `label`, `label-and-url`, and `drop`. “omit” is ambiguous:
  some callers will expect it to omit only the destination, while the draft
  removes the label and all descendants.
- Prefer `baseUrl?: string | URL` if using the standard URL API, and validate
  that it resolves to HTTP(S).
- Reject unknown option keys at runtime. TypeScript excess-property checks do
  not protect JavaScript callers or values stored in variables, and ignoring a
  misspelled security/resource option is surprising.
- Group limits (`limits.input`, `limits.output`, `limits.depth`) or expose the
  depth limit explicitly. A hidden fixed depth of 64 is public behavior and
  therefore belongs in the contract.
- Define whether output lengths and limits are UTF-16 code units or Unicode
  scalar values in property names/docs. UTF-16 units are efficient and match
  JavaScript `length`, but they are not bytes and do not correspond to Worker
  request-size limits.

### 5.3 Keep the security boundary, narrow the advertised sinks

OWASP recommends contextual output encoding, identifies `textContent` as a
safe sink, and reserves HTML sanitization for cases where authored markup must
survive. That supports the draft's category boundary.
([XSS output encoding](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html#output-encoding),
[safe sinks](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html#safe-sinks),
[HTML sanitization](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html#html-sanitization))

The first README example should say:

```ts
element.textContent = toText(untrustedHtml); // text sink
element.innerHTML = escapeHtmlText(toText(untrustedHtml)); // HTML text context
```

Do not imply that conversion prevents prompt injection in AI pipelines, log
forging in logs, or unsafe use as an attribute/URL/JavaScript/CSS value. It
removes HTML structure; it does not establish trust in the remaining language.

## 6. Entity data and the 20 KiB target

The target is plausible but not established.

**[empirical]** On 2026-08-02, the authoritative WHATWG `entities.json` response
was 145,897 bytes uncompressed. The server's gzip response measured 20,631
bytes—already slightly above 20 KiB before tokenizer, formatter, API, and URL
logic:

```console
$ curl -sI https://html.spec.whatwg.org/entities.json
content-length: 145897

$ curl -sH 'Accept-Encoding: gzip' https://html.spec.whatwg.org/entities.json | wc -c
20631
```

**[empirical]** A useful feasibility reference is the `entities` project's
generated compact HTML decode table. Its source response was 19,849 bytes raw
and 13,478 bytes under `gzip -9`, leaving only about 7 KiB for the rest of a
20-KiB bundle:

```console
$ curl -sI https://raw.githubusercontent.com/fb55/entities/master/src/generated/decode-data-html.ts
content-length: 19849

$ curl -s https://raw.githubusercontent.com/fb55/entities/master/src/generated/decode-data-html.ts | gzip -9 | wc -c
13478
```

([WHATWG data](https://html.spec.whatwg.org/entities.json),
[`entities` generated table](https://github.com/fb55/entities/blob/master/src/generated/decode-data-html.ts))

**[inference]** A specialized trie/automaton can probably keep the full package
under 20 KiB, but the target is tight enough to require an implementation spike.
It must not drive semantic shortcuts. Define the measurement exactly—for
example, minified production ESM entry plus all imported runtime modules,
compressed with `gzip -9`, excluding declarations and source maps. Also measure
module-initialization time and live heap; immutable table data still counts
against a Worker's 128 MB isolate limit even if complexity notation excludes it.

## 7. Complexity and malformed-input claims

O(n) time and O(output + capped state) working memory are achievable, not yet
facts. Acceptance needs to catch these common violations:

- rescanning for matching end tags or repeatedly slicing/concatenating tails;
- longest entity lookup that retries from every character without a bounded
  automaton;
- URL parsing or attribute decoding of data already scanned more than once;
- output building through repeated immutable string concatenation;
- overflow state that loses the ability to recover after depth 64.

The depth contract especially needs a concrete overflow algorithm. “Suppress
additional layout state but continue correct dropped-container behavior” is not
self-evident. A single numeric overflow depth works only for a deliberately
simple lexical push/pop grammar; it cannot reproduce the HTML tree builder's
scope and error-recovery rules. Specify what happens on mismatched end tags
while overflowed and test it.

Truncating the input before tokenization also creates a synthetic EOF. Define
all incomplete-token outcomes at that boundary. Treating an incomplete tag as
literal text is safe only for a text sink, but it may produce surprising visible
attack syntax; `escapeHtmlText` must still encode it before an HTML-string sink.

## 8. Required draft changes before implementation

1. **Replace the browser-parsing implication with a normative Purifai extraction
   grammar.** Separate data, RCDATA, RAWTEXT, script-data, and PLAINTEXT behavior;
   specify malformed and depth-overflow recovery.
2. **Fix self-closing and plaintext semantics.** Ignore `/` on non-void HTML
   elements and make `<plaintext>` consume to bounded EOF.
3. **Remove `form` from whole-container dropping.** Re-review every remaining
   dropped tag based on reader fidelity, not whether its HTML category sounds
   active or raw.
4. **Make truncation explicit.** Default the simple string API to a typed limit
   error, and require a metadata-returning path for truncation.
5. **Rename `escapeHtml` to `escapeHtmlText` and clarify link modes.** Keep all
   sink-specific warnings adjacent to the first example.
6. **Correct the character-reference contract.** Include legacy semicolon and
   attribute-context rules plus the numeric C1 mapping.
7. **Turn size and linearity into measured gates.** Define the gzip artifact,
   include generated entity data, and measure heap, cold import, adversarial
   CPU scaling, and behavior at every limit.
8. **Narrow marketing.** Say “bounded conversion work” and “HTML-aware
   extraction”; avoid “WHATWG-conforming parser,” “safe URL,” prompt-safety, or
   sanitizer superiority.

## 9. Go/no-go test

Purifai v3 has a solid reason to use over rivals if the implementation proves
all four of these together:

1. It produces materially more readable text than stable `striptags` and drops
   script/style bodies that flat stripping leaves behind.
2. It uses materially less package/runtime machinery than `html-to-text` while
   retaining a useful baseline for paragraphs, headings, lists, links, images,
   code, and simple tables.
3. Its input, output, structural-state, and temporary-allocation limits are
   observable and hold under malformed adversarial inputs with linear scaling.
4. The same published ESM artifact passes Node, Bun, Deno, Cloudflare Workers,
   Chromium, Firefox, and WebKit fixtures without Node shims or a DOM.

If any of these is dropped, the reason weakens substantially: without
readability it is another `striptags`; without strict observable bounds it is a
smaller `html-to-text`; without the runtime matrix it has only an asserted edge
story; and without a precise extraction grammar its security-facing behavior
cannot be reviewed.

## Sources

- [WHATWG HTML parsing](https://html.spec.whatwg.org/multipage/parsing.html)
- [WHATWG named character references](https://html.spec.whatwg.org/entities.json)
- [WHATWG URL Standard](https://url.spec.whatwg.org/)
- [WHATWG Streams Standard](https://streams.spec.whatwg.org/#ts-default-controller-terminate)
- [WHATWG Infra — ASCII whitespace](https://infra.spec.whatwg.org/#ascii-whitespace)
- [OWASP Cross-Site Scripting Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [`html-to-text` maintainer documentation and source](https://github.com/html-to-text/node-html-to-text/tree/master/packages/html-to-text)
- [`striptags` stable npm release](https://www.npmjs.com/package/striptags) and [v4-alpha maintainer documentation](https://github.com/ericnorris/striptags/blob/main/README.md)
- [DOMPurify maintainer documentation](https://github.com/cure53/DOMPurify)
- [`sanitize-html` maintainer documentation](https://github.com/apostrophecms/apostrophe/tree/main/packages/sanitize-html)
- [Cloudflare Workers runtime APIs and limits](https://developers.cloudflare.com/workers/runtime-apis/)
- [Deno runtime documentation](https://docs.deno.com/runtime/)
- [Bun runtime documentation](https://bun.sh/docs/runtime)
