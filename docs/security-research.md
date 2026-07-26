# Purifai security research — attack classes, measured results, and limits

Date: 2026-07-26. Written while fixing four v1.0.0 defects and testing the
library against current sanitizer-bypass research.

Evidence grading: **[empirical]** = reproduced locally, command and output
recorded; **[normative/authoritative]** = published security research or vendor
advisory; **[inference]** = my reasoning, not directly verified.

---

## 1. Attack classes tested

Sourced from the cure53/DOMPurify attack-class wiki, PortSwigger's mutation-XSS
research, and Securitum's namespace-confusion writeups.

| Class | Mechanism | Example |
|---|---|---|
| Mutation XSS (mXSS) | Sanitized string is mutated by the parser/serializer round trip into something dangerous | `<svg></p><style><a id="</style><img src=x onerror=alert(1)>"></svg>` |
| Namespace confusion | `<svg>`/`<math>` switch the parser into foreign content, where `<style>` may have children and entities decode | `<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>` |
| Rawtext/RCDATA breakout | A closing tag inside an attribute becomes live markup in text-like contexts | `<noscript><p title="</noscript><img src=x onerror=alert(1)>">` |
| Depth-limit flattening | 512+ nesting levels make parsers flatten descendants into siblings, changing ancestry | `'<div>'.repeat(600) + '<style><img src=x onerror=alert(1)>'` |
| DOM clobbering | Named elements shadow security-critical properties (`nodeName`, `parentNode`) | `<form><input name=nodeName></form>` |
| Template-expression reassembly | Split expressions rejoin after element removal merges text nodes | `<div>{<foo></foo>{constructor.constructor("alert(1)")()}<foo></foo>}</div>` |

**[normative]** Relevant recent DOMPurify CVEs in this family: CVE-2025-26791
(template-literal regex → mXSS, fixed in 3.2.4) and the foreign-content
namespace class covering 3.1.3–3.2.6 / 2.5.3–2.5.8. Note these are bypasses of a
*parser-based* sanitizer that preserves safe HTML — a harder problem than the
one Purifai solves (see §3).

## 2. Measured results

**[empirical]** All 25 payloads above plus classic vectors are now in
`test/regression-test.js` and run via `pnpm test`.

| Configuration | Payloads | Residual `<`/`>` | Residual `on*=` | Residual `javascript:` |
|---|---|---|---|---|
| Default (`aggressiveMode: true`) | 25 | 0 | 0 | 0 |
| `aggressiveMode: false` | 25 | 0 | 0 | 0 |

Suite totals after the v1.0.0 fixes:

| Suite | Before | After |
|---|---|---|
| `test/security-test.js` | 21/25 (84.0%) | **25/25 (100%)** |
| `test/comprehensive-test.js` (64 vectors) | could not run | **64/64 (100%)** |
| `test/regression-test.js` (new) | — | **82/82 (100%)** |
| `test/fair-benchmark.js` (new, 84 vectors) | — | **100% security / 100% text** |
| `test/fuzz-test.js` (new, 4k generated) | — | **0 invariant violations** |

Bundle: 13,909 bytes raw / 4,176 bytes gzipped. Throughput ~149k ops/sec.

Two residues previously survived under `aggressiveMode: false` (`">` and `-->`)
— delimiters only, not executable, but a stray `>` can still terminate an
attribute in the *embedding* page. Both are now escaped, so **no configuration
emits a raw `<` or `>`**.

## 3. The architectural limit — read this before claiming "bulletproof"

**[normative]** The consistent conclusion of the bypass literature is that
string/regex sanitization cannot safely handle HTML, because parsers apply
context-dependent rules: the same characters behave differently inside comments,
attributes, rawtext elements, and foreign-content namespaces. Safe sanitizers
parse input into a DOM tree and clean the tree.

Purifai is regex-based, so it cannot reason about namespace switching or the
serialize→reparse round trip that defines mXSS.

**[empirical]** It nonetheless scores zero residue above, and the reason matters:
**in its default configuration Purifai removes all markup.**

