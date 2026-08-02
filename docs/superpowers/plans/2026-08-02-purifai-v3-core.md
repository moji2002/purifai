# Purifai v3 Core Converter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Purifai v2 with the clean-break, resource-bounded HTML-to-readable-text API approved in the v3 design.

**Architecture:** A thin package entrypoint exports a functional API backed by one incremental conversion session. The session wires a forward-only HTML extraction scanner to a bounded reader formatter and output emitter; one-shot and Web Stream adapters use that same session, and no runtime path builds a DOM or document tree.

**Tech Stack:** Strict TypeScript 7, ES2020, tsup, native Web `TransformStream`, Node's built-in test runner, jsdom only as a test oracle, pnpm.

## Global Constraints

- The authoritative behavior contract is `docs/superpowers/specs/2026-08-02-purifai-v3-design.md`.
- This is a clean break: remove the v2 class, default export, threat APIs, batch APIs, broad encoders, and compatibility aliases.
- Runtime code has zero dependencies, no DOM, no Node built-ins, no recursion, no dynamic code, no filesystem, and no network access.
- Runtime source targets ES2020; the package publishes bundled ESM, bundled CommonJS, and declarations.
- Supported Node releases begin at Node 22; browser and edge portability are qualified in the release plan.
- Default limits are input `1_000_000`, output `250_000`, depth `64`, and aggregate token retention `65_536` UTF-16 code units.
- Converter-owned pending output is capped at 4,096 UTF-16 code units and never splits a surrogate pair.
- `toText` and streaming always throw on overflow; only `convert` may request explicit truncation with metadata.
- Full WHATWG character-reference behavior takes priority over the 25 KiB gzip release ceiling.
- Preserve existing user changes and both untracked v3 documents.
- Stay on the current branch. Every commit step below is conditional: run `git add` and `git commit` only after the user explicitly approves that exact action; otherwise stop at the verified task checkpoint without touching the index or history.
- Use `apply_patch` for hand-edited files. Generated entity data may be rewritten by its deterministic generator.

## File Structure

### Runtime

- `index.ts` — public package re-exports only.
- `src/contracts.ts` — public types and `PurifaiLimitError`.
- `src/config.ts` — defaults, immutable normalized configuration, and strict runtime option validation.
- `src/policy.ts` — fixed tag classifications and semantic tag types.
- `src/generated/entities.ts` — generated packed WHATWG entity trie; never hand-edit.
- `src/entities.ts` — incremental named/numeric character-reference decoder.
- `src/scanner.ts` — extraction grammar, tokenization states, structural recovery, selected attributes, and body omission.
- `src/formatter.ts` — readable/compact layout policy and bounded pending output.
- `src/session.ts` — input/output/depth/token accounting, scanner/formatter wiring, truncation, and frozen reports.
- `src/api.ts` — `toText`, `convert`, `createTextTransform`, and `escapeHtmlText` adapters.

### Development data and generation

- `vendor/whatwg/entities.json` — checked-in authoritative entity input bytes.
- `vendor/whatwg/SOURCE.md` — source URL, retrieval date, SHA-256, license, and update instructions.
- `scripts/update-entities.mjs` — explicitly fetch and pin new authoritative bytes.
- `scripts/generate-entities.mjs` — deterministically compile the vendored JSON into `src/generated/entities.ts`.

### Core verification

- `test/v3/api.test.js` — public exports, plain text, validation, and escaping.
- `test/v3/entities.test.js` — named/numeric character-reference behavior.
- `test/v3/entities-exhaustive.test.js` — every vendored WHATWG entity.
- `test/v3/scanner.test.js` — tokenization, malformed recovery, and preprocessing.
- `test/v3/readability.test.js` — readable and compact golden output.
- `test/v3/special-elements.test.js` — raw states, body omission, head, fallback, and form behavior.
- `test/v3/links-images.test.js` — attribute decoding, URL display policy, links, and images.
- `test/v3/limits.test.js` — all limit errors and one-shot truncation.
- `test/v3/stream.test.js` — native stream contract and chunk invariance.
- `test/v3/fuzz.test.js` — deterministic malformed-input properties.
- `test/v3/sinks.test.js` — supported sink security checks with jsdom and a positive control.
- `test/v3/fixtures/readability.js` — reviewed golden readability corpus.
- `test/v3/fixtures/security-vectors.js` — adapted attack corpus as data.
- `test/v3/helpers/chunks.js` — deterministic partition helpers.
- `test/types/public-api.ts` — compile-time API contract.
- `test/package-smoke.mjs` — packed ESM/CommonJS and zero-runtime-dependency smoke test.

---

### Task 1: Public v3 contract and validated plain-text slice

