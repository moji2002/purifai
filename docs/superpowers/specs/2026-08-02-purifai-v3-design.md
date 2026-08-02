# Purifai v3 Design: Bounded Streaming HTML-to-Text

Date: 2026-08-02
Status: Revised after primary-source review; pending final user review

## 1. Product decision

Purifai v3 is a clean-break release. It has no backward-compatibility goal and
does not retain v2 interfaces merely to ease migration.

Purifai v3 will aim to be the best at one narrowly defined job:

> Streaming untrusted HTML into readable plain text with bounded working memory,
> without a DOM, document tree, Node-specific runtime code, or dependencies.

“Best” is a release gate, not an unsupported security superlative. The first v3
release must prove all of these together:

1. More readable output than stable `striptags`, including headings,
   paragraphs, lists, links, images, code, and simple tables.
2. Complete removal of script, style, template, and non-reader container bodies
   that flat tag stripping commonly leaks into output.
3. Better hostile-input one-shot p95 throughput than `html-to-text`, plus lower
   end-to-end peak memory when each package uses its best documented ingestion
   path, on a published reproducible benchmark.
4. Hard, observable bounds on input, output, retained token data, structural
   depth, and internal streaming buffers.
5. Chunk-invariant streaming: joining stream output produces exactly the same
   text as one-shot conversion for every possible input partition.
6. The same published ESM artifact passes Node, Bun, Deno, Cloudflare Workers,
   Chromium, Firefox, and WebKit tests without a DOM or Node shim.

If those gates are not met, the release must not claim this category win.

## 2. Why this module should exist

The alternatives each solve only part of the target job:

- Stable `striptags` is small and dependency-free, but it performs flat tag
  stripping rather than presentation-quality conversion and commonly retains
  bodies such as script source.
- The `striptags` v4 alpha has an incremental state machine, so streaming alone
  is not novel; it still does not combine the full v3 readability, body-removal,
  and resource contract.
- `html-to-text` produces richer output and supports input/depth/child limits,
  selectors, tables, wrapping, and custom formatters. It targets Node, carries
  parser and selector dependencies, constructs document structure, and is not a
  Web `TransformStream` converter.
- DOMPurify and `sanitize-html` preserve safe HTML. They are the correct tools
  when markup must survive and should not be portrayed as inferior versions of
  Purifai.

Purifai wins only at the intersection: readable extraction, hostile-input
bounds, incremental operation, Web-runtime portability, and a deliberately
small fixed policy.

## 3. Goals

1. Produce useful reader text from HTML fragments and documents.
2. Support one-shot strings and incremental Web Streams through the same core
   state machine.
3. Never require the complete input or a document tree in streaming mode.
4. Enforce deterministic limits during scanning, not after allocation.
5. Handle malformed and adversarial input with bounded linear work.
6. Drop non-reader and source-code containers without deleting ordinary visible
   form or fallback text indiscriminately.
7. Decode HTML character references with context-correct WHATWG behavior.
8. Run from one side-effect-free package in Web-standard JavaScript runtimes.
9. Make output sinks, truncation, and non-goals difficult to misunderstand.

## 4. Non-goals

Purifai v3 will not:

- preserve or return safe HTML;
- implement an HTML DOM or claim browser-equivalent tree construction;
- reproduce CSS layout or browser `innerText` exactly;
- expose selectors, formatter plugins, callbacks, or mutable global policy;
- determine whether a user or request is malicious;
- expose threat scores or attack booleans;
- prevent prompt injection, log forging, phishing text, or semantic abuse;
- make plain text safe for attributes, URLs, JavaScript, CSS, or template source;
- fetch URLs or inspect embedded resources;
- auto-detect HTML byte encodings; or
- maintain v2 source or behavior compatibility.

The scanner implements a documented Purifai extraction grammar. It uses WHATWG
tokenization rules and data where explicitly stated, but it is not described as
a conforming HTML parser because it does not perform HTML tree construction.

