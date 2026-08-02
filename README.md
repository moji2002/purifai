> Stream untrusted HTML into clean, readable text with bounded working memory.
> No DOM. No document tree. No runtime dependencies.

# Purifai

[npm](https://www.npmjs.com/package/purifai) ·
[Project notes](https://worksonmy.dev/projects/purifai) ·
[Runnable examples](https://github.com/moji2002/purifai/tree/main/examples) ·
[Issues](https://github.com/moji2002/purifai/issues)

Purifai is a fixed-policy HTML-to-readable-text converter for servers, browsers,
and edge runtimes. It incrementally removes non-reader bodies, decodes the full
WHATWG character-reference set, and preserves useful structure such as headings,
paragraphs, lists, links, image alternatives, code, and simple tables.

```ts
import { toText } from 'purifai';

const text = toText(
  '<script>alert(1)</script><h2>Release</h2><ul><li>Fast</li></ul>',
);
// Release
//
// - Fast
```

A flat tag remover can leak `alert(1)` from the script body and collapse the
remaining text. Purifai drops that body and formats the reader content.

The output is a JavaScript string, not safe HTML. Use one of these supported
sinks:

```ts
import { escapeHtmlText, toText } from 'purifai';

element.textContent = toText(untrustedHtml);
element.innerHTML = escapeHtmlText(toText(untrustedHtml));
```

Prefer `textContent`. `escapeHtmlText` exists for an HTML text context only; it
does not make a value safe for an attribute, URL, JavaScript, CSS, or template
source.

## Why it exists

Purifai targets one narrow intersection:

- readable extraction instead of flat deletion;
- deterministic input, output, nesting, and retained-token limits;
- chunk-invariant Web `TransformStream` conversion;
- no DOM, tree, Node built-in, or runtime dependency; and
- one side-effect-free artifact across server, browser, and edge runtimes.

It does not preserve markup and does not classify a user's intent. If either is
your requirement, use a tool designed for that different job.

## Install

```sh
npm install purifai
```

Purifai v3 requires Node.js 22 or newer when used in Node.

## API

### `toText(html, options?)`

Converts one string and returns readable text. A breached limit throws a
`PurifaiLimitError`.

```ts
import { toText } from 'purifai';

const text = toText('<h1>Guide</h1><p>Start here.</p>', {
  layout: 'readable',
  links: 'label-and-url',
  images: 'alt',
  baseUrl: 'https://docs.example/',
  limits: { input: 1_000_000, output: 250_000, depth: 64, token: 65_536 },
});
```

### `convert(html, options?)`

Returns the text plus a frozen conversion report. It is the only entry point
that can deliberately return a bounded prefix instead of throwing.

```ts
import { convert } from 'purifai';

const result = convert(largeHtml, {
  limits: { output: 20_000 },
  overflow: 'truncate',
});

result.text;
result.truncatedBy; // 'output' or null
result.scanComplete; // false after truncation
result.consumedInputCodeUnits;
result.outputCodeUnits;
result.droppedContainers; // e.g. { script: 2, style: 1 }
```

Truncation is explicit, deterministic, and never emits half of a UTF-16
surrogate pair. When multiple limits meet at the same point, the first observed
limit is reported.

### `createTextTransform(options?)`

Returns a native `TransformStream<string, string>` with a `result` promise. The
stream uses the same state machine and produces exactly the same joined text as
`toText`, regardless of chunk boundaries.

```ts
import { createTextTransform } from 'purifai';

const response = await fetch('https://example.test/article');
if (response.body === null) throw new Error('Response has no body');

const transform = createTextTransform({ links: 'label-and-url' });
const readable = response.body
  .pipeThrough(new TextDecoderStream())
  .pipeThrough(transform);
const reader = readable.getReader();

for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  consumeText(value);
}

const report = await transform.result;
```

Stream conversion always throws on a breached limit. Output may already have
been enqueued when `readable` and `transform.result` reject, so discard partial
output unless your application has deliberately defined it as useful. Purifai
does not buffer the whole result to make an error transactional.

### `escapeHtmlText(text)`

Encodes `&`, `<`, `>`, `"`, and `'` for an HTML text node. It is lossless and is
for plain text—including `toText` output—when the only available sink is
`innerHTML`.

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

## Options and defaults

Unknown keys and invalid values throw `TypeError`; Purifai does not silently
guess around configuration mistakes.

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `layout` | `'readable' \| 'compact'` | `'readable'` | Structural newlines/lists/tables, or normalized single-space text |
| `links` | `'label' \| 'label-and-url' \| 'drop'` | `'label'` | Keep label, append an accepted display URL, or drop the link body |
| `images` | `'alt' \| 'drop'` | `'alt'` | Emit decoded non-empty `alt` text, or omit images |
| `baseUrl` | `string \| URL` | none | Resolve relative display URLs against a credential-free HTTP(S) base |
| `limits.input` | non-negative safe integer | `1_000_000` | Maximum input UTF-16 code units consumed |
| `limits.output` | non-negative safe integer | `250_000` | Maximum output UTF-16 code units emitted |
| `limits.depth` | non-negative safe integer | `64` | Maximum live structural nesting |
| `limits.token` | non-negative safe integer | `65_536` | Maximum aggregate retained token/attribute code units |
| `overflow` | `'throw' \| 'truncate'` | `'throw'` | `convert` only; other APIs always throw |

All four limits are enforced while scanning, before unbounded caller-controlled
state can accumulate. Values measure JavaScript UTF-16 code units, not encoded
bytes.

## Link policy

`label-and-url` emits a destination as display text, never as an active link. It
accepts absolute `http:`, `https:`, and `mailto:` URLs. Relative URLs require a
validated HTTP(S) `baseUrl`. Control characters, whitespace-split schemes,
protocol-relative inputs, leading backslashes, credentials, unsupported schemes,
and invalid URLs are omitted while their visible label remains.

The returned URL string is still only text. Do not move it into `href` without a
separate URL-policy decision at that sink.

## Extraction fidelity

Purifai intentionally removes source and non-reader bodies including `script`,
`style`, `template`, `iframe`, `noscript`, `noembed`, `noframes`, `svg`, and
`math`. It preserves selected fallback/form text, decodes `textarea`, preserves
literal `xmp`, and treats `plaintext` as text through end of input.

This is a bounded extraction grammar, not browser tree construction. It does not
recreate CSS layout, browser `innerText`, complex `rowspan`/`colspan` tables,
SVG/MathML semantics, selector rules, custom formatters, or browser-equivalent
malformed-markup recovery. Simple rows and cells are represented with tabs and
line boundaries.

## Which tool should you choose?

| Need | Choice |
| --- | --- |
| Fixed-policy readable text, hostile-input bounds, and portable Web streaming | Choose Purifai |
| Selectors, custom formatters, advanced tables, wrapping, and broader formatting control | Choose `html-to-text` |
| The smallest flat tag-removal operation | Choose stable `striptags` |
| Preserve an allow-listed safe HTML fragment | Choose DOMPurify or `sanitize-html` |

These tools are not interchangeable. In particular, DOMPurify and
`sanitize-html` are the right category when safe markup must survive.

## Benchmarks

The checked category benchmark pins `striptags@3.2.0` and
`html-to-text@10.0.0`. It measures exact readability/body-removal fixtures,
isolated warm median and p95 one-shot latency, and fresh-process peak RSS. The
throughput path gives every package the same materialized string; the memory path
lets Purifai consume lazy 16,384-code-unit chunks because streaming ingestion is
the product claim.

On the recorded Apple M1 / Node 24 run, Purifai passed all 11 category gates: all
readability and body-removal fixtures, lower hostile-input p95 than
`html-to-text` on four hostile corpora, and lower streaming peak RSS on all five
memory corpora. `striptags` remains faster on some flat-strip cases, which is not
Purifai's claim.

See the [complete methodology, raw-result link, and tables](docs/benchmarks/v3.md).
Reproduce it with `pnpm run bench`; re-check the saved gates with
`pnpm run bench:check`.

## Size and runtime matrix

The complete minified ESM runtime—including the full 2,231-name WHATWG entity
data—is gated at 25 KiB using deterministic `gzip -9`. The recorded artifact is
23,689 bytes. `pnpm run test:size` also checks the packed exports, zero runtime
dependencies, cold import time, and retained import heap.

The release matrix exercises the same packed ESM artifact:

| Runtime | Required release coverage |
| --- | --- |
| Node.js | 22, 24, and 26; ESM and CommonJS |
| Bun | ESM and CommonJS consumers |
| Deno | ESM consumer |
| Cloudflare Workers | real `workerd`, without Node compatibility |
| Browsers | Chromium, Firefox, and WebKit |

Browser qualification also reparses escaped output in a real DOM with a working
positive control. This validates the documented sinks; it is not a universal
claim about every output context.

## Migration and development

V3 is a clean break. See the [v3 migration guide](docs/migration-v3.md) for every
removed export and option. Contributor setup and the full verification commands
are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