**Files:**
- Create: `src/contracts.ts`
- Create: `src/config.ts`
- Create: `src/formatter.ts`
- Create: `src/session.ts`
- Create: `src/api.ts`
- Modify: `index.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `tsconfig.dts.json`
- Test: `test/v3/api.test.js`

**Interfaces:**
- Consumes: the exact public signatures and defaults in design sections 5 and 6.
- Produces: `ValidatedConfig`, `ConversionSession`, and all public v3 exports except the streaming implementation, which Task 8 completes without changing its signature.

- [ ] **Step 1: Write the failing public-contract tests**

Create `test/v3/api.test.js` with Node's test runner. The initial cases must prove the clean break and the smallest useful vertical slice:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as purifai from '../../dist/index.js';

test('exports only the v3 runtime values', () => {
  assert.deepEqual(Object.keys(purifai).sort(), [
    'PurifaiLimitError',
    'convert',
    'createTextTransform',
    'escapeHtmlText',
    'toText',
  ]);
  assert.equal('default' in purifai, false);
  assert.equal('Purifai' in purifai, false);
  assert.equal('sanitize' in purifai, false);
});

test('converts plain reader text and normalizes preprocessing', () => {
  assert.equal(purifai.toText('  Alpha\r\n\tBeta\u0000Gamma  '), 'Alpha Beta�Gamma');
  assert.equal(purifai.toText('Alpha\n\n\nBeta'), 'Alpha Beta');
});

test('compact and readable are validated enum values', () => {
  assert.equal(purifai.toText(' Alpha  Beta ', { layout: 'compact' }), 'Alpha Beta');
  assert.throws(() => purifai.toText('x', { layout: 'wide' }), TypeError);
});

test('rejects non-strings and unknown keys', () => {
  assert.throws(() => purifai.toText(null), TypeError);
  assert.throws(() => purifai.toText('x', { maxLength: 4 }), TypeError);
  assert.throws(() => purifai.toText('x', { limits: { bytes: 4 } }), TypeError);
  assert.throws(() => purifai.toText('x', { overflow: 'truncate' }), TypeError);
});

test('escapeHtmlText encodes exactly the five HTML text delimiters', () => {
  assert.equal(
    purifai.escapeHtmlText(`&<>"' /`),
    '&amp;&lt;&gt;&quot;&#39; /',
  );
  assert.throws(() => purifai.escapeHtmlText(1), TypeError);
});
```

- [ ] **Step 2: Run the new test and confirm the v2 surface fails it**

Run: `pnpm run build && node --test test/v3/api.test.js`

Expected: FAIL because the built artifact still exports the v2 class/functions and lacks the v3 functions.

- [ ] **Step 3: Implement the public types, validation, and plain-text session**

Define the public declarations in `src/contracts.ts` exactly as follows:

```ts
export type LayoutMode = 'readable' | 'compact';
export type LinkMode = 'label' | 'label-and-url' | 'drop';
export type ImageMode = 'alt' | 'drop';
export type OverflowMode = 'throw' | 'truncate';
export type LimitKind = 'input' | 'output' | 'depth' | 'token';

export interface ConversionLimits {
  input?: number;
  output?: number;
  depth?: number;
  token?: number;
}

export interface ToTextOptions {
  layout?: LayoutMode;
  links?: LinkMode;
  images?: ImageMode;
  baseUrl?: string | URL;
  limits?: ConversionLimits;
}

export interface ConvertOptions extends ToTextOptions {
  overflow?: OverflowMode;
}

export interface ConversionReport {
  truncatedBy: LimitKind | null;
  scanComplete: boolean;
  consumedInputCodeUnits: number;
  outputCodeUnits: number;
  droppedContainers: Readonly<Record<string, number>>;
}

export interface ConversionResult extends ConversionReport {
  text: string;
}

export interface PurifaiTextTransform extends TransformStream<string, string> {
  readonly result: Promise<ConversionReport>;
}

export class PurifaiLimitError extends RangeError {
  readonly kind: LimitKind;
  readonly limit: number;
  readonly observed: number;

  constructor(kind: LimitKind, limit: number, observed: number) {
    super(`Purifai ${kind} limit ${limit} exceeded at ${observed}`);
    this.name = 'PurifaiLimitError';
    this.kind = kind;
    this.limit = limit;
    this.observed = observed;
  }
}
```

In `src/config.ts`, expose these internal interfaces and functions:

```ts
export interface ValidatedLimits {
  readonly input: number;
  readonly output: number;
  readonly depth: number;
  readonly token: number;
}

export interface ValidatedConfig {
  readonly layout: 'readable' | 'compact';
  readonly links: 'label' | 'label-and-url' | 'drop';
  readonly images: 'alt' | 'drop';
  readonly baseUrl: URL | null;
  readonly limits: ValidatedLimits;
  readonly overflow: 'throw' | 'truncate';
}

export function validateToTextOptions(options: unknown): ValidatedConfig;
export function validateConvertOptions(options: unknown): ValidatedConfig;
```

Validation must enumerate allowed own string keys, reject symbols and unknown nested keys, check enum membership, accept only finite non-negative safe-integer limits, parse `baseUrl` once, and reject non-HTTP(S) bases or credentials. Freeze the copied limits object and outer config. `validateToTextOptions` must reject an `overflow` key; `validateConvertOptions` defaults it to `throw`.

Build the first `ConversionSession` as a legitimate plain-text subset: count input before scanning, normalize CRLF/lone CR across writes, replace U+0000 with U+FFFD, collapse HTML whitespace, trim boundaries, enforce input/output limits, emit chunks no larger than 4,096 code units, and freeze its report. Do not create temporary public exports for internals.

Implement adapters with these exact public signatures in `src/api.ts`, including a native stream object whose transformation is completed in Task 8 but already satisfies the type:

```ts
export function toText(html: string, options?: ToTextOptions): string;
export function convert(html: string, options?: ConvertOptions): ConversionResult;
export function createTextTransform(options?: ToTextOptions): PurifaiTextTransform;
export function escapeHtmlText(text: string): string;
```

The initial stream adapter must use the same plain-text `ConversionSession`, validate every chunk as a string, attach a non-enumerable read-only `result` promise, resolve only from `flush`, and reject the same error instance that errors the transform.

Replace `index.ts` with only explicit v3 exports:

```ts
export {
  PurifaiLimitError,
  convert,
  createTextTransform,
  escapeHtmlText,
  toText,
} from './src/api.js';