## 5. Public interface

The module has three primary entry points, one error type, and supporting result
types.

```ts
export type LayoutMode = 'readable' | 'compact';
export type LinkMode = 'label' | 'label-and-url' | 'drop';
export type ImageMode = 'alt' | 'drop';
export type OverflowMode = 'throw' | 'truncate';

export interface ConversionLimits {
  /** JavaScript UTF-16 code units consumed. Default: 1_000_000. */
  input?: number;

  /** JavaScript UTF-16 code units emitted. Default: 250_000. */
  output?: number;

  /** Retained structural frames. Default: 64. */
  depth?: number;

  /** Aggregate externally-derived syntax/attribute retention. Default: 65_536. */
  token?: number;
}

export interface ToTextOptions {
  /** Default: 'readable'. */
  layout?: LayoutMode;

  /** Default: 'label'. */
  links?: LinkMode;

  /** Default: 'alt'. */
  images?: ImageMode;

  /** HTTP(S) base used only by label-and-url mode. */
  baseUrl?: string | URL;

  /** Partial overrides of the bounded defaults. */
  limits?: ConversionLimits;
}

export interface ConvertOptions extends ToTextOptions {
  /** Default: 'throw'. Truncation is never implicit. */
  overflow?: OverflowMode;
}

export type LimitKind = 'input' | 'output' | 'depth' | 'token';

export class PurifaiLimitError extends RangeError {
  readonly kind: LimitKind;
  readonly limit: number;
  readonly observed: number;
}

export interface ConversionReport {
  /** The first limit that stopped conversion, or null after a complete scan. */
  truncatedBy: LimitKind | null;
  scanComplete: boolean;
  consumedInputCodeUnits: number;
  outputCodeUnits: number;
  droppedContainers: Readonly<Record<string, number>>;
}

export interface ConversionResult extends ConversionReport {
  text: string;
}

export interface PurifaiTextTransform
  extends TransformStream<string, string> {
  /** Resolves after close; rejects with the same error if conversion fails. */
  readonly result: Promise<ConversionReport>;
}

export function toText(
  html: string,
  options?: ToTextOptions,
): string;

export function convert(
  html: string,
  options?: ConvertOptions,
): ConversionResult;

export function createTextTransform(
  options?: ToTextOptions,
): PurifaiTextTransform;

export function escapeHtmlText(text: string): string;
```

### 5.1 Interface depth

The public seam hides tokenization, chunk boundaries, state recovery, entity
decoding, URL parsing, layout coalescing, body omission, and limit accounting.
Callers choose only product policy that materially changes the result.

- `toText` is the trivial one-shot path and always uses `overflow: 'throw'`.
- `convert` is the one-shot reporting path. It can deliberately request
  `overflow: 'truncate'` because it cannot lose truncation metadata.
- `createTextTransform` is the streaming adapter over the same core module. A
  streaming limit always errors the transform; it cannot masquerade as a normal
  close.
- `escapeHtmlText` is an explicitly HTML-text-context encoder, not a universal
  sanitizer or attribute encoder.

No class wrapper, batch mapper, compile step, threat detector, version getter,
or stats getter is exposed.

### 5.2 Streaming example

The transform accepts decoded JavaScript string chunks. Byte decoding remains a
separate Web Platform concern:

```ts
import { createTextTransform } from 'purifai';

const purifai = createTextTransform({
  links: 'label-and-url',
});

const readableText = response.body!
  .pipeThrough(new TextDecoderStream())
  .pipeThrough(purifai);

await readableText.pipeTo(destination);
const report = await purifai.result;
```

`createTextTransform` returns an actual Web `TransformStream` augmented with a
`result` promise, so it works with native backpressure and `pipeThrough`.

### 5.3 Chunk invariance

For every string `s`, `ToTextOptions` value `o`, and partition `p` of `s`, when
conversion finishes normally:

```text
join(stream(p, o)) === convert(s, o).text
```

