# Purifai v3 Release Qualification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the completed v3 core earns its narrow category claim across browsers, edge/server runtimes, hostile-input benchmarks, resource gates, package size, documentation, and release provenance.

**Architecture:** Qualification runs only against the built and packed public artifact. Separate harnesses exercise real browser engines, Node/Bun/Deno consumers, Cloudflare's workerd-based Vitest pool, isolated benchmark processes, and deterministic artifact checks; one release command composes the gates without putting DOM or runtime-specific code into Purifai itself.

**Tech Stack:** pnpm 11, Node 22/24/26, Bun, Deno, Playwright, Vitest 4.1+, `@cloudflare/vitest-pool-workers`, GitHub Actions v6, native Node profiling/resource APIs, npm provenance.

## Global Constraints

- Complete `docs/superpowers/plans/2026-08-02-purifai-v3-core.md` first; this plan consumes its passing `pnpm run test:core` gate.
- The design and acceptance contract remains `docs/superpowers/specs/2026-08-02-purifai-v3-design.md`.
- Benchmark rivals are pinned to stable `striptags@3.2.0` and `html-to-text@10.0.0`; reports include exact versions and environment facts.
- The throughput gate compares already-materialized hostile strings one-shot against one-shot.
- The memory gate compares each package's best documented ingestion path end to end and separately reports Purifai one-shot memory.
- Browser security verification covers Chromium, Firefox, and WebKit and requires a working positive control in every engine.
- The same packed ESM artifact must run in Node, Bun, Deno, Cloudflare Workers, Chromium, Firefox, and WebKit without a DOM or Node shim in runtime code.
- The complete minified ESM runtime, including generated entity data, must be at most 25 KiB (`25 * 1024` bytes) under gzip level 9; below 20 KiB is reported as a stretch result only.
- Claims remain category-specific: never publish “most secure,” “100% secure,” “bulletproof,” or an uncategorized “fastest.”
- No runtime dependencies may be added. Test/benchmark tools are dev dependencies and must not appear in the packed `dependencies` field.
- Preserve user changes and stay on the current branch.
- Every commit step is conditional: touch the Git index/history only after exact user approval for that command. Publishing, pushing, tagging, and creating a GitHub release each require separate explicit authorization and are not implied by this plan.
- Use `apply_patch` for hand edits; generated reports may be mechanically rewritten by their scripts.

## File Structure

- `test/browser/harness.html` — isolated browser host page.
- `test/browser/harness.js` — corpus runner and execution/structure detector.
- `test/browser/run.mjs` — packed-artifact server and Playwright three-engine runner.
- `test/runtime/consumer.mjs` — runtime-neutral ESM assertions.
- `test/runtime/consumer.cjs` — CommonJS assertions for Node/Bun.
- `test/runtime/cloudflare.test.js` — workerd public-artifact assertions.
- `test/runtime/worker-stub.js` — minimal Worker module required by the official pool configuration.
- `test/runtime/wrangler.jsonc` — compatibility date with no Node compatibility flags.
- `vitest.worker.config.js` — Cloudflare Workers pool and packed-artifact alias.
- `scripts/with-packed-package.mjs` — temporary tarball extraction and child-command helper.
- `scripts/test-runtimes.mjs` — local Node/Bun/Deno packed-consumer orchestrator.
- `scripts/test-cloudflare.mjs` — packed Worker test orchestrator.
- `benchmark/corpus.mjs` — fixed benign and hostile logical documents.
- `benchmark/worker.mjs` — isolated operation/memory worker.
- `benchmark/run.mjs` — warmup, sampling, aggregation, and gate enforcement.
- `benchmark/report.mjs` — deterministic JSON/Markdown report writer.
- `benchmark/results/v3.json` — machine-readable pinned results.
- `docs/benchmarks/v3.md` — human-readable methodology/results.
- `scripts/verify-size.mjs` — gzip, package, import, and retained-heap measurements.
- `scripts/verify-scaling.mjs` — malformed-input time/memory scaling gates.
- `scripts/verify-release.mjs` — composed prepublish/postpublish verifier.
- `test/types/public-api.ts` — final doc/API compile examples.
- `docs/migration-v3.md` — intentional v2-to-v3 breaking migration.
- `.github/workflows/ci.yml` — core, runtime, browser, Worker, size, and benchmark jobs.
- `.github/workflows/release.yml` — protected npm trusted-publishing workflow.