export type {
  ConversionLimits,
  ConversionReport,
  ConversionResult,
  ConvertOptions,
  ImageMode,
  LayoutMode,
  LimitKind,
  LinkMode,
  OverflowMode,
  PurifaiTextTransform,
  ToTextOptions,
} from './src/api.js';
```

Change the package version to `3.0.0`, description/keywords to HTML-to-readable-text language, `engines.node` to `>=22.0.0`, add `packageManager: "pnpm@11.4.0"`, set `sideEffects: false`, make `build` minify both bundles, and add `test:v3` for the new Node tests. Expand both TypeScript configs to include `src/**/*.ts` and `test/types/**/*.ts` as appropriate. `src/api.ts` must re-export `PurifaiLimitError` and every public type so the root re-export paths above are valid.

- [ ] **Step 4: Build, typecheck, and run the public-contract test**

Run: `pnpm run typecheck`

Expected: PASS with no unused or exact-optional-property errors.

Run: `pnpm run build && node --test test/v3/api.test.js`

Expected: PASS with 5 tests and no v2 exports.

- [ ] **Step 5: Record the Task 1 checkpoint**

Review: `git diff --check` and `git status --short`.

If and only if the user explicitly approves this exact commit, run:

```bash
git add index.ts package.json pnpm-lock.yaml tsconfig.json tsconfig.dts.json src test/v3/api.test.js
git commit -m "feat: establish purifai v3 public contract"
```

Otherwise leave the verified files unstaged.

---

### Task 2: Pinned WHATWG entity data and incremental decoder

**Files:**
- Create: `vendor/whatwg/entities.json`
- Create: `vendor/whatwg/SOURCE.md`
- Create: `scripts/update-entities.mjs`
- Create: `scripts/generate-entities.mjs`
- Create: `src/generated/entities.ts`
- Create: `src/entities.ts`
- Create: `test/v3/entities.test.js`
- Create: `test/v3/entities-exhaustive.test.js`
- Modify: `src/session.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ConversionSession` text input and its aggregate token accounting.
- Produces: `decodeReference(source, ampersandOffset, context, final)` with chunk-spanning data/attribute contexts and deterministic generated data.

- [ ] **Step 1: Write curated and exhaustive failing entity tests**

The curated tests must include exact expected behavior:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { toText } from '../../dist/index.js';

test('decodes named references with longest-match behavior', () => {
  assert.equal(toText('&amp; &copy &notin; &notit;'), '& © ∉ ¬it;');
  assert.equal(toText('&NotEqualTilde;'), '≂̸');
  assert.equal(toText('&lt;script&gt;'), '<script>');
});

test('decodes numeric references with WHATWG replacement behavior', () => {
  assert.equal(toText('&#65; &#x41; &#0; &#xD800; &#x110000;'), 'A A � � �');
  assert.equal(toText('&#128;'), '€');
});

test('does not reinterpret decoded markup', () => {
  assert.equal(toText('&lt;script&gt;alert(1)&lt;/script&gt;'), '<script>alert(1)</script>');
});
```

The exhaustive test must load `vendor/whatwg/entities.json`, pass every key through `toText`, and compare the result with its `characters` field. It must also split each key at every possible position through `createTextTransform` and compare joined output. For every semicolonless legacy key, test attribute context followed by a space (decode) and followed by ASCII alphanumeric or `=` (remain literal). Generate numeric fixtures for zero, every C1 replacement entry, surrogate boundaries, the maximum scalar, and values above U+10FFFF.

- [ ] **Step 2: Run the entity tests and confirm literal references fail**

Run: `pnpm run build && node --test test/v3/entities.test.js`

Expected: FAIL because Task 1 treats ampersand reference sequences as ordinary text.

- [ ] **Step 3: Pin, generate, and implement the decoder**

Before the network-fetching update script is executed for the first time, request approval for that download. `scripts/update-entities.mjs` must fetch only `https://html.spec.whatwg.org/entities.json`, require HTTP 200 and JSON content type, validate every entry has `codepoints` and `characters`, write `vendor/whatwg/entities.json`, compute SHA-256 with `node:crypto`, and rewrite `vendor/whatwg/SOURCE.md` with the URL, UTC retrieval timestamp, digest, WHATWG copyright/license link, entry count, and the exact regeneration command.

`scripts/generate-entities.mjs` must read only the vendored bytes and produce a deterministic prefix trie. Store sorted ASCII edge labels and indices in packed JavaScript strings:

```ts
// Three UTF-16 units per node: first edge, edge count, value-pool offset + 1.
export const ENTITY_NODES: string;

// Two UTF-16 units per edge: ASCII label code and child node index.
export const ENTITY_EDGES: string;

// NUL-terminated one- or two-code-point replacement strings.
export const ENTITY_VALUES: string;

export const MAX_ENTITY_KEY_LENGTH: number;
```

Strip only the leading `&` from JSON keys; retain the optional terminal semicolon as a trie edge. Sort sibling edges by code unit. Fail generation if any index or value-pool offset exceeds `0xffff`, if any edge is non-ASCII, if a duplicate key differs, or if regenerating twice produces different bytes.

Implement `src/entities.ts` with this internal protocol:

```ts
export type ReferenceContext = 'data' | 'attribute';

export type ReferenceDecision =
  | { readonly kind: 'match'; readonly consumed: number; readonly value: string }
  | { readonly kind: 'literal'; readonly consumed: 1; readonly value: '&' }
  | { readonly kind: 'need-more' };

export function decodeReference(
  source: string,
  ampersandOffset: number,
  context: ReferenceContext,
  final: boolean,
): ReferenceDecision;
```

Named decoding walks the trie once, remembers the longest terminal, requests more input only while the current prefix can still reach a longer terminal, and applies the attribute-context legacy rule: a semicolonless terminal is rejected when followed by ASCII alphanumeric or `=`. Numeric decoding supports decimal/hex, optional semicolon, an overflow-safe accumulator, U+FFFD replacement for zero/out-of-range/surrogates, and the complete C1 remap table. Decoded output goes directly to the formatter and is never fed back to markup recognition.

Add scripts:

```json
{
  "entities:update": "node scripts/update-entities.mjs && node scripts/generate-entities.mjs",
  "entities:generate": "node scripts/generate-entities.mjs",
  "entities:check": "node scripts/generate-entities.mjs --check"
}
```

- [ ] **Step 4: Verify generation, curated behavior, and exhaustive data**

Run: `pnpm run entities:check`

Expected: PASS and report the pinned digest, entry count, trie node count, and unchanged generated file.

Run: `pnpm run build && node --test test/v3/entities.test.js test/v3/entities-exhaustive.test.js`

Expected: PASS for curated, exhaustive, and every-split cases.

- [ ] **Step 5: Record the Task 2 checkpoint**

Review generator output size and `git diff --check`.

With exact commit approval only:

```bash
git add package.json pnpm-lock.yaml scripts src/entities.ts src/generated vendor test/v3/entities.test.js test/v3/entities-exhaustive.test.js
git commit -m "feat: add complete whatwg entity decoding"
```