```
sanitize('<p>Hello <b>world</b></p>')  ->  'Hello world'
sanitize('<a href="https://x.com">link</a>')  ->  'link'
```

Its output contains no markup at all, so there is nothing for a parser to mutate
on re-parse. **[inference]** That makes the default posture genuinely safe for
its actual use case — emitting untrusted content as *text* — and it sidesteps
mXSS by construction rather than by defeating it.

The honest framing: **Purifai is a strip-to-text sanitizer, not a
preserve-safe-HTML sanitizer.** It is not in the same product category as
DOMPurify, which exists to keep `<b>`, `<a href>`, and friends intact.

## 4. Benchmark methodology problem

**[empirical]** `test/comprehensive-test.js` counts a vector as "blocked" when
the output is empty (`isXSSBlocked`: "Complete removal is safe") or contains no
dangerous pattern. Scoring three functions against the same 64 vectors and the
same criterion:

| Implementation | Score |
|---|---|
| Purifai | 64/64 (100%) |
| `() => ''` — deletes everything, sanitizes nothing | **64/64 (100%)** |
| `v => v` — identity, no sanitization at all | 2/64 (3.1%) |

A function that returns the empty string achieves the identical perfect score.
The benchmark therefore measures *deletion*, not sanitization quality.

It also penalises correct behaviour in competitors: the criterion flags any
output containing `<svg` or `<math`, but those tags are in DOMPurify's default
allow-list and its sanitized output legitimately retains them. So the published
comparison — Purifai 100% vs DOMPurify 62.5% — compares a tool that deletes all
HTML against tools that preserve safe HTML, using a metric that rewards deletion.

### The replacement: `test/fair-benchmark.js`

**[empirical]** Two axes, measured together. Security inserts each sanitizer's
output into a real DOM (jsdom), then serializes and re-parses it — the round trip
where mXSS occurs — and counts a vector blocked only if neither parse yields a
script node, an `on*` handler, or a dangerous-protocol URL. Fidelity runs a
benign corpus and measures surviving text and markup.

| Library | Category | Security | Text kept | Markup kept | Mutations |
|---|---|---|---|---|---|
| Purifai | strip-to-text | 100% | 100% | 0% *(by design)* | 0 |
| DOMPurify | preserve-html | 100% | 100% | 100% | 0 |
| sanitize-html | preserve-html | 100% | 100% | 100% | 0 |
| xss | preserve-html | 100% | 100% | 100% | 0 |
| `() => ''` *(calibration)* | — | 100% | 0% | 0% | 0 |
| `v => v` *(calibration)* | — | 38.1% | 100% | 100% | 5 |

84 attack vectors · 15 benign documents.

Two design notes worth keeping honest:

- The calibration rows exist so the metric can be audited. Any scoring rule that
  cannot separate `() => ''` from a real sanitizer is measuring deletion.
- `style="expression(...)"` is reported in a **separate** column, not counted as a
  security failure. CSS expressions only ever executed in IE ≤ 10, and counting
  them would penalise correct modern behaviour — the same rigging this benchmark
  replaces. An earlier draft of this benchmark made exactly that mistake and
  scored DOMPurify at 97.6%.

**The conclusion is not flattering to the original claim, and it is the useful
one:** on security there is no headroom — every maintained sanitizer blocks
everything. Purifai is not "more secure than DOMPurify". Its real advantages are
zero dependencies, ~4.1 KB gzipped, no DOM requirement (so it runs in edge and
worker runtimes where jsdom-backed sanitizers cannot), and ~149k ops/sec.

## 5. Defects fixed in this pass

1. **`allowBasicHtml` was dead** — declared, defaulted, documented in four README
   places including the DOMPurify migration guide, and never read in the
   pipeline. **Removed** from `PurifaiOptions` and from all README references.
   This is a breaking *type* change: code passing the option no longer compiles.