---

### Task 1: Packed-artifact runtime fixture and Node/Bun/Deno consumers

**Files:**
- Create: `scripts/with-packed-package.mjs`
- Create: `scripts/test-runtimes.mjs`
- Create: `test/runtime/consumer.mjs`
- Create: `test/runtime/consumer.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `pnpm pack` output from the passing v3 core.
- Produces: repeatable ESM/CommonJS consumer tests that never import repository source paths.

- [ ] **Step 1: Write the runtime-neutral consumer assertions**

`test/runtime/consumer.mjs` must import from the bare package name and test plain, malformed, entity, limit, and streaming paths:

```js
import {
  PurifaiLimitError,
  convert,
  createTextTransform,
  escapeHtmlText,
  toText,
} from 'purifai';

function equal(actual, expected) {
  if (!Object.is(actual, expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

equal(toText('<h2>Runtime</h2><p>A&amp;B</p>'), 'Runtime\n\nA&B');
equal(convert('<script>x</script>Keep').text, 'Keep');
equal(escapeHtmlText('<&>'), '&lt;&amp;&gt;');
let limitError;
try {
  toText('123', { limits: { input: 2 } });
} catch (error) {
  limitError = error;
}
if (!(limitError instanceof PurifaiLimitError) || limitError.observed !== 3) {
  throw new Error('expected deterministic PurifaiLimitError');
}

const transform = createTextTransform();
const output = [];
await new ReadableStream({
  start(controller) {
    controller.enqueue('<p>Run');
    controller.enqueue('time</p>');
    controller.close();
  },
}).pipeThrough(transform).pipeTo(new WritableStream({
  write(chunk) {
    output.push(chunk);
  },
}));
equal(output.join(''), 'Runtime');
equal((await transform.result).scanComplete, true);
```

`test/runtime/consumer.cjs` must `require('purifai')`, assert the same runtime value keys as ESM, run `toText`, and stream with the global `ReadableStream`/`WritableStream`.

- [ ] **Step 2: Run the missing orchestrator and confirm the harness is not present**

Run: `node scripts/test-runtimes.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/test-runtimes.mjs`.

- [ ] **Step 3: Implement safe temporary packed-package orchestration**

`scripts/with-packed-package.mjs` must use `fs.promises.mkdtemp(path.join(os.tmpdir(), 'purifai-packed-'))`, run `pnpm pack --pack-destination <temp>`, reject zero/multiple tarballs, write a private fixture `package.json` with `type: "module"`, and install the local tarball with `pnpm add --dir <temp> --offline <absolute-tarball-path>`. Copy the two consumer files beside that `node_modules`, expose a `runPacked(command, args, options)` helper, inspect the installed package manifest before any consumer command, and remove only its exact validated temp directory in `finally`.

`scripts/test-runtimes.mjs` must:

```text
1. Always run Node ESM and CommonJS consumers.
2. Run Bun ESM and CommonJS when `bun --version` succeeds; otherwise fail unless PURIFAI_ALLOW_MISSING_RUNTIMES=1.
3. Run Deno ESM with `deno run --allow-read --node-modules-dir=manual`; otherwise use the same explicit missing-runtime rule.
4. Print exact runtime versions and one PASS/FAIL row per module system.
5. Forward nonzero exit codes without rewriting output.
```

Add `"test:runtimes": "pnpm run build && node scripts/test-runtimes.mjs"`.

- [ ] **Step 4: Run every locally available runtime consumer**

Run: `pnpm run test:runtimes`

Expected: PASS on Node plus installed Bun/Deno. Missing runtimes are a failure unless the explicit local-only environment flag is set; CI in Task 6 may not set it.

- [ ] **Step 5: Record the Task 1 checkpoint**

With exact commit approval only:

```bash
git add package.json pnpm-lock.yaml scripts/with-packed-package.mjs scripts/test-runtimes.mjs test/runtime/consumer.mjs test/runtime/consumer.cjs
git commit -m "test: verify packed runtime consumers"
```

---

### Task 2: Cloudflare Workers packed-artifact test

**Files:**
- Create: `test/runtime/cloudflare.test.js`
- Create: `test/runtime/worker-stub.js`
- Create: `test/runtime/wrangler.jsonc`
- Create: `vitest.worker.config.js`
- Create: `scripts/test-cloudflare.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: the packed ESM path exposed by `withPackedPackage`.
- Produces: a workerd-backed test using Cloudflare's official Vitest pool.

- [ ] **Step 1: Write a failing Worker-runtime test**

Create `test/runtime/cloudflare.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { createTextTransform, toText } from 'purifai-packed';

describe('packed Purifai in workerd', () => {
  it('converts without DOM or Node globals', async () => {
    expect(typeof globalThis.document).toBe('undefined');
    expect(toText('<h1>Edge</h1><script>x</script><p>Ready</p>'))
      .toBe('Edge\n\nReady');

    const transform = createTextTransform();
    const encoded = new ReadableStream({
      start(controller) {
        controller.enqueue('<p>A&amp;');
        controller.enqueue('B</p>');
        controller.close();
      },
    }).pipeThrough(transform).pipeThrough(new TextEncoderStream());
    const response = new Response(encoded);
    expect(await response.text()).toBe('A&B');
    expect((await transform.result).scanComplete).toBe(true);
  });
});
```

- [ ] **Step 2: Install the official Worker test tools and confirm unresolved alias failure**

Run: `pnpm add -D vitest@^4.1.0 @cloudflare/vitest-pool-workers`

Expected: package and lockfile update; runtime `dependencies` remains absent.

Run: `pnpm exec vitest run --config vitest.worker.config.js`

Expected: FAIL until the packed alias environment variable is supplied by the orchestrator.

- [ ] **Step 3: Configure the Worker pool and packed alias**

Create `test/runtime/worker-stub.js`:

```js
export default {
  fetch() {
    return new Response('purifai worker fixture');
  },
};
```

Create `test/runtime/wrangler.jsonc` with no Node compatibility flags:

```json
{
  "name": "purifai-runtime-test",
  "main": "./worker-stub.js",
  "compatibility_date": "2026-08-02"
}
```

`vitest.worker.config.js` must require `PURIFAI_PACKED_ESM`, resolve it to an absolute file, and use Cloudflare's current Vitest 4 plugin:

```js
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const packedInput = process.env.PURIFAI_PACKED_ESM;
if (!packedInput) {
  throw new Error('PURIFAI_PACKED_ESM is required');
}
const packedEsm = path.resolve(packedInput);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './test/runtime/wrangler.jsonc' },
    }),
  ],
  resolve: {
    alias: {
      'purifai-packed': packedEsm,
    },
  },
  server: {
    fs: {
      allow: [path.dirname(packedEsm)],
    },
  },
  test: {
    include: ['test/runtime/cloudflare.test.js'],
    fileParallelism: false,
  },
});
```

`scripts/test-cloudflare.mjs` must use the temporary packed helper, set the alias to the extracted `dist/index.js`, run `pnpm exec vitest run --config vitest.worker.config.js`, and clean the fixture. Add `"test:cloudflare": "pnpm run build && node scripts/test-cloudflare.mjs"`.

- [ ] **Step 4: Run the workerd test**

Run: `pnpm run test:cloudflare`

Expected: PASS in the official Cloudflare Workers Vitest pool with no Node compatibility flag.

- [ ] **Step 5: Record the Task 2 checkpoint**

With exact commit approval only:

```bash
git add package.json pnpm-lock.yaml scripts/test-cloudflare.mjs test/runtime/cloudflare.test.js test/runtime/worker-stub.js test/runtime/wrangler.jsonc vitest.worker.config.js
git commit -m "test: qualify purifai in cloudflare workers"
```

---

### Task 3: Chromium, Firefox, and WebKit sink/runtime matrix

**Files:**
- Create: `test/browser/harness.html`
- Create: `test/browser/harness.js`
- Create: `test/browser/run.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: packed ESM artifact and v3 security/readability fixtures.
- Produces: real-engine conversion, chunk, supported-sink, and positive-control results for three browser engines.

- [ ] **Step 1: Build the browser harness contract**

`harness.html` must load a module path injected by the local test server and expose one promise `globalThis.__purifaiBrowserResults`.

`harness.js` must run every curated vector twice:

```text
A. Assign toText(input) with node.textContent.
B. Assign escapeHtmlText(toText(input)) with node.innerHTML.
C. Serialize and reparse B in a detached HTML document.
D. Inspect B/C for script, iframe[srcdoc], meta refresh, on* attributes, and javascript:/vbscript:/data:text/html URLs.
E. Repeat conversion through one-code-unit TransformStream chunks and compare text.
```

For actual-execution calibration, create a sandboxed same-origin iframe with unsanitized `srcdoc` containing a script that posts a unique message to the parent. The message must arrive within 2 seconds in each engine. Sanitized/escaped variants must never post that message. Return structured failures rather than logging only prose.

- [ ] **Step 2: Install Playwright and confirm browsers are required**

Run: `pnpm add -D playwright@^1.62.0`

Remove the direct `playwright-core` dependency after imports move to `playwright`.

Run: `pnpm exec playwright install chromium firefox webkit`

Expected: all three pinned engine builds install; this network/download action requires approval when execution policy requests it.

- [ ] **Step 3: Implement the packed-artifact server and three-engine runner**

`test/browser/run.mjs` must use `withPackedPackage`, serve only the validated temp package plus browser fixture files from an ephemeral `127.0.0.1` port, send `Cache-Control: no-store` and correct MIME types, and prevent path traversal with resolved-path containment.

For each of `chromium`, `firefox`, and `webkit`, launch headless, load the harness, await the structured result with a 60-second timeout, and print:

```text
engine | artifact import | corpus | chunk invariance | textContent | escaped innerHTML | positive control
```

Any page error, failed positive control, structural finding, execution message, mismatch, or missing engine is a nonzero exit. Add `"test:browsers": "pnpm run build && node test/browser/run.mjs"`.

- [ ] **Step 4: Run all real engines**

Run: `pnpm run test:browsers`

Expected: PASS for Chromium, Firefox, and WebKit, including one firing positive control and zero findings per engine.

- [ ] **Step 5: Record the Task 3 checkpoint**

With exact commit approval only:

```bash
git add package.json pnpm-lock.yaml test/browser
git commit -m "test: verify v3 in three browser engines"
```

---

### Task 4: Reproducible category benchmark and enforced rival gates

**Files:**
- Create: `benchmark/corpus.mjs`
- Create: `benchmark/worker.mjs`
- Create: `benchmark/run.mjs`
- Create: `benchmark/report.mjs`
- Create: `benchmark/results/v3.json`
- Create: `docs/benchmarks/v3.md`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `purifai@3.0.0` built artifact, `striptags@3.2.0`, and `html-to-text@10.0.0`.
- Produces: pinned raw samples, aggregate metrics, human report, and hard release pass/fail.

- [ ] **Step 1: Define fixed corpora and benchmark result schema**

`benchmark/corpus.mjs` must export deterministic logical documents in these groups:

```text
readable-small: headings, paragraphs, links, lists, code, and simple table
readable-large: the small document repeated to 256 KiB
hostile-tags: long quoted attributes, malformed tags, and mismatched depth
hostile-comments: incomplete and repeated comment/declaration prefixes
hostile-entities: long ampersand/name/numeric prefixes and valid references
hostile-raw: script/style/template/iframe close-prefix adversaries
```

Each corpus record contains `name`, `category`, a small fixed `unit`, `repetitions`, `codeUnits`, `materialize()`, `chunks(maxCodeUnits)`, and the expected Purifai output digest. Do not store a large pre-materialized `html` string at module scope: one-shot workers call `materialize()`, while the streaming memory worker alone iterates `chunks(16_384)` so its source allocation remains genuinely lazy. Store no random input in the release benchmark.

Define JSON results with environment, exact package versions, corpus SHA-256, 10 warmups, 40 measured samples, per-sample nanoseconds, median, p95, max RSS, gzip/package bytes, and pass/fail reasons.

- [ ] **Step 2: Install pinned rivals and observe the ungated baseline**

Run: `pnpm add -D striptags@3.2.0 html-to-text@10.0.0`

Expected: exact rival versions in the lockfile and no runtime dependencies in Purifai's package manifest.

- [ ] **Step 3: Implement isolated throughput and memory workers**

`benchmark/worker.mjs` must select exactly one package/mode/corpus from CLI arguments. Throughput mode receives already-materialized strings, warms 10 batches, runs 40 measured batches sized to at least 50 ms, and writes raw `hrtime.bigint()` sample totals as JSON. Purifai uses `toText`; `html-to-text` uses its documented `convert`; stable `striptags` is reported but is not a throughput gate.

Memory mode runs in a fresh Node process with `--expose-gc`:

```text
purifai-stream: lazily generate <=16 KiB string chunks into createTextTransform
purifai-one-shot: materialize the same logical input and call toText
html-to-text: materialize the same logical input and call convert
```

Record start/end heap and `process.resourceUsage().maxRSS`; keep output consumed by a checksum sink so dead-code elimination or unconsumed backpressure cannot skew results.

`benchmark/run.mjs` must spawn isolated workers sequentially on Node 24 in the published CI environment, calculate median/p95 by nearest-rank, verify output digests, and enforce:

```text
Purifai exactly matches every reviewed readability fixture; stable striptags matches fewer fixtures.
Purifai removes every configured non-reader body fixture; stable striptags leaks at least the script-body calibration fixture.
Purifai hostile one-shot p95 < html-to-text hostile one-shot p95 for every hostile corpus.
Purifai streaming max RSS < html-to-text max RSS for readable-large and every hostile corpus.
Every readability fixture and configured body-removal fixture passes before timing begins.
```

If a performance gate fails, collect `node --prof` profiles for both implementations, process them with `node --prof-process`, make only correctness-preserving localized changes with focused regressions, and rerun the complete benchmark. Do not weaken corpora, sample counts, or correctness checks.

- [ ] **Step 4: Generate and verify the published report**

`benchmark/report.mjs` must write deterministic `benchmark/results/v3.json` and `docs/benchmarks/v3.md` with commands, hardware/OS/runtime facts, exact versions, methodology distinctions, raw-result link, medians/p95/RSS, and honest losses such as advanced table fidelity. Add:

```json
{
  "bench": "pnpm run build && node benchmark/run.mjs",
  "bench:check": "pnpm run build && node benchmark/run.mjs --check"
}
```

Run: `pnpm run bench`

Expected: PASS all category gates and rewrite both result files.

Run: `pnpm run bench:check`

Expected: PASS and confirm current measurements satisfy the saved gate schema without rewriting files.

- [ ] **Step 5: Record the Task 4 checkpoint**

With exact commit approval only:

```bash
git add package.json pnpm-lock.yaml benchmark docs/benchmarks/v3.md src test/v3
git commit -m "perf: establish reproducible v3 category benchmark"
```

---

### Task 5: Artifact size, cold import, and adversarial scaling gates

**Files:**
- Create: `scripts/verify-size.mjs`
- Create: `scripts/verify-scaling.mjs`
- Create: `test/v3/scaling.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: minified `dist/index.js`, generated entities, and hostile benchmark families.
- Produces: exact 25 KiB artifact enforcement and published linear-time/bounded-memory evidence.

- [ ] **Step 1: Write failing measurement assertions**

`test/v3/scaling.test.js` must call the measurement scripts as child processes and assert structured JSON contains:

```js
assert.equal(size.runtimeDependencies, 0);
assert.ok(size.esmGzipLevel9Bytes <= 25 * 1024);
assert.ok(size.entityDataIncluded);
assert.ok(scaling.maxTimeSlope <= 1.15);
assert.ok(scaling.maxStreamingRssGrowthBytes <= 8 * 1024 * 1024);
```

The test must fail on missing measurements; it may not replace missing values with zero.

- [ ] **Step 2: Run the test before measurement scripts exist**

Run: `pnpm run build && node --test test/v3/scaling.test.js`

Expected: FAIL because both verifier scripts are missing.

- [ ] **Step 3: Implement deterministic size and scaling measurement**

`scripts/verify-size.mjs` must:

```text
1. Read the complete minified dist/index.js produced by the normal build.
2. Confirm the generated entity sentinel and all public exports occur in the bundle.
3. Compress with node:zlib gzipSync({ level: 9 }) and enforce <=25,600 bytes.
4. Pack the package and report tarball plus unpacked runtime/declaration bytes.
5. Spawn 30 cold imports and report median/p95 milliseconds.
6. Spawn an import-only process with --expose-gc and report post-import retained heap.
7. Inspect packed package.json and fail if dependencies is nonempty.
```

`scripts/verify-scaling.mjs` must run isolated processes for hostile tags/comments/entities/raw at 32, 64, 128, 256, 512, and 1,024 KiB. For each size, take 15 post-warmup medians. Compute a Theil-Sen slope over `log2(codeUnits)`/`log2(nanoseconds)` and enforce maximum slope `1.15`. For streaming RSS, compare 256 KiB with 1,024 KiB lazy sources and enforce no more than 8 MiB growth. Also run exact default-limit probes before large configured-limit measurements.

Print JSON with all raw values and a human summary. Add:

```json
{
  "test:size": "pnpm run build && node scripts/verify-size.mjs",
  "test:scaling": "pnpm run build && node scripts/verify-scaling.mjs"
}
```

If the 25 KiB ceiling fails, first inspect the generated table encoding and duplicated policy strings. Optimize packed representation or dead-code structure without removing entity entries, validation, limits, or runtime behavior. If scaling fails, add the smallest reproducer to a unit test before changing scanner recovery.

- [ ] **Step 4: Run and record the resource gates**

Run: `pnpm run test:size`

Expected: PASS at or below 25,600 gzip bytes and report whether the <20 KiB stretch goal is met.

Run: `pnpm run test:scaling`

Expected: PASS slope/RSS gates for every hostile family.

Run: `node --test test/v3/scaling.test.js`

Expected: PASS using real non-missing measurements.

- [ ] **Step 5: Record the Task 5 checkpoint**

With exact commit approval only:

```bash
git add package.json scripts/verify-size.mjs scripts/verify-scaling.mjs test/v3/scaling.test.js src
git commit -m "test: enforce v3 size and scaling bounds"
```

---

### Task 6: Documentation, examples, migration, and typechecked copy

**Files:**
- Modify: `README.md`
- Create: `docs/migration-v3.md`
- Modify: `CONTRIBUTING.md`
- Modify: `examples/basic-usage.js`
- Modify: `examples/express-middleware.js`
- Modify: `examples/react-integration.jsx`
- Modify: `test/types/public-api.ts`
- Create: `test/docs.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: final public API, benchmark report, sink contract, and category decisions.
- Produces: truthful install/usage/decision/migration documentation whose executable examples are checked.

- [ ] **Step 1: Write documentation assertions before replacing v2 copy**

`test/docs.test.mjs` must read README/migration/examples and assert:

```text
README begins with the approved bounded-streaming proposition.
README contains textContent and escapeHtmlText examples before benchmark claims.
README links the saved benchmark and names exact rival versions.
README contains decision guidance for Purifai, html-to-text, striptags, DOMPurify, and sanitize-html.
README contains none of: Purifai.sanitize, analyze, isDangerous, sanitizeBatch, escapeAttribute, escapeUrl, 100% secure, bulletproof, most secure.
Migration maps every removed v2 export to a v3 replacement or explicit removal rationale.
Every local Markdown link resolves.
```

Run: `node test/docs.test.mjs`

Expected: FAIL on the v2 README and examples.

- [ ] **Step 2: Rewrite README positioning and API documentation**

Open with exactly:

```markdown
> Stream untrusted HTML into clean, readable text with bounded working memory.
> No DOM. No document tree. No runtime dependencies.
```

The first example must contrast script-body leakage from flat stripping with:

```ts
import { toText } from 'purifai';

const text = toText(
  '<script>alert(1)</script><h2>Release</h2><ul><li>Fast</li></ul>',
);
// Release
//
// - Fast
```

Immediately show supported sinks:

```ts
element.textContent = toText(untrustedHtml);
element.innerHTML = escapeHtmlText(toText(untrustedHtml));
```

Document all defaults/types, explicit `convert(html, { overflow: 'truncate' })`, native stream usage with `TextDecoderStream`, stream partial-output-on-error semantics, URL display limitations, special-element fidelity losses, 25 KiB method, benchmark method/results link, runtime matrix, and the exact competitor decision table from the design.

- [ ] **Step 3: Rewrite migration, contribution guidance, and examples**

`docs/migration-v3.md` must state there is no compatibility layer and include this mapping:

```text
Purifai.sanitize / sanitize -> toText
escape -> escapeHtmlText (HTML text context only)
analyze -> removed; use convert for conversion metadata
sanitizeBatch -> removed; map toText explicitly
isDangerous -> removed; Purifai does not classify intent
escapeAttribute / escapeUrl -> removed; use a context-specific library or platform API
getVersion / getStats -> removed; use package metadata and published benchmarks
aggressiveMode / allowedProtocols -> removed fixed policy
maxLength -> limits.input; overflow is explicit
```

Rewrite examples around one-shot server conversion, streaming a response body, React text rendering, and Express size/error handling. Never interpolate `toText` into an HTML string without `escapeHtmlText`. Update CONTRIBUTING to call this an HTML-to-readable-text converter and list the v3 core/release commands.

Copy every TypeScript README snippet into `test/types/public-api.ts` as compilable code or a type-equivalent function. Execute JavaScript examples in `test/docs.test.mjs` with controlled inputs and assertions.

- [ ] **Step 4: Verify documentation, links, examples, and types**

Run: `pnpm run typecheck && node test/docs.test.mjs`

Expected: PASS with no v2 API/copy and no broken local links.

Run: `pnpm run test:core`

Expected: PASS after documentation/example changes.

- [ ] **Step 5: Record the Task 6 checkpoint**

With exact commit approval only:

```bash
git add README.md CONTRIBUTING.md docs/migration-v3.md examples test/docs.test.mjs test/types/public-api.ts package.json
git commit -m "docs: position and document purifai v3"
```

---

### Task 7: CI, protected provenance release, and composed acceptance gate

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Create: `scripts/verify-release.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: every core and qualification command plus packed package metadata.
- Produces: reproducible CI evidence, a protected prepublish gate, and an explicitly authorized trusted-publishing path.

- [ ] **Step 1: Write the composed release verifier**

`scripts/verify-release.mjs` must spawn each command sequentially with inherited output and fail fast:

```text
pnpm run test:core
pnpm run test:runtimes
pnpm run test:cloudflare
pnpm run test:browsers
pnpm run test:size
pnpm run test:scaling
pnpm run bench:check
node test/docs.test.mjs
```

Before spawning, assert Node major is 24 for the canonical local benchmark environment. Accept `--ci-shard=<name>` only for CI job partitioning; plain execution runs every gate. Accept `--postpublish=3.0.0` to query npm and verify the published tarball digest/provenance subject resolves to the exact `GITHUB_SHA`; never publish from this script.

Add:

```json
{
  "test:release": "node scripts/verify-release.mjs",
  "prepublishOnly": "pnpm run test:release"
}
```

- [ ] **Step 2: Create least-privilege CI with current official actions**

`.github/workflows/ci.yml` must use `actions/checkout@v6`, `pnpm/action-setup@v6`, and `actions/setup-node@v6` with `cache: pnpm` and `permissions: { contents: read }`.

Define required jobs:

```text
core: Node [22, 24, 26], pnpm install --frozen-lockfile, test:core
runtimes: Node 24 plus official Bun and Deno setup, test:runtimes
worker: Node 24, test:cloudflare
browsers: Node 24, install Playwright chromium/firefox/webkit with dependencies, test:browsers
resource: ubuntu-24.04 and Node 24, test:size + test:scaling
benchmark: ubuntu-24.04 and Node 24, bench:check, upload raw JSON artifact
```

Do not set Node compatibility for Worker tests. Upload Playwright traces only on failure and benchmark JSON always. Concurrency may cancel older pull-request runs but not tag/release runs.

- [ ] **Step 3: Create the trusted-publishing workflow without publishing**

`.github/workflows/release.yml` must trigger only on `v*` tags and `workflow_dispatch`, use a protected `npm` environment, `permissions: { contents: read, id-token: write }`, install with the frozen lockfile on Node 24, verify the tag equals `v${package.version}`, run `pnpm run test:release`, run `npm publish --access public --provenance`, then run `node scripts/verify-release.mjs --postpublish=${version}`.

Do not create/push a tag, invoke the workflow, publish, or modify npm trusted-publisher settings during implementation. Those are external state changes requiring separate explicit user authorization after local/CI evidence is reviewed.

- [ ] **Step 4: Run the complete local release gate and inspect the packed artifact**

Run: `pnpm run test:release`

Expected: PASS every locally installed runtime/browser, core, Worker, size, scaling, benchmark, and documentation gate with no skipped category.

Run: `pnpm pack --dry-run`

Expected: package contains only dist, README, LICENSE, and intended documentation; zero runtime dependencies; version `3.0.0`.

Run: `git diff --check`

Expected: PASS.

- [ ] **Step 5: Record the final implementation checkpoint**

With exact commit approval only:

```bash
git add .github package.json pnpm-lock.yaml scripts/verify-release.mjs
git commit -m "ci: enforce purifai v3 release qualification"
```

After this checkpoint, report local evidence and any CI-only evidence still needed. Ask separately before pushing commits, creating a tag, enabling npm trusted publishing, invoking a release workflow, or publishing `purifai@3.0.0`.