---

### Task 3: Incremental HTML scanner and deterministic recovery

**Files:**
- Create: `src/policy.ts`
- Create: `src/scanner.ts`
- Create: `test/v3/scanner.test.js`
- Modify: `src/session.ts`
- Modify: `src/formatter.ts`

**Interfaces:**
- Consumes: `decodeReference`, `ValidatedConfig`, session limit hooks, and formatter text/start/end methods.
- Produces: `HtmlScanner.write(chunk)` and `HtmlScanner.finish()` with no document tree and monotonic input consumption.

- [ ] **Step 1: Write failing scanner and malformed-recovery tests**

Cover the scanner contract through the public API:

```js
test('removes markup while preserving inline text', () => {
  assert.equal(toText('<p>Hello <b>brave</b> world</p>'), 'Hello brave world');
  assert.equal(toText('<custom>A</custom><wbr>B'), 'AB');
});

test('handles comments declarations and literal less-than', () => {
  assert.equal(toText('A<!-- hidden -->B<!doctype html>C'), 'ABC');
  assert.equal(toText('5 < 6 and 7 > 3'), '5 < 6 and 7 > 3');
});

test('uses HTML self-closing semantics', () => {
  assert.equal(toText('<div/>A</div>B'), 'A\n\nB');
  assert.equal(toText('<br/>A'), 'A');
});

test('defines malformed EOF recovery', () => {
  assert.equal(toText('A <broken attr="x'), 'A <broken attr="x');
  assert.equal(toText('A <!-- hidden'), 'A');
  assert.equal(toText('A </unmatched>B'), 'A B');
});
```

Add chunked forms for CRLF between chunks, split tag names, quotes, comments, and surrogate pairs.

- [ ] **Step 2: Run the scanner tests and confirm raw markup remains**

Run: `pnpm run build && node --test test/v3/scanner.test.js`

Expected: FAIL on the first markup case.

- [ ] **Step 3: Implement policy tables and scanner states**

`src/policy.ts` must use fixed normalized tag-name unions and lookup objects with null prototypes. Classify tags as `void`, `inline`, `block`, `list`, `table`, `pre`, `raw-preserve`, `raw-drop`, `ordinary-drop`, `head`, or `foreign-drop`. Unknown tags are transparent and allocate no frame.

Implement these scanner states without regex passes over the complete input:

```text
Data -> TagOpen | CharacterReference(data) | text
TagOpen -> EndTagOpen | MarkupDeclarationOpen | TagName | literal "<"
EndTagOpen -> TagName(end) | literal "</"
TagName -> BeforeAttributeName | SelfClosingStartTag | emit tag
BeforeAttributeName -> AttributeName | SelfClosingStartTag | emit tag
AttributeName -> BeforeAttributeValue | next attribute | emit tag
BeforeAttributeValue -> AttributeValueDouble | AttributeValueSingle | AttributeValueUnquoted
AttributeValue* -> CharacterReference(attribute) | attribute text | finish attribute
MarkupDeclarationOpen -> Comment | BogusDeclaration
Comment -> drop through "-->" or bounded EOF
```

Names compare ASCII-case-insensitively. HTML void tags never push frames. A slash flag on any non-void tag is ignored. Recognized end tags use a fixed-name top-frame index and `previousSame` link per frame; unmatched lookup is O(1), and every intervening frame is popped only once. Incomplete non-dropped syntax at final EOF is emitted literally from the charged token buffer. Normalize CRLF/lone CR and U+0000 once at scanner input, including cross-chunk CRLF.

Expose only these internal methods:

```ts
export interface ScannerHost {
  retainToken(units: number): void;
  releaseToken(units: number): void;
  pushDepth(): void;
  popDepth(count: number): void;
  text(value: string, mode: 'normal' | 'pre'): void;
  start(tag: SemanticTag, attributes: SelectedAttributes): void;
  end(tag: SemanticTag): void;
  dropped(tag: DroppedTag): void;
}

export class HtmlScanner {
  constructor(host: ScannerHost);
  write(chunk: string): void;
  finish(): void;
}
```

- [ ] **Step 4: Verify scanner behavior and type safety**

Run: `pnpm run typecheck`

Expected: PASS.

Run: `pnpm run build && node --test test/v3/api.test.js test/v3/entities.test.js test/v3/scanner.test.js`

Expected: PASS; entity-decoded `<` remains text and never opens a scanner token.

- [ ] **Step 5: Record the Task 3 checkpoint**

With exact commit approval only:

```bash
git add src/policy.ts src/scanner.ts src/session.ts src/formatter.ts test/v3/scanner.test.js
git commit -m "feat: add incremental html extraction scanner"
```

---

### Task 4: Readable and compact layout formatter

**Files:**
- Create: `test/v3/fixtures/readability.js`
- Create: `test/v3/readability.test.js`
- Modify: `src/policy.ts`
- Modify: `src/scanner.ts`
- Modify: `src/formatter.ts`

**Interfaces:**
- Consumes: balanced semantic start/end/text events from `HtmlScanner`.
- Produces: the complete readable/compact policy for blocks, lists, quotes, tables, preformatted text, code, and form controls.

- [ ] **Step 1: Write the reviewed golden readability corpus**

Create data-driven fixtures with exact output, including this baseline:

```js
export const READABILITY_FIXTURES = [
  {
    name: 'document structure',
    html: '<h2>Release</h2><p>Fast <em>and</em> small.</p><p>Portable.</p>',
    readable: 'Release\n\nFast and small.\n\nPortable.',
    compact: 'Release Fast and small. Portable.',
  },
  {
    name: 'nested lists',
    html: '<ol start="3"><li>Three</li><li value="7">Seven<ul><li>Inner</li></ul></li></ol>',
    readable: '3. Three\n7. Seven\n  - Inner',
    compact: '3. Three 7. Seven - Inner',
  },
  {
    name: 'quote table and pre',
    html: '<blockquote>One<br>Two</blockquote><table><tr><td>A</td><td>B</td></tr></table><pre>\n x\n  y</pre>',
    readable: '> One\n> Two\n\nA\tB\n\n x\n  y',
    compact: 'One Two A B x y',
  },
  {
    name: 'form text',
    html: '<form><fieldset><legend>Profile</legend><label>Name <input value="secret"></label> <select><option>One</option></select> <button>Save</button></fieldset></form>',
    readable: 'Profile\n\nName One Save',
    compact: 'Profile Name One Save',
  },
];
```