Output chunk sizes are implementation-defined; joined text and reports are not.
Character references, tags, attributes, comments, raw-text end tags, and Unicode
surrogate pairs may all span input chunks without changing the result.

With `overflow: 'throw'`, every partition must instead fail with the same error
type, `kind`, `limit`, and `observed` value. A stream may already have emitted a
valid text prefix before it errors; streamed output cannot be retracted. A
consumer that needs atomic all-or-nothing delivery must stage output and commit
it only after both the pipe operation and `result` promise fulfill.

### 5.4 Removed v2 surface

V3 does not export:

- the `Purifai` class or a default export;
- `sanitize`, `sanitizeBatch`, `analyze`, or `isDangerous`;
- `escape`, `escapeAttribute`, or `escapeUrl`;
- `getVersion` or `getStats`; or
- `aggressiveMode`, `allowedProtocols`, or compatibility aliases.

## 6. Validation and overflow

### 6.1 Option validation

- Input and stream chunks must be strings; other values throw `TypeError`.
- Unknown option keys and unknown nested limit keys throw `TypeError` at runtime.
- Enum values are checked at runtime.
- Limits must be finite, non-negative safe integers.
- A `baseUrl` must parse as an HTTP(S) URL without credentials.
- Option objects are read once and copied into immutable internal configuration.
- A malformed HTML string is data and never causes a parser exception.

### 6.2 Default overflow

All entry points default to `overflow: 'throw'`. Exceeding a configured limit
throws or stream-errors with `PurifaiLimitError`.

`toText` does not accept an overflow override, so it can never silently return a
partial document.

`convert` alone accepts `overflow: 'truncate'`. In that mode:

- conversion returns a surrogate-safe completed prefix;
- `truncatedBy` identifies the first limit that stopped conversion;
- `scanComplete` is false when input remains unprocessed;
- `consumedInputCodeUnits` describes the deterministic logical input prefix
  consumed by the state machine, not an unprocessed suffix delivered in the
  final string chunk; and
- conversion stops after the bounded prefix.

`createTextTransform` does not accept `overflow`. A limit errors both sides of
the transform and rejects `result` with the same `PurifaiLimitError`. Standard
pipe failure can then cancel upstream and abort downstream according to the
caller's pipe options. This follows native Web Streams failure semantics and
avoids reporting deliberate truncation as a successful close when the standard
would error the transform's writable side.

Purifai cannot reclaim or bound a complete string chunk that an upstream
producer already allocated and delivered; it does not copy that chunk wholesale
into converter-owned state.

For every limit kind, `PurifaiLimitError.observed` is the first disallowed value,
normally `limit + 1`. This keeps thrown errors invariant across input chunking.

### 6.3 Limit meanings

- `input` counts total JavaScript UTF-16 code units consumed across chunks.
- `output` counts emitted UTF-16 code units, whether returned or streamed.
- `depth` counts retained Purifai structural frames, not browser DOM depth.
- `token` caps the aggregate code units of externally-derived incomplete syntax
  and selected attribute values retained at one time, including destinations
  held by open links. Storage is released when its token or structural frame no
  longer needs it.

A cut never emits half of a surrogate pair. These are JavaScript string bounds,
not request-byte or end-to-end ingestion bounds.

## 7. Extraction grammar

### 7.1 Scanner model

The implementation is an iterative HTML-aware extraction state machine. It
recognizes data, tag-open, tag-name, attribute, comment/declaration, RCDATA,
RAWTEXT, script-data, PLAINTEXT, and character-reference states needed by this
contract.

It does not build nodes. Semantic events flow directly into a bounded formatter.
Only selected attribute data (`href`, `alt`, list numbering inputs) is retained.

### 7.2 HTML start and end tags

- Tag and attribute names are compared ASCII-case-insensitively.
- HTML void elements never open structural frames.
- A trailing `/` on a non-void HTML start tag does not self-close it.
- Unknown well-formed tags are transparent inline wrappers and require no frame.
- Recognized structural end tags close the nearest matching retained frame and
  any intervening retained frames according to Purifai's lexical recovery rule.