2. **Benign text corruption.** `sanitize('5 < 6 and 7 > 3')` returned `'5 3'`.
   Input not flagged dangerous now has recognizable tags stripped and any
   remaining angle brackets **escaped** rather than deleted → `'5 &lt; 6 and 7
   &gt; 3'`. Attack payloads keep the delete-everything path.

3. **Bare protocols were not detected.** **[empirical]**
   `isDangerous('vbscript:alert(1)')` returned `false`, because the protocol
   pattern only matched protocols already attached to an attribute (`href=`).
   A bare payload therefore took the benign path and `vbscript:` survived into
   the output — live again the moment a caller places it in an `href`. Fixed
   with a bare-protocol detector.

4. **Contextual encoders added** (`escape`, `escapeAttribute`, `escapeUrl`),
   following OWASP context-specific output encoding. `sanitize()` cannot tell
   markup from text — `a<b && c>d` is a valid start tag per the parsing spec —
   so the API now lets the caller state the context instead of guessing.

## 6. Fuzzing — two defects the curated corpora missed

**[empirical]** `test/fuzz-test.js` generates payloads from attack-grammar
fragments under a seeded PRNG and checks six invariants against jsdom rather than
against another regex. The first run (4,000 payloads) surfaced two real defects:

1. **`sanitize()` was not idempotent.** Root cause: the aggressive cleanup used
   `/on\w+\s*=/gi`. `\w` includes digits and there was no word boundary, so once
   the pipeline's own earlier deletions turned `confirm(1)href=` into
   `confirm1href=`, the substring `onfirm1href=` matched — the `on` inside
   *c-**on**-firm* — and deleted text that was never a handler. This is worse
   than an aesthetic problem: removal was *manufacturing* matches that were not
   in the input. Fixed by requiring a word boundary and letters only
   (`/\bon[a-z]+\s*=/gi`), applied to all four occurrences.

2. **Filters needed a fixpoint.** Because deletion can splice text into new
   matches, the filter chain now iterates until the string stops changing
   (capped at `MAX_FILTER_PASSES`).

After both fixes: 0 violations across 4 seeds / 13,000 generated payloads.

**[inference]** The lesson generalises: a delete-based sanitizer can create
constructs absent from its input, so idempotence is a security property for this
design, not just a nicety.

## 7. Still open

1. ~~**jsdom is not a browser.**~~ **Closed.** `test/browser-verify.js` now runs
   the full 84-vector corpus through **real Google Chrome** via Playwright, and
   checks two things jsdom cannot: the parsed tree after a serialize→reparse
   round trip, and whether anything actually *executed* (`<img src=x onerror>`
   fires on its own in a real engine; jsdom never runs it).

   **[empirical]** Result: 84 vectors, 0 sanitize errors, 0 static threats,
   **0 executed**. A positive control — an unsanitized payload — is run last and
   must fire; if it does not, the run is reported as a failure rather than a
   pass, because a green result from a detector that cannot detect anything is
   worse than a red one. The control fired.

   Remaining: only Chromium is covered. Firefox and WebKit have their own parser
   quirks, and the PortSwigger mXSS research documents browser-specific vectors.
2. **Not published.** The working tree is 2.0.0 (removing `allowBasicHtml` breaks
   types, so semver requires a major); npm still serves 1.0.0 with all the
   defects in §5.

## Sources

- [cure53/DOMPurify — Attack Classes & Bypass History](https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History)
- [PortSwigger Research — Bypassing DOMPurify again with mutation XSS](https://portswigger.net/research/bypassing-dompurify-again-with-mutation-xss)
- [Securitum — Mutation XSS via namespace confusion (DOMPurify 2.0.17 bypass)](https://www.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass.html)
- [Sonar — mXSS: The Vulnerability Hiding in Your Code](https://www.sonarsource.com/blog/mxss-the-vulnerability-hiding-in-your-code/)
- [Beyond XSS — Bypassing Your Defense: Mutation XSS](https://aszx87410.github.io/beyond-xss/en/ch2/mutation-xss/)
- [OWASP Top Ten](https://owasp.org/www-project-top-ten/)
