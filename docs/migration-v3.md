# Migrating to Purifai v3

Purifai v3 is a clean-break HTML-to-readable-text converter. There is no compatibility layer.
The v2 class, threat-scoring helpers, batch helpers, and context encoders are not
carried forward. The smaller API makes conversion, resource limits, and output
sink responsibilities explicit.

## Export and option mapping

| V2 surface | V3 decision |
| --- | --- |
| `Purifai.sanitize / sanitize` | Purifai.sanitize / sanitize → toText |
| `escape` | escape → escapeHtmlText (HTML text context only) |
| `analyze` | analyze → removed; use convert for conversion metadata |
| `sanitizeBatch` | sanitizeBatch → removed; map toText explicitly |
| `isDangerous` | isDangerous → removed; Purifai does not classify intent |
| `escapeAttribute / escapeUrl` | escapeAttribute / escapeUrl → removed; use a context-specific library or platform API |
| `getVersion / getStats` | getVersion / getStats → removed; use package metadata and published benchmarks |
| `aggressiveMode / allowedProtocols` | aggressiveMode / allowedProtocols → removed; fixed policy |
| `maxLength` | maxLength → limits.input; overflow is explicit |

## One-shot conversion

```js
// v2
const text = sanitize(html, { maxLength: 10_000 });

// v3: throws PurifaiLimitError when the input is too large
const text = toText(html, { limits: { input: 10_000 } });
```

If a bounded prefix is a valid product result, opt in through `convert`:

```js
const result = convert(html, {
  limits: { input: 10_000, output: 2_000 },
  overflow: 'truncate',
});

if (result.truncatedBy !== null) {
  console.log(`Stopped at the ${result.truncatedBy} limit`);
}
```

`toText` and `createTextTransform` never truncate silently.

## Batch conversion

Batching is ordinary application control flow in v3, so scheduling and error
handling remain visible:

```js
const texts = htmlItems.map((html) => toText(html));
```

## Conversion metadata

`convert` reports mechanical conversion facts: completion, input consumed,
output produced, truncation, and dropped-container counts. It does not assign a
threat score or infer whether content or a user is malicious.

## Output contexts

V3 only provides `escapeHtmlText`, for placing plain text in an HTML text-node
context. Prefer assigning `textContent` directly. Attribute, URL, JavaScript,
CSS, and template contexts need policies and encoders designed for those exact
sinks.

## Fixed policy changes

V3 deliberately has no mutable protocol allow-list or aggressive mode. Display
URLs accept absolute HTTP(S) and `mailto`, and resolve relative URLs only when an
HTTP(S) `baseUrl` is supplied. A displayed URL is text, not authorization to use
it as an active destination.

Markup is never preserved. Source and non-reader bodies are removed; visible
reader structure is converted to text. Applications that need safe HTML should
remain on a markup-preserving sanitizer.

## Streaming

Node stream adapters were not carried forward. Use the Web Streams API available
in modern Node, Bun, Deno, Workers, and browsers:

```js
const transform = createTextTransform();
const textStream = byteStream
  .pipeThrough(new TextDecoderStream())
  .pipeThrough(transform);
const report = await transform.result;
```

When a stream limit fails, some output may already have reached the reader. Treat
that output as partial and discard it unless your application explicitly accepts
partial records.