- Unmatched end tags are ignored.
- A `<` that cannot begin a token remains literal text.
- An incomplete token at final EOF is emitted as text unless its state belongs
  to a dropped comment/declaration/container or a limit has fired.

This is deterministic Purifai recovery, not browser adoption-agency, foster
parenting, implied-end-tag, or fragment-context behavior.

### 7.3 Preprocessing

- CRLF and lone CR normalize to LF, including across chunks.
- U+0000 becomes U+FFFD.
- Other input code points remain available to the plain-text formatter.
- Percent escapes and JavaScript-style `\\xNN`/`\\uNNNN` sequences are not
  interpreted as HTML syntax.

### 7.4 Character references

Purifai uses revision-pinned WHATWG named-character-reference data and implements
the tokenizer algorithm required for:

- longest named-reference matching;
- legacy missing-semicolon behavior;
- different text and attribute-context rules;
- one- and two-code-point named results;
- decimal and hexadecimal numeric references;
- replacement of zero, out-of-range, and surrogate numeric values;
- the standard C1 numeric-reference replacement table; and
- references divided across any input chunks.

References are decoded only after the scanner has identified text or a selected
attribute value. Decoded `<` and `>` are never fed back into markup recognition.
Thus `&lt;script&gt;` produces literal reader text, not an element.

The generated compact lookup data is verified exhaustively against the pinned
WHATWG source during development.

## 8. Reader formatting policy

Formatting is a Purifai policy, not a claim to reproduce CSS layout.

### 8.1 Readable mode

- Headings, paragraphs, sections, articles, divisions, forms, figures, and
  other ordinary block containers produce coalesced block boundaries.
- `<br>` produces one line break.
- `<hr>` produces a block boundary, not a decorative character line.
- Unordered items use `- `.
- Ordered items use incrementing `1. `, `2. ` prefixes and respect valid
  non-negative `start`/`value` integers within safe bounds.
- Nested list items indent by two spaces per retained list level.
- Blockquote non-empty lines use `> ` per retained quote level.
- Table cells are separated by tabs and rows by line breaks. Colspan, rowspan,
  visual alignment, and layout-table detection are not attempted.
- `<pre>` preserves whitespace after HTML newline preprocessing and follows the
  HTML authoring convention of omitting one initial LF.
- Inline `<code>` preserves its text without adding Markdown punctuation.
- Ordinary inline elements are transparent.
- Outside preformatted/RCDATA-preserved content, HTML whitespace collapses to a
  single space.
- Leading/trailing whitespace is removed and more than two ordinary consecutive
  newlines coalesce to two.

### 8.2 Compact mode

All ordinary whitespace and structural boundaries collapse to one trimmed line.
Preformatted, table, list, and quote content keeps its characters but normalizes
its whitespace to single spaces.

### 8.3 Forms and controls

`form`, `fieldset`, `legend`, `label`, `button`, `select`, and `option` preserve
their reader-visible descendant text. Void controls such as `input` do not emit
their `value`, placeholder, or hidden data. The form wrapper is never a reason
to delete labels or instructions.

### 8.4 Images

- `images: 'alt'` emits a non-empty, context-decoded `alt` value at the image
  position with formatter-controlled separation.
- `images: 'drop'` emits nothing.
- Image URLs are never emitted or fetched.

### 8.5 Links

- `links: 'label'` preserves descendant label text and omits `href`.
- `links: 'label-and-url'` preserves the label and appends ` [URL]` at the close
  tag when the decoded destination passes the display policy.
- `links: 'drop'` suppresses the anchor and all descendants.

The streaming formatter always appends an accepted destination in
`label-and-url` mode; it does not buffer an unbounded label merely to detect
whether label and URL are identical.

Displayed destinations follow a parse-then-filter policy:

1. Reject raw or decoded C0 controls, spaces inside a scheme, protocol-relative
   forms, and leading backslash forms.