Add fixtures for all headings, sections/articles/divisions, `br`, `hr`, nested blockquotes, ordered `start`/`value` validation, table rows/cells, inline code, textarea mode, empty blocks, leading/trailing whitespace, and more than two newlines.

- [ ] **Step 2: Run readability tests and observe flat output failures**

Run: `pnpm run build && node --test test/v3/readability.test.js`

Expected: FAIL because block/list/table semantics are not formatted yet.

- [ ] **Step 3: Implement the event-driven formatter policy**

Use a small state machine, not post-processing over the complete output. `ReaderFormatter` must expose:

```ts
export class ReaderFormatter {
  constructor(config: ValidatedConfig, emit: (chunk: string) => void);
  text(value: string, mode: 'normal' | 'pre'): void;
  start(tag: SemanticTag, attributes: SelectedAttributes): void;
  end(tag: SemanticTag): void;
  finish(): void;
}
```

Maintain only pending normal whitespace, requested line-break strength (`0`, `1`, or `2`), line-start state, quote depth, list frames, table row/cell state, pre depth, and the <=4,096-code-unit pending output. Apply prefixes at line start, coalesce ordinary newlines to two, suppress whitespace around empty blocks, omit one initial LF in `<pre>`, and split output chunks only at surrogate-safe boundaries.

List frames store `{ kind, next, indent }`; parse `start` and `value` as non-negative safe integers and ignore invalid values. Each ordered item consumes the current number and increments safely. Blockquote prefixes are generated per non-empty line and never retained as rewritten full lines. Table cells request a tab only after a previous cell in the same row; rows request one newline.

In compact mode, all formatter requests collapse to one pending space. Pre, table, list, and quote characters pass through the same collapse path rather than retaining line structure.

- [ ] **Step 4: Run golden tests and existing scanner/entity tests**

Run: `pnpm run build && node --test test/v3/api.test.js test/v3/entities.test.js test/v3/scanner.test.js test/v3/readability.test.js`

Expected: PASS for every readable and compact fixture.

- [ ] **Step 5: Record the Task 4 checkpoint**

With exact commit approval only:

```bash
git add src/policy.ts src/scanner.ts src/formatter.ts test/v3/readability.test.js test/v3/fixtures/readability.js
git commit -m "feat: format readable document structure"
```

---

### Task 5: Special elements, dropped bodies, head, and fallback text

**Files:**
- Create: `test/v3/special-elements.test.js`
- Modify: `src/policy.ts`
- Modify: `src/scanner.ts`
- Modify: `src/formatter.ts`
- Modify: `src/session.ts`

**Interfaces:**
- Consumes: scanner state machine, structural recovery, and formatter pre/RCDATA modes.
- Produces: the complete body/special-element policy and `droppedContainers` counts.

- [ ] **Step 1: Write failing special-element fixtures**

Cover the approved distinctions exactly:

```js
test('drops source and non-reader bodies', () => {
  assert.equal(toText('<script/>alert(1)</script><p>Keep</p>'), 'Keep');
  assert.equal(toText('<style>.x{color:red}</style><p>Keep</p>'), 'Keep');
  assert.equal(toText('<iframe>fallback</iframe><template><p>hidden</p></template>Keep'), 'Keep');
  assert.equal(toText('<svg><text>foreign</text></svg><math><mi>x</mi></math>Keep'), 'Keep');
});

test('preserves selected fallback and control text', () => {
  assert.equal(toText('<object><p>Object fallback</p></object>'), 'Object fallback');
  assert.equal(toText('<canvas>Canvas fallback</canvas> <video>Video fallback</video>'), 'Canvas fallback Video fallback');
  assert.equal(toText('<textarea>A&amp;B\nC</textarea>'), 'A&B\nC');
  assert.equal(toText('<xmp>A&amp;B\n C</xmp>'), 'A&amp;B\n C');
});

test('plaintext consumes through EOF', () => {
  assert.equal(toText('A<plaintext><b>B</b>&amp;</plaintext>C'), 'A\n\n<b>B</b>&amp;</plaintext>C');
});

test('malformed head exits on reader content', () => {
  assert.equal(toText('<head><title>Meta</title><meta name=x><body><h1>Reader</h1>'), 'Reader');
  assert.equal(toText('<head>Reader text<p>Body</p>'), 'Reader text\n\nBody');
});
```

Add cases for `noscript`, `noembed`, `noframes`, `applet`, `frameset`, nested template, raw closing tags split across chunks, same-name raw start tags, missing raw close at EOF, and dropped-container counts from `convert`.

- [ ] **Step 2: Run special-element tests and confirm body leakage**

Run: `pnpm run build && node --test test/v3/special-elements.test.js`

Expected: FAIL with script/style/template body text in output.

- [ ] **Step 3: Implement state-specific omission and preservation**

Add `RCDATA`, `RAWTEXT`, `ScriptData`, `PLAINTEXT`, `Head`, and `OrdinaryDrop` scanner modes. Only the appropriate ASCII-case-insensitive end-tag sequence exits each raw state; another same-name start string is text. `script` uses its own script-data end detection, while `style`, `iframe`, `noembed`, `noframes`, and scripting-enabled `noscript` use RAWTEXT omission. `title` uses RCDATA omission. `textarea` uses decoded RCDATA preservation, `xmp` uses undecoded RAWTEXT preservation, and `plaintext` preserves undecoded preformatted input through bounded EOF.

For `template`, `applet`, `frameset`, anchor `drop` mode, SVG, and MathML, use explicit lexical same-root nesting within the configured depth; mismatched ends do not close omission. Increment a fixed-name, null-prototype counter at the start of every dropped root. Never retain arbitrary foreign tag names.

