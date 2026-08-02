> Stream untrusted HTML into clean, readable text with bounded working memory.
> No DOM. No document tree. No runtime dependencies.

# Purifai

[![npm version](https://img.shields.io/npm/v/purifai.svg)](https://www.npmjs.com/package/purifai)
[![CI](https://github.com/moji2002/purifai/actions/workflows/ci.yml/badge.svg)](https://github.com/moji2002/purifai/actions/workflows/ci.yml)
[![gzip: 23.7 KiB](https://img.shields.io/badge/gzip-23.7_KiB-2f855a)](docs/benchmarks/v3.md)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Readable text from hostile HTML—without a DOM.**

Purifai is a fixed-policy HTML-to-text converter for servers, browsers, and
edge runtimes. It keeps useful document structure, drops non-reader bodies, and
enforces input, output, nesting, and retained-token limits while scanning.

```ts
import { toText } from 'purifai';

const text = toText(
  '<script>alert(1)</script><h2>Release</h2><ul><li>Fast</li></ul>',
);

console.log(text);
// Release
//
// - Fast
```

A flat tag remover can leak `alert(1)` from the script body and collapse the
remaining text. Purifai drops that body and formats the reader content.

## Choose Purifai when

- HTML may be large, malformed, or hostile.
- You want readable plain text—not preserved markup or a browser DOM.
- Conversion must have deterministic resource limits.
- The same implementation must run in Node, Bun, Deno, Workers, and browsers.
- Streaming should produce the same result regardless of chunk boundaries.

If you need selector-driven formatting, complex table layout, or allow-listed
safe HTML, jump to [Which tool should you choose?](#which-tool-should-you-choose).

## Install

```sh
npm install purifai
```

Purifai v3 requires Node.js 22 or newer when used in Node. It ships ESM and
CommonJS exports and has zero runtime dependencies.

## Quick start

```ts
import { toText } from 'purifai';

const text = toText('<h1>Guide</h1><p>Start <strong>here</strong>.</p>', {
  layout: 'readable',
  links: 'label',
  images: 'alt',
});

// Guide
//
// Start here.
```

`toText` returns a JavaScript string. It does not return safe HTML.

## Safe output

Prefer a text sink:

```ts
element.textContent = toText(untrustedHtml);
```

If the only available sink is an HTML text node, escape the text explicitly:

```ts
import { escapeHtmlText, toText } from 'purifai';

element.innerHTML = escapeHtmlText(toText(untrustedHtml));
```

`escapeHtmlText` is only for an HTML text context. It does not make a value safe
for an attribute, URL, JavaScript, CSS, or template source. A displayed URL is
also still text; moving it into `href` requires a separate URL-policy decision.

## Why Purifai

Most HTML-to-text tools optimize for either minimal tag removal or broad
formatting control. Purifai targets a narrower intersection:

| Requirement | Purifai behavior |
| --- | --- |
| Reader-friendly output | Preserves headings, paragraphs, lists, quotes, code, simple tables, links, and image alternatives |
| Non-reader content | Drops bodies such as `script`, `style`, `template`, `iframe`, `svg`, and `math` |
| Hostile-input bounds | Enforces input, output, depth, and aggregate retained-token limits during scanning |
| Streaming | Uses a native Web `TransformStream` with chunk-invariant output |
| Portability | Uses no DOM, document tree, Node built-in, or runtime dependency |
| Predictability | Fixed policy, validated options, explicit overflow behavior, and frozen reports |

That fixed scope is the reason to choose Purifai. It deliberately does not
preserve markup, reconstruct CSS layout, expose custom formatters, or classify a
user's intent.

## Streaming

`createTextTransform` converts incrementally using the same state machine as
`toText`. Joining its output produces exactly the same text for every possible
input chunking.

```ts
import { createTextTransform } from 'purifai';

const response = await fetch('https://example.test/article');
if (response.body === null) throw new Error('Response has no body');

const transform = createTextTransform({ links: 'label-and-url' });
const readable = response.body
  .pipeThrough(new TextDecoderStream())
  .pipeThrough(transform);

for await (const chunk of readable) {
  consumeText(chunk);
}

const report = await transform.result;
```

Stream conversion always throws when a limit is breached. Some output may
already have been enqueued when `readable` and `transform.result` reject, so
discard partial output unless your application explicitly accepts it.

## Bounded conversion

`toText` throws a `PurifaiLimitError` when any configured limit is exceeded.
Use `convert` only when a bounded prefix is an acceptable result:

```ts
import { convert } from 'purifai';

const result = convert(largeHtml, {
  limits: { input: 1_000_000, output: 20_000, depth: 64, token: 65_536 },
  overflow: 'truncate',
});

result.text;
result.truncatedBy; // 'input', 'output', 'depth', 'token', or null
result.scanComplete; // false after truncation
result.consumedInputCodeUnits;
result.outputCodeUnits;
result.droppedContainers; // e.g. { script: 2, style: 1 }
```

Truncation is explicit and deterministic, and never emits half of a UTF-16
surrogate pair. `toText` and `createTextTransform` never truncate silently.

## Options

Unknown keys and invalid values throw `TypeError`; Purifai does not guess around
configuration mistakes.

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `layout` | `'readable' \| 'compact'` | `'readable'` | Structural boundaries, or normalized single-space text |
| `links` | `'label' \| 'label-and-url' \| 'drop'` | `'label'` | Keep the label, append an accepted display URL, or drop the link body |
| `images` | `'alt' \| 'drop'` | `'alt'` | Emit decoded non-empty `alt` text, or omit images |
| `baseUrl` | `string \| URL` | none | Resolve relative display URLs against a credential-free HTTP(S) base |
| `limits.input` | non-negative safe integer | `1_000_000` | Maximum input UTF-16 code units consumed |
| `limits.output` | non-negative safe integer | `250_000` | Maximum output UTF-16 code units emitted |
| `limits.depth` | non-negative safe integer | `64` | Maximum live structural nesting |
| `limits.token` | non-negative safe integer | `65_536` | Maximum aggregate retained token and attribute code units |
| `overflow` | `'throw' \| 'truncate'` | `'throw'` | `convert` only; other APIs always throw |

All four limits are enforced before unbounded caller-controlled state can
accumulate. Values measure JavaScript UTF-16 code units, not encoded bytes.

### Display URL policy

`label-and-url` emits destinations as display text, never as active links. It
accepts absolute `http:`, `https:`, and `mailto:` URLs. Relative URLs require a
validated HTTP(S) `baseUrl`. Credentials, controls, ambiguous schemes,
protocol-relative inputs, leading backslashes, unsupported schemes, and invalid
URLs are omitted while their visible label remains.

## Extraction policy

Purifai removes source and non-reader bodies including `script`, `style`,
`template`, `iframe`, `noscript`, `noembed`, `noframes`, `svg`, and `math`. It
preserves selected fallback and form text, decodes the complete pinned WHATWG
character-reference set, preserves literal `xmp`, and treats `plaintext` as text
through end of input.

This is a bounded extraction grammar, not browser tree construction. It does not
recreate CSS layout, browser `innerText`, complex `rowspan`/`colspan` tables,
SVG/MathML semantics, selector rules, custom formatters, or browser-equivalent
malformed-markup recovery.

## Benchmarks

The checked category benchmark pins `striptags@3.2.0` and
`html-to-text@10.0.0`. It measures reviewed readability and body-removal
fixtures, isolated warm median and p95 latency, and fresh-process peak RSS.

On the recorded Apple M1 / Node 24 run, Purifai passed all 11 category gates:

- 8/8 readability fixtures and all 5 non-reader-body fixtures;
- lower hostile-input p95 than `html-to-text` on four hostile corpora; and
- lower streaming peak RSS than `html-to-text` on all five memory corpora.

`striptags` remains faster on some flat-strip cases. That is not Purifai's
claim. Results are machine-, runtime-, and corpus-specific.

See the [complete methodology, raw results, and tables](docs/benchmarks/v3.md).
Reproduce measurements with `pnpm run bench`; check the recorded release gates
with `pnpm run bench:check`.

## Size, portability, and release proof

The complete minified ESM runtime—including all 2,231 pinned WHATWG entity
names—is 23,689 bytes with deterministic `gzip -9`. The release gate also checks
packed exports, zero runtime dependencies, cold import time, and retained import
heap.

The same packed artifact is tested in:

| Runtime | Release coverage |
| --- | --- |
| Node.js | 22, 24, and 26; ESM and CommonJS |
| Bun | ESM and CommonJS |
| Deno | ESM |
| Cloudflare Workers | Real `workerd`, without Node compatibility |
| Browsers | Chromium, Firefox, and WebKit |

Release qualification also includes 10,000 seeded malformed-input cases,
adversarial scaling checks, safe-sink tests with a positive control, package
smoke tests, and npm OIDC provenance bound to the tagged GitHub source commit.

## API reference

### `toText(html, options?) → string`

Converts one HTML string into readable text. Throws `TypeError` for invalid
input or options and `PurifaiLimitError` for a breached limit.

### `convert(html, options?) → ConversionResult`

Returns text plus a frozen report containing completion, truncation, consumed
input, output length, and dropped-container counts. It is the only API that can
return a deliberately truncated prefix.

### `createTextTransform(options?) → TextTransform`

Returns a native `TransformStream<string, string>` with a `result` promise for
the frozen conversion report. Limit failures reject both the stream and the
promise with the same error object.

### `escapeHtmlText(text) → string`

Losslessly encodes `&`, `<`, `>`, `"`, and `'` for an HTML text-node context.

### `PurifaiLimitError`

Extends `RangeError` and exposes `kind`, `limit`, and `observed`.

```ts
import { PurifaiLimitError, toText } from 'purifai';

try {
  toText(html, { limits: { input: 10_000 } });
} catch (error) {
  if (error instanceof PurifaiLimitError) {
    console.error(error.kind, error.limit, error.observed);
  }
}
```

## Which tool should you choose?

| Need | Choice |
| --- | --- |
| Fixed-policy readable text, hostile-input bounds, and portable Web streaming | Choose Purifai |
| Selectors, custom formatters, advanced tables, wrapping, and broad formatting control | Choose `html-to-text` |
| The smallest flat tag-removal operation | Choose stable `striptags` |
| Preserve an allow-listed safe HTML fragment | Choose DOMPurify or `sanitize-html` |

These categories are not interchangeable. DOMPurify and `sanitize-html` are
the correct category when safe markup must survive.

## Migration and development

V3 is a clean break. See the [v3 migration guide](docs/migration-v3.md) for every
removed export and option.

- [Runnable examples](examples)
- [Contributor guide](CONTRIBUTING.md)
- [Project notes](https://worksonmy.dev/projects/purifai)
- [Issues](https://github.com/moji2002/purifai/issues)

## License

[MIT](LICENSE)