2. Resolve relatives only when a valid HTTP(S) `baseUrl` exists.
3. Parse with the runtime's standard `URL` implementation.
4. Accept only serialized `http:`, `https:`, and `mailto:` destinations.
5. Reject credentials.

The result is display text, not a generally safe navigation URL. Purifai never
navigates or makes it clickable.

## 9. Body and special-element policy

Tags are classified by reader fidelity, not by whether their HTML category
sounds dangerous.

### 9.1 Always drop body

- `script` and `style` use state-specific script-data/RAWTEXT skipping.
- `template` content is lexically skipped with bounded ordinary nesting.
- `iframe`, `noembed`, `noframes`, and `noscript` bodies are omitted under a
  documented modern, scripting-enabled extraction policy.
- `applet` and `frameset` bodies are omitted.
- `title` is omitted as document metadata.
- SVG and MathML subtrees are omitted in v3 because correct foreign-content
  semantic extraction is outside the first release; the fidelity loss is
  documented and counted.

`embed`, `base`, `link`, `meta`, `param`, `source`, `track`, and other relevant
void metadata/resource tags emit no text.

`head` uses a bounded metadata-omission state rather than swallowing blindly to
EOF. Metadata elements and whitespace are omitted. `</head>` or `<body>` ends
the state. The first non-whitespace text or ordinary reader-content start tag
also ends it and is reprocessed as body content. This preserves useful text in
malformed documents while preventing normal title, style, script, and metadata
from leaking into reader output. `html` and `body` are transparent structural
wrappers.

### 9.2 Preserve visible fallback or control text

- `form` is an ordinary block wrapper.
- `object` preserves fallback descendant text while resource/parameter markup
  emits nothing.
- `canvas`, `audio`, and `video` preserve fallback descendant text.
- `textarea` preserves context-decoded RCDATA as a block.
- `xmp` preserves its RAWTEXT as a preformatted block.
- `<plaintext>` enters PLAINTEXT through final bounded EOF and preserves the
  remaining input as preformatted reader text; `</plaintext>` is not an escape.

### 9.3 Raw-state closing

RAWTEXT, RCDATA, and script-data states recognize only the appropriate end-tag
sequence. Text that looks like another same-name start tag does not create
nested raw elements. A trailing slash on these non-void start tags is ignored.

### 9.4 Ordinary dropped-container recovery

For lexically dropped non-raw containers such as `template`, Purifai tracks
same-name starts and ends within the configured depth. Mismatched end tags do
not close the dropped container. EOF or truncation ends omission. This policy is
explicitly non-browser-equivalent and covered by fixtures.

## 10. Internal module design

The pipeline is:

```text
validated immutable options
  -> incremental scanner
  -> semantic events
  -> bounded layout formatter
  -> bounded chunk emitter
  -> one-shot collector or Web TransformStream adapter
```

### 10.1 Incremental session

A private conversion session owns all mutable work:

- scanner state and a bounded incomplete-token buffer;
- the retained structural frame stack;
- raw/drop state;
- character-reference automaton state;
- selected bounded attribute values;
- formatter whitespace/layout state;
- pending output no larger than a fixed flush threshold; and
- counters and report fields.

The session exposes private `write(string)` and `finish()` seams used by both
one-shot and streaming adapters. There is one implementation of conversion
semantics.

### 10.2 Depth and malformed recovery

Only recognized formatting/drop contexts consume structural frames. Unknown
transparent tags do not.

Before pushing a frame, the session enforces `limits.depth`. On overflow it
throws or truncates; it never silently flattens deeper content. Nearest-matching
end-tag recovery uses a fixed-name top-frame index and per-frame previous-match
links. Matching and unmatched lookup are O(1), while intervening frames are each
popped at most once. Recovery is therefore amortized linear rather than a
repeated scan of the frame stack.

### 10.3 Token retention

