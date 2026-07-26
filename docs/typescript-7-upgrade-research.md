# TypeScript 7 upgrade — research and findings

Date: 2026-07-26. Upgraded `@types/node ^20.0.0 → ^26.0.0`, `tsup ^8.5.0 → ^8.5.1`,
`typescript ^5.9.2 → ^7.0.2`.

Evidence below is graded: **[empirical]** = reproduced locally with the command
shown; **[normative]** = official Microsoft documentation; **[inference]** = my
reasoning, not directly verified.

## 1. TypeScript 7 removed the legacy JS compiler API

**[empirical]** Under `typescript@7.0.2`, the entire legacy compiler API surface is
absent:

```console
$ node -e "const ts=require('typescript');console.log(ts.version, typeof ts.sys, typeof ts.createProgram)"
7.0.2 undefined undefined
```

`ts.sys`, `ts.createProgram` and `ts.createSourceFile` are all `undefined`. TS 7 is
the Go rewrite; the `typescript` npm package now ships the native binary and the
old in-process JS API is not part of it.

**Consequence:** any build tool that *drives* the compiler through that API breaks.
Plain `tsc` CLI usage does not.

## 2. `tsup --dts` is incompatible with TypeScript 7

**[empirical]** `pnpm build` with the old script crashed at module load:

```
TypeError: Cannot read properties of undefined (reading 'useCaseSensitiveFileNames')
    at node_modules/.pnpm/rollup-plugin-dts@6.1.1_rollup@4.53.2_typescript@5.7.3/...
```

tsup generates declarations via `rollup-plugin-dts`, which reads `ts.sys.…` at
import time. With `ts.sys === undefined` (finding 1) it throws before compiling
anything. `tsc --noEmit` passed cleanly on the same commit, so this is a build-tool
incompatibility, **not** a type error in `index.ts`.

**[empirical]** tsup's *JavaScript* build is unaffected — it uses esbuild, which
never touches the TS API. `tsup index.ts --format cjs,esm` (no `--dts`) succeeds and
emits byte-identical output to the pre-upgrade build (9.72 KB ESM / 10.83 KB CJS).

### Fix adopted: emit declarations with `tsc` itself

The build is now two steps (`package.json`):

```
tsup index.ts --format cjs,esm --clean   # esbuild -> dist/index.js, dist/index.cjs
tsc -p tsconfig.dts.json                 # -> dist/index.d.ts, copied to index.d.cts
```

`rollup-plugin-dts` is out of the path entirely. This is safe **specifically because
`index.ts` imports nothing** — there is no cross-file graph for a declaration
bundler to flatten, so `tsc`'s per-file emit is equivalent to the rolled-up output.
**[inference]** On a multi-file package this swap would need more care, since `tsc`
would emit one `.d.ts` per source file instead of a single bundled one.

**[empirical]** Verified equivalence rather than assuming it. The declaration text
differs cosmetically — `tsc` uses inline `export` modifiers, `rollup-plugin-dts`
emitted a trailing `export { … }` aggregate — but a consumer importing all eight
public exports (`Purifai`, `sanitize`, `analyze`, `isDangerous`, `sanitizeBatch`,
`PurifaiOptions`, `PurifaiResult`, default) type-checks against the new `.d.ts` under
TS 7 with exit 0.

`dist/index.d.cts` is produced by copying `index.d.ts`. Valid here for the same
zero-import reason: there is no ESM/CJS-specific type content to diverge.

## 3. Config options removed in TS 7 (each hit during this upgrade)

| Option | Status in TS 7 | Action taken |
|---|---|---|
| `moduleResolution: "node"` (node10) | **Removed** — [normative][1][2] | → `"bundler"` in `tsconfig.json` |
| `baseUrl` | **Removed**, error `TS5102` | n/a here; use `paths` relative to tsconfig |
| files on CLI + `tsconfig.json` present | **Error `TS5112`** | use `-p <config>`, or `--ignoreConfig` |

**[normative]** Microsoft's guidance for `moduleResolution: node`: migrate to
`nodenext` when targeting Node directly, or `bundler` when using a bundler/Bun.
`bundler` was chosen because tsup bundles `index.ts`, so Node's runtime resolution
rules never apply to this package's own imports.

**[empirical]** `TS5102` and `TS5112` were both hit and read off the compiler
directly, not taken from docs.

## 4. Verification (post-upgrade)

| Gate | Result |
|---|---|
| `pnpm typecheck` (`tsc --noEmit`, TS 7) | exit 0 |
| `pnpm build` from clean `dist/` | exit 0, all 4 artifacts emitted |
| Consumer type-check against emitted `.d.ts` | exit 0 |
| `node test/security-test.js` | 21 passed / 4 failed / 84.0% — **identical to pre-upgrade baseline** |
| ESM + CJS runtime smoke | static API works in both |

## 5. Pre-existing issues found (NOT caused by this upgrade)

Recorded because they were discovered while establishing the baseline. All four
reproduce on the **published `purifai@1.0.0` tarball from npm**, and the local
`dist/index.cjs` is byte-identical to the published one (`diff -q` → identical), so
none of them are build-pipeline artifacts.

1. **Detached static methods lose `this` (security-relevant).** `index.ts:394-397`
   does `export const sanitize = Purifai.sanitize`, but `sanitize` reads
   `this.defaultOptions` at `index.ts:93`. **[empirical]** Called as a bare
   function the ESM export throws `TypeError: Cannot read properties of undefined
   (reading 'defaultOptions')`; under CJS, `this` becomes the module exports object,
   so `{...undefined}` silently spreads to nothing and sanitization runs **with no
   default options**:

   | Call | Result for `<script>alert(1)</script>Hello` |
   |---|---|
   | `Purifai.sanitize(…)` (documented) | `"1)Hello"` |
   | named `sanitize(…)`, ESM | throws |
   | named `sanitize(…)`, CJS | `"(1)Hello"` ← weaker output, no error |

   The documented `Purifai.sanitize` path is unaffected. The security suite only
   exercises the static form, which is why it never caught this.

2. **`test/security-test.js` fails 4 of 25 checks (84%)** at v1.0.0: "Universal XSS
   Polyglot" and "Ultimate XSS Polyglot" leave comment residue (`/*--`) where the
   test expects `""`, plus the `analyze()` and `sanitizeBatch()` assertions fail.

3. **`test/comprehensive-test.js` cannot run.** It imports `chalk` and `cli-table3`,
   which were removed from `package.json` devDependencies (the stale lockfile still
   listed 12 such benchmark deps, including `dompurify` and `sanitize-html`). This is
   the suite that produces the **"100% against 64 attack vectors"** claim used in the
   README and on the portfolio site — that number is currently not reproducible from
   this repo.

4. **`test/verify-performance.js` is broken.** It `require()`s a nonexistent
   `./index-compressed.js`, and `require` is unavailable anyway in a
   `"type": "module"` package.

## Sources

[1]: https://github.com/microsoft/TypeScript/issues/62200 "Deprecate, remove --moduleResolution node10"
[2]: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ "Announcing TypeScript 7.0"

- [Deprecate, remove `--moduleResolution node10` (microsoft/TypeScript#62200)](https://github.com/microsoft/TypeScript/issues/62200)
- [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [TypeScript 6.0 release notes (deprecations that become removals in 7.0)](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html)
- [Progress on TypeScript 7 — December 2025](https://devblogs.microsoft.com/typescript/progress-on-typescript-7-december-2025/)