Implement `Head` so whitespace and recognized metadata are omitted; `</head>` and `<body>` exit it; the first non-whitespace text or ordinary reader start tag exits and is reprocessed. Treat `html` and `body` as transparent wrappers. Preserve form/fieldset/legend/label/button/select/option text and object/canvas/audio/video fallback; void controls never expose values/placeholders.

- [ ] **Step 4: Verify raw states, counts, and prior readability**

Run: `pnpm run build && node --test test/v3/scanner.test.js test/v3/readability.test.js test/v3/special-elements.test.js`

Expected: PASS with no dropped body leakage.

- [ ] **Step 5: Record the Task 5 checkpoint**

With exact commit approval only:

```bash
git add src test/v3/special-elements.test.js
git commit -m "feat: define special element extraction policy"
```

---

### Task 6: Links, images, selected attributes, and display URLs

**Files:**
- Create: `test/v3/links-images.test.js`
- Modify: `src/contracts.ts`
- Modify: `src/config.ts`
- Modify: `src/entities.ts`
- Modify: `src/policy.ts`
- Modify: `src/scanner.ts`
- Modify: `src/formatter.ts`

**Interfaces:**
- Consumes: attribute-context entity decoding and aggregate token retention.
- Produces: `label`, `label-and-url`, `drop`, `alt`, and URL display behavior.

- [ ] **Step 1: Write failing link/image and URL-policy tests**

```js
test('applies link modes', () => {
  const html = '<a href="https://example.com/a?x=1&amp;y=2">Docs</a>';
  assert.equal(toText(html), 'Docs');
  assert.equal(toText(html, { links: 'label-and-url' }), 'Docs [https://example.com/a?x=1&y=2]');
  assert.equal(toText(html, { links: 'drop' }), '');
});

test('resolves only accepted display destinations', () => {
  assert.equal(toText('<a href="/guide">Guide</a>', {
    links: 'label-and-url',
    baseUrl: 'https://example.com/docs/',
  }), 'Guide [https://example.com/guide]');
  assert.equal(toText('<a href="javascript:alert(1)">Bad</a>', { links: 'label-and-url' }), 'Bad');
  assert.equal(toText('<a href="//evil.test/x">Bad</a>', { links: 'label-and-url' }), 'Bad');
  assert.equal(toText('<a href="https://u:p@example.com/">Bad</a>', { links: 'label-and-url' }), 'Bad');
});

test('emits only context-decoded image alt text', () => {
  assert.equal(toText('A<img alt="Tom &amp; Jerry" src="javascript:1">B'), 'A Tom & Jerry B');
  assert.equal(toText('A<img alt="ignored">B', { images: 'drop' }), 'A B');
  assert.equal(toText('<img alt="">'), '');
});

test('applies semicolonless attribute rules', () => {
  assert.equal(toText('<img alt="&copy=">'), '&copy=');
  assert.equal(toText('<img alt="&copy;=">'), '©=');
});
```

Add accepted `http:`, `https:`, `mailto:` fixtures, relative-without-base rejection, raw/decoded C0 and whitespace rejection, leading backslash rejection, mixed-case schemes, empty labels, nested malformed anchors, and a long label proving the label is not retained.

- [ ] **Step 2: Run the new tests and confirm attributes are ignored**

Run: `pnpm run build && node --test test/v3/links-images.test.js`

Expected: FAIL because selected attributes and close-time destinations are not implemented.

- [ ] **Step 3: Implement bounded selected-attribute handling**

Retain only `href`, `alt`, ordered-list `start`, and list-item `value`. Decode selected values after tokenization with `ReferenceContext = 'attribute'`. Charge decoded/raw retained strings to the aggregate token budget and release them when emitted, rejected, or their frame closes.

Implement this exact URL display function:

```ts
export function displayUrl(raw: string, baseUrl: URL | null): string | null;
```

It must reject raw or decoded C0 controls, ASCII whitespace inside a scheme, `//` protocol-relative input, leading `\`, invalid parses, non-HTTP(S)/mailto schemes, and non-empty username/password. Resolve relatives only with the already-validated HTTP(S) base. Return `url.href` for accepted destinations. The value is display text only.

Store accepted destinations on open anchor frames. In `label-and-url`, append ` [URL]` at close without retaining the label. In `drop`, enter bounded ordinary omission for the entire anchor. Emit non-empty alt at image position with formatter-controlled separation; never retain or emit image URLs.

- [ ] **Step 4: Verify every policy mode and attribute context**

Run: `pnpm run build && node --test test/v3/entities.test.js test/v3/readability.test.js test/v3/links-images.test.js`

Expected: PASS.

- [ ] **Step 5: Record the Task 6 checkpoint**

With exact commit approval only:

```bash
git add src test/v3/links-images.test.js
git commit -m "feat: add bounded link and image policies"
```

---

### Task 7: Complete resource limits, errors, and one-shot truncation

**Files:**
- Create: `test/v3/limits.test.js`
- Modify: `src/contracts.ts`
- Modify: `src/config.ts`
- Modify: `src/scanner.ts`
- Modify: `src/formatter.ts`
- Modify: `src/session.ts`
- Modify: `src/api.ts`

**Interfaces:**
- Consumes: every externally controlled allocation site in the scanner/formatter.
- Produces: deterministic `PurifaiLimitError` and `ConversionResult` semantics for all four limits.

- [ ] **Step 1: Write failing limit and truncation tests**

Use table-driven tests for input, output, depth, and aggregate token retention:

```js
test('throws deterministic errors from toText', () => {
  assert.throws(
    () => toText('12345', { limits: { input: 4 } }),
    (error) => error instanceof PurifaiLimitError
      && error.kind === 'input'
      && error.limit === 4
      && error.observed === 5,
  );
  assert.throws(
    () => toText('<div><div>x</div></div>', { limits: { depth: 1 } }),
    (error) => error.kind === 'depth' && error.observed === 2,
  );
});