The scanner advances monotonically and does not retain the complete source.
The aggregate retained form of incomplete syntax crossing chunks and selected
attribute values is charged to `limits.token`. Open-frame values such as link
destinations remain charged until released. A limit event throws or truncates
instead of allocating an unbounded quoted attribute, comment, tag, or collection
of live attribute strings.

Entity matching uses a generated compact trie/automaton rather than retrying
names from every input position.

### 10.4 Output and backpressure

The formatter writes into a pending buffer capped at 4,096 UTF-16 code units and
never divides a surrogate pair when it flushes. In stream mode it enqueues
completed chunks and relies on native `TransformStream` backpressure. In
one-shot mode an adapter collects chunks up to `limits.output`.

The 4,096-code-unit cap covers converter-owned pending output; the Web Streams
implementation may additionally retain its bounded queue and the caller or
upstream producer owns chunks it has already created. These distinctions are
included in the published memory methodology.

Streaming working memory is independent of total input and output length once
the configured structural, token, attribute, and pending-output limits are
fixed. One-shot memory additionally includes the returned text.

### 10.5 Report lifecycle

The report is mutable only inside the session and frozen when exposed.
`droppedContainers` is created without an inherited prototype and contains only
fixed normalized names known to the module.

The transform's `result` promise:

- resolves with the frozen report after normal close;
- rejects with the same error that errors the transform; and
- never resolves before all emitted output is finalized.

## 11. Complexity and resource contract

For processed input `n`, retained depth `d`, aggregate token-retention bound `t`,
and pending output bound `b` (4,096 code units):

- scanner and formatter work is amortized O(n); fixed-name end-tag lookup is
  O(1), and every discarded intervening frame is popped at most once;
- `d` and `t` are configured finite limits;
- streaming working memory is O(d + t + b) plus immutable entity data;
- one-shot working memory is O(output + d + t + b);
- no network, filesystem, DOM, dynamic code, recursive descent, or repeated
  whole-input replacements are used; and
- every externally controlled allocation is charged to a documented limit.

This is bounded conversion work. For a one-shot string, Purifai cannot undo the
memory the caller already used to obtain the string. The stream adapter is the
end-to-end path for avoiding document buffering inside the converter.

## 12. Security and sink contract

`toText` returns actual plain text. Plain text may legitimately contain `<`,
`>`, quotes, URL-like strings, or words such as `javascript`. HTML removal does
not make those characters universally trusted.

Supported examples:

```ts
element.textContent = toText(untrustedHtml);

element.innerHTML = escapeHtmlText(toText(untrustedHtml));
```

Framework text interpolation is supported only with the framework's normal
escaping enabled.

Unsupported direct uses include:

- `innerHTML` without `escapeHtmlText`;
- attribute values;
- navigation URLs;
- JavaScript, CSS, comments, or template source;
- prompt-injection defenses;
- request blocking or authorization; and
- log output without the application's normal structured-log and control-
  character policy.

`escapeHtmlText` encodes `&`, `<`, `>`, `"`, and `'` for an HTML text-node
context. Its narrow name and documentation must remain adjacent to every
HTML-string example.

Security corpora validate supported sink behavior. A green corpus is regression
evidence, not proof or a “100% secure” claim.

## 13. Runtime and packaging contract

- Runtime source targets Web-standard ES2020 behavior.
- Publish side-effect-free ESM as the portable core and CommonJS for supported
  Node consumers.
- Runtime code uses no Node built-ins and has zero runtime dependencies.
- `engines.node` follows currently supported Node releases rather than promising
  obsolete runtimes.
- Test the packed public artifact, not source-path imports, in Node, Bun, Deno,
  Cloudflare Workers, Chromium, Firefox, and WebKit.
- Publish npm provenance linked to the exact public source commit.
- Generate entity data at development time from a pinned authoritative WHATWG
  revision and include its license/source record.

### 13.1 Size measurement

The measured artifact is the minified production ESM entry with every imported
runtime module and complete entity data, compressed with `gzip -9`. Declarations,
source maps, tests, and documentation are reported separately rather than hidden
inside the runtime number.

- Release ceiling: 25 KiB gzip for the complete runtime artifact.
- Stretch goal: below 20 KiB gzip.
- Correct character-reference behavior and resource bounds may not be weakened
  to meet the stretch goal.
- Cold import time and post-import retained heap are reported alongside gzip
  size because entity data consumes runtime memory even when compressed size is
  small.

## 14. Verification strategy

### 14.1 Golden readability corpus

Versioned fixtures cover:

- headings, paragraphs, sections, inline formatting, and `<br>`;
- ordered/unordered nested lists and numbering inputs;
- blockquotes, preformatted text, inline code, and simple tables;
- form labels, controls, options, buttons, and fallback containers;
- all link/image modes and URL rejection cases;
- every body-omission class;
- SVG/MathML documented fidelity loss;
- comments, declarations, unknown tags, and malformed syntax; and
- readable and compact modes.

Expected output is reviewed as product behavior, not generated from a rival.

### 14.2 Exhaustive entity verification

- Generate fixtures for every pinned WHATWG named reference.
- Test semicolonless legacy cases in text and selected attributes.
- Test every numeric replacement class, including C1 remapping.
- Compare generated expectations with Web Platform Test data or browser token
  behavior where applicable.
- Repeat each case across adversarial stream chunk boundaries.

### 14.3 Chunk-partition properties

Every curated and fuzzed input is tested as:

- one complete chunk;
- one code unit per chunk;
- every possible split for short fixtures;
- fixed and randomized chunk sizes; and
- splits inside surrogate pairs, entities, tag names, quotes, comments, and
  raw-text end tags.

Joined stream output and final reports must equal one-shot conversion.
Throwing overflow cases must produce the same error fields at every partition.

### 14.4 Security regression

Adapt the existing 84-vector corpus to supported sinks:

1. `toText` through `textContent` executes nothing.
2. `escapeHtmlText(toText(input))` through `innerHTML` executes nothing.
3. Escaped serialize/reparse cycles create no executable node.
4. Streaming and one-shot outputs behave identically.
5. A positive control must execute in every engine so the harness proves it can
   observe failure.

Tests do not fail merely because safe plain text contains attack-like words.

### 14.5 Fuzzing and malformed scaling

Seeded grammar fuzzing verifies:

- termination and deterministic output;
- no parser exceptions for string data;
- all limit errors and truncation reports;
- stream limits always error while one-shot `convert` can report deliberate
  truncation;
- no allocation above charged bounds;
- valid UTF-16 output boundaries;
- depth and mismatched-end-tag recovery;
- raw/RCDATA/script/PLAINTEXT states;
- transform error/report lifecycle; and
- chunk invariance.

Adversarial families from 2 KiB through the configured input limit measure
elapsed time and peak retained heap. Size doubling must show linear rather than
quadratic growth within a documented tolerance.

### 14.6 Runtime matrix

The packed artifact runs consumer tests in:

- every supported Node release, ESM and CommonJS;
- current Bun and Deno;
- a real or official Cloudflare Worker test environment;
- Chromium, Firefox, and WebKit; and
- one-shot and Web `TransformStream` paths.

### 14.7 Category benchmarks

Compare with stable `striptags` and current `html-to-text` using pinned versions.
Report separately:

- golden-corpus exactness/readability;
- raw/non-reader body removal;
- warm median and p95 throughput;
- malformed-input p95 throughput;
- peak memory for one-shot conversion;
- peak memory for Purifai's streaming path;
- import time and retained heap;
- bundled and package sizes; and
- scaling at every adversarial input size.

The throughput gate is apples-to-apples: Purifai `toText` and `html-to-text`
convert the same already-materialized strings in isolated warm processes. The
end-to-end memory gate uses the best documented ingestion path for each package:
Purifai receives lazily generated bounded chunks, while a non-streaming rival
receives the complete string it requires. Source allocation, converter heap,
runtime version, garbage-collection protocol, corpus bytes/code units, and
sampling method are all disclosed. Purifai one-shot memory is also reported so
the streaming advantage is not substituted for every comparison.