test('convert truncates only when explicitly requested', () => {
  assert.deepEqual(convert('12345', {
    limits: { output: 4 },
    overflow: 'truncate',
  }), {
    text: '1234',
    truncatedBy: 'output',
    scanComplete: false,
    consumedInputCodeUnits: 5,
    outputCodeUnits: 4,
    droppedContainers: Object.freeze(Object.create(null)),
  });
});

test('never cuts an emitted surrogate pair', () => {
  assert.equal(convert('A😀B', {
    limits: { output: 2 },
    overflow: 'truncate',
  }).text, 'A');
});
```

Add exact tests for zero limits, invalid limits, incomplete quoted attributes, many live href values exhausting the aggregate token budget, comments/tags crossing chunks, output boundaries around pending whitespace/newlines, report freezing, and first-limit-wins behavior.

- [ ] **Step 2: Run limit tests and confirm depth/token gaps**

Run: `pnpm run build && node --test test/v3/limits.test.js`

Expected: FAIL on depth/token and exact truncation reports.

- [ ] **Step 3: Centralize all resource accounting in the session**

Implement these session hooks and make scanner/formatter call them before growing state:

```ts
consumeInput(nextTotal: number): void;
chargeOutput(candidateUnits: number): void;
pushDepth(): void;
popDepth(count: number): void;
retainToken(units: number): void;
releaseToken(units: number): void;
```

Each first disallowed value is `limit + 1` and is independent of chunk size. In throw mode, construct one `PurifaiLimitError`, abort processing, and propagate that object unchanged. In truncate mode, throw a private non-exported `StopConversion` sentinel inside the engine, catch it only in `convert`, discard incomplete token/layout suffixes, finalize the surrogate-safe emitted prefix, set `truncatedBy`, and set `scanComplete` false. Do not let `toText` or the stream select truncate mode.

Reports use logical scanner consumption, not the size of the last caller-owned chunk. Freeze both the null-prototype `droppedContainers` object and outer report/result. Output charging includes formatter-generated prefixes, brackets, tabs, spaces, and newlines.

- [ ] **Step 4: Run focused limits and the accumulated unit suite**

Run: `pnpm run typecheck && pnpm run build && node --test test/v3/api.test.js test/v3/entities.test.js test/v3/scanner.test.js test/v3/readability.test.js test/v3/special-elements.test.js test/v3/links-images.test.js test/v3/limits.test.js`

Expected: PASS.

- [ ] **Step 5: Record the Task 7 checkpoint**

With exact commit approval only:

```bash
git add src test/v3/limits.test.js
git commit -m "feat: enforce observable conversion limits"
```

---

### Task 8: Native Web TransformStream and chunk invariance

**Files:**
- Create: `test/v3/helpers/chunks.js`
- Create: `test/v3/stream.test.js`
- Modify: `src/session.ts`
- Modify: `src/api.ts`

**Interfaces:**
- Consumes: incremental `ConversionSession.write/finish` and frozen reports.
- Produces: the final `createTextTransform(options?: ToTextOptions): PurifaiTextTransform` contract.

- [ ] **Step 1: Write failing stream lifecycle and partition tests**

Create helpers for one-unit chunks, every split for short strings, fixed sizes, and seeded random partitions. Test this reusable assertion:

```js
async function assertChunkInvariant(html, options, partitions) {
  const expected = convert(html, options);
  for (const chunks of partitions) {
    const transform = createTextTransform(options);
    const output = [];
    const reader = transform.readable.getReader();
    const writer = transform.writable.getWriter();
    const reading = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        output.push(value);
      }
    })();
    for (const chunk of chunks) await writer.write(chunk);
    await writer.close();
    await reading;
    assert.equal(output.join(''), expected.text);
    assert.deepEqual(await transform.result, {
      truncatedBy: null,
      scanComplete: true,
      consumedInputCodeUnits: expected.consumedInputCodeUnits,
      outputCodeUnits: expected.outputCodeUnits,
      droppedContainers: expected.droppedContainers,
    });
  }
}
```

Exercise splits inside CRLF, surrogate pairs, named/numeric references, tag names, end tags, quotes, comments, raw closing tags, and plaintext. Add non-string chunk failure, result-promise timing, cancellation, and overflow tests proving both stream sides and `result` reject with the same error object.

- [ ] **Step 2: Run stream tests and expose chunk-dependent behavior**

Run: `pnpm run build && node --test test/v3/stream.test.js`

Expected: FAIL if any Task 1 stream shortcut or scanner tail handling differs from one-shot.

- [ ] **Step 3: Finalize the native transform adapter**

Construct one `TransformStream<string, string>` around one session. `transform` validates the chunk and calls `session.write`; `flush` calls `session.finish` and resolves the report. Wrap both callbacks so one captured error rejects `result` and is rethrown to let the native stream error both sides. Do not call `controller.terminate()` for resource limits and do not accept an `overflow` option.

Attach `result` using:

```ts
Object.defineProperty(stream, 'result', {
  configurable: false,
  enumerable: false,
  writable: false,
  value: resultPromise,
});
```

The session emitter calls `controller.enqueue` only with completed <=4,096-unit chunks. Never concatenate the full input or output in the adapter. Preserve a pending high surrogate and CR only in charged session state when the next chunk is required to decide output.

- [ ] **Step 4: Run all partition strategies and full entity split tests**

Run: `pnpm run build && node --test test/v3/stream.test.js test/v3/entities-exhaustive.test.js`

Expected: PASS with identical joined output, reports, and thrown error fields for all partitions.

- [ ] **Step 5: Record the Task 8 checkpoint**

With exact commit approval only:

```bash
git add src/api.ts src/session.ts test/v3/helpers/chunks.js test/v3/stream.test.js
git commit -m "feat: add chunk-invariant web streaming"
```

---

### Task 9: Deterministic fuzzing and supported-sink security regression

**Files:**
- Create: `test/v3/fixtures/security-vectors.js`
- Create: `test/v3/fuzz.test.js`
- Create: `test/v3/sinks.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: only the built public v3 artifact.
- Produces: regression evidence for termination, determinism, bounds, supported sinks, and corpus harness validity.