The v3 category claim requires:

- Purifai `toText` to beat `html-to-text` in hostile-input one-shot p95
  throughput, and Purifai's streaming path to beat it in end-to-end peak memory,
  under the preceding published methodology;
- Purifai to meet every readability fixture in its fixed baseline;
- Purifai to remove every configured non-reader body fixture; and
- Purifai to maintain its bounds and runtime matrix.

Purifai is not required to beat flat `striptags` throughput, complex
`html-to-text` table rendering, or sanitizer markup fidelity. No composite
“security score” is published.

## 15. Documentation and positioning

The README opens with:

> Stream untrusted HTML into clean, readable text with bounded working memory.
> No DOM. No document tree. No runtime dependencies.

The first contrast is concrete:

```html
<script>alert(1)</script><h2>Release</h2><ul><li>Fast</li></ul>
```

```text
Purifai:
Release

- Fast

Flat tag stripping:
alert(1)ReleaseFast
```

The README immediately states that output is plain text and shows `textContent`
and `escapeHtmlText` sinks.

Decision guidance remains explicit:

- Choose Purifai for fixed-policy readable text, hostile-input bounds, and Web
  streaming portability.
- Choose `html-to-text` for selectors, custom formatters, advanced tables, and
  broader formatting control.
- Choose stable `striptags` for the smallest flat-strip operation.
- Choose DOMPurify or `sanitize-html` when safe markup must remain.

Claims use benchmark links and exact versions. “Most secure,” “100%,”
“bulletproof,” and uncategorized “fastest” language is prohibited.

## 16. Delivery scope

The first v3 release includes:

- the incremental scanner and extraction grammar;
- one-shot and Web `TransformStream` adapters;
- readable and compact formatting;
- the documented body, form, fallback, link, image, entity, and URL policies;
- explicit overflow errors and structured truncation reports;
- ESM, CommonJS, and TypeScript packaging;
- generated complete entity data;
- migration documentation that states v2 is intentionally incompatible; and
- the full verification and category benchmark suite.

Deferred:

- byte-encoding detection;
- Node `Transform` adapters;
- formatter plugins and selectors;
- Markdown output;
- locale-aware wrapping;
- complex visual table layout;
- SVG/MathML semantic text extraction; and
- contextual encoders beyond HTML text.

## 17. Acceptance criteria

V3 is ready only when:

1. The public interface and defaults in this document are implemented and typed.
2. One-shot and streaming conversion share one internal session implementation.
3. All golden readability fixtures pass.
4. Full entity verification passes, including context and chunk splits.
5. Every curated and fuzzed input satisfies chunk invariance.
6. Every limit is enforced before allocation exceeds its documented bound.
7. The adapted security corpus passes supported-sink checks in Chromium,
   Firefox, and WebKit with working positive controls.
8. Adversarial time and memory scaling remain within the published linear gate.
9. The packed ESM artifact passes Node, Bun, Deno, Cloudflare Workers,
   Chromium, Firefox, and WebKit without Node shims or a DOM.
10. Runtime code has no Node built-ins or runtime dependencies.
11. The defined runtime artifact is no larger than 25 KiB under `gzip -9`.
12. The published hostile-input benchmark beats `html-to-text` on one-shot p95
    throughput and best-documented-path end-to-end peak memory under the
    methodology in section 14.7.
13. npm provenance resolves to the exact public source commit.
14. The README states the sink boundary and category alternatives before any
    benchmark claim.

## 18. Research basis

The primary-source review supporting and constraining this design is recorded in
`docs/purifai-v3-research.md`. It covers the WHATWG HTML and URL standards,
OWASP output-context guidance, competitor source and documentation, runtime
constraints, entity-table measurements, and the corrections incorporated here.