- [ ] **Step 1: Port the corpus and write failing property harnesses**

Copy attack payload data from `test/vectors.js` into `test/v3/fixtures/security-vectors.js`, preserving attribution comments but removing v2 expectations such as “output must be empty” or “attack words must disappear.”

The fuzz suite must use a fixed Mulberry32 seed and assert for 10,000 generated strings:

```text
1. toText(string) either returns a string or throws only PurifaiLimitError.
2. Repeating conversion produces identical output and report.
3. One-unit streaming equals one-shot output or the same limit error fields.
4. Output never ends with an unpaired high surrogate.
5. Every resolved report satisfies input/output bounds and frozen metadata.
6. Malformed tags, comments, attributes, entities, raw states, and depth families terminate.
```

The sink test must insert `toText(input)` with `textContent`, insert `escapeHtmlText(toText(input))` with `innerHTML`, serialize/reparse, and inspect for script nodes, `on*` attributes, `srcdoc`, meta refresh, and executable URL protocols. An unsanitized `<img src=x onerror="globalThis.__purifaiControl=1">` positive control must be detected by the structural detector; fail the harness if it is not.

- [ ] **Step 2: Run the new fuzz and sink tests**

Run: `pnpm run build && node --test test/v3/fuzz.test.js test/v3/sinks.test.js`

Expected: expose any malformed recovery, partition, or sink regressions; the task is not complete until the seeded run passes without filtering failures.

- [ ] **Step 3: Fix only engine defects revealed by named reproductions**

For every failing generated case, add a named minimal regression to the closest focused test before changing runtime code. Keep the generator seed/case index in the test name. Corrections must preserve the documented grammar; do not add keyword deletion, protocol scanning of ordinary text, full-input regex replacements, or DOM parsing.

Add scripts:

```json
{
  "test:fuzz": "pnpm run build && node --test test/v3/fuzz.test.js",
  "test:sinks": "pnpm run build && node --test test/v3/sinks.test.js"
}
```

- [ ] **Step 4: Run focused regressions plus the deterministic suites**

Run: `pnpm run test:fuzz`

Expected: PASS for seed `20260802` and 10,000 inputs.

Run: `pnpm run test:sinks`

Expected: PASS with a working positive control and zero supported-sink structural findings.

- [ ] **Step 5: Record the Task 9 checkpoint**

With exact commit approval only:

```bash
git add package.json pnpm-lock.yaml src test/v3/fuzz.test.js test/v3/sinks.test.js test/v3/fixtures/security-vectors.js
git commit -m "test: harden v3 against malformed hostile input"
```

---

### Task 10: Core package integration and legacy test retirement

**Files:**
- Create: `test/types/public-api.ts`
- Create: `test/package-smoke.mjs`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `tsconfig.dts.json`
- Delete: `test/comprehensive-test.js`
- Delete: `test/fair-benchmark.js`
- Delete: `test/fuzz-test.js`
- Delete: `test/regression-test.js`
- Delete: `test/security-test.js`
- Delete: `test/verify-performance.js`
- Delete: `test/browser-verify.html`
- Delete: `test/browser-verify.js`
- Delete: `test/vectors.js`

**Interfaces:**
- Consumes: the complete core public API and built package artifact.
- Produces: a coherent v3-only core test/build workflow ready for release qualification.

- [ ] **Step 1: Write compile-time and packed-package smoke tests**

`test/types/public-api.ts` must compile valid calls for every public function/type and use `@ts-expect-error` for v2 imports, non-string input, invalid enums, and streaming `overflow`. It must assert `createTextTransform()` is assignable to `TransformStream<string, string>` and `result` is `Promise<ConversionReport>`.

`test/package-smoke.mjs` must run `pnpm pack --pack-destination <temporary-directory>`, extract the tarball into that temporary directory, inspect the packed `package.json` for zero `dependencies`, import ESM, require CommonJS with `createRequire`, compare both export-key sets, run `toText` and a stream through both entrypoints, and verify no source/test/vendor files are packed.

- [ ] **Step 2: Run the smoke tests before retiring legacy scripts**

Run: `pnpm run build && pnpm run typecheck && node test/package-smoke.mjs`

Expected: PASS for ESM, CommonJS, declarations, and packed contents.

- [ ] **Step 3: Replace the v2 test workflow with the v3 core workflow**

Remove only the listed v2 scripts after their payload data has been preserved in the v3 fixtures. Set scripts to:

```json
{
  "test:unit": "pnpm run build && node --test test/v3/api.test.js test/v3/entities.test.js test/v3/entities-exhaustive.test.js test/v3/scanner.test.js test/v3/readability.test.js test/v3/special-elements.test.js test/v3/links-images.test.js test/v3/limits.test.js test/v3/stream.test.js",
  "test:core": "pnpm run entities:check && pnpm run typecheck && pnpm run test:unit && pnpm run test:fuzz && pnpm run test:sinks && node test/package-smoke.mjs",
  "test": "pnpm run test:core",
  "prepublishOnly": "pnpm run test:core"
}
```

Keep jsdom as a dev dependency for the sink oracle. Remove `chalk`, `cli-table3`, `isomorphic-dompurify`, `sanitize-html`, `xss`, and `playwright-core` only if no remaining core or release-plan file imports them; competitor/browser dependencies are reintroduced deliberately in the release-qualification plan.

- [ ] **Step 4: Run the complete core gate from a clean build**

Run: `pnpm run test:core`

Expected: exit 0; generated entities unchanged; strict typecheck passes; all unit, entity, partition, fuzz, sink, ESM, CommonJS, declaration, and package-content checks pass.

Run: `git diff --check`

Expected: exit 0 with no whitespace errors.

- [ ] **Step 5: Record the core-plan checkpoint**

With exact commit approval only:

```bash
git add index.ts package.json pnpm-lock.yaml tsconfig.json tsconfig.dts.json src scripts vendor test
git commit -m "feat: complete purifai v3 core converter"
```

The core is now working and independently testable. Continue with `docs/superpowers/plans/2026-08-02-purifai-v3-release-qualification.md` before making any release claim.
