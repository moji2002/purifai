# 🛡️ Purifai

[![npm version](https://badge.fury.io/js/purifai.svg)](https://badge.fury.io/js/purifai)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-zero-green.svg)](https://www.npmjs.com/package/purifai)

> **Zero-dependency strip-to-text sanitizer with contextual output encoding**

[npm](https://www.npmjs.com/package/purifai) ·
[Project notes](https://worksonmy.dev/projects/purifai) ·
[Runnable examples](https://github.com/moji2002/purifai/tree/main/examples) ·
[Issues](https://github.com/moji2002/purifai/issues)

Purifai is a lightweight, zero-dependency sanitizer for the **strip-to-text** case:
untrusted content that must be displayed as text, never as markup. It removes all
HTML rather than allow-listing safe tags. The result contains no retained markup
for an HTML parser to mutate on re-parse.

**Reach for Purifai when** you want untrusted input rendered as plain text, with no
dependencies, no DOM, and a ~4.5 KB gzipped package build that runs in Node, browsers,
and edge runtimes alike.

**Reach for DOMPurify or sanitize-html when** you need to *keep* safe formatting
such as `<b>` and `<a href>`. That is a harder problem and they solve it well.

## Quick start

```bash
npm install purifai
```

```typescript
import { escape, sanitize } from 'purifai';

sanitize('<script>steal()</script><p>Hello <b>world</b></p>');
// "Hello world"

escape('Use <strong>only</strong> as text');
// "Use &lt;strong&gt;only&lt;/strong&gt; as text"
```

Use `sanitize()` when the input is HTML that should become plain text. Use a
contextual encoder when the input is already text and must be preserved.

## Benchmark snapshot

Produced by `pnpm benchmark`. Each tool's output is inserted into a real DOM
(jsdom), then serialized and re-parsed — the round trip where mutation XSS lives.
A vector counts as having no executable output only if *neither* parse yields a
script node, an `on*` handler, or a dangerous-protocol URL. Exact-text fidelity
and raw-container removal are separate measurements so deletion cannot masquerade
as quality.

| Library | Category | No executable output* | Exact text | Markup kept | Raw body removed | Median ops/sec† | p95 µs/op† |
|---------|----------|----------------------|------------|-------------|------------------|----------------|------------|
| **Purifai.sanitize** | strip-to-text | **100%** | **100%** | 0% *(by design)* | **100%** | **526,709** | **2.050** |
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

84 attack vectors (OWASP, PortSwigger, cure53 corpora) · 15 benign documents.

\* This is an observed corpus result, not a security guarantee. † Throughput is
the median of seven samples after warm-up; p95 is the slowest of those seven
local samples. Snapshot captured on 2026-08-02
with Node 26.3.0 on Apple Silicon. It varies by hardware and runtime and should
only be compared within the same category. The command above is the source of
truth. HTML encoders safely display the original markup as text; unlike Purifai
and striptags, they do not turn markup-bearing input into clean reader text.

Purifai is not a drop-in replacement for a safe-HTML-preserving sanitizer. Its
measured advantages are a bounded scanner, zero runtime dependencies, and no DOM
requirement for the narrower strip-to-text job.

Within the strip-to-text rows, striptags is smaller and faster in this snapshot;
Purifai's differentiation is exact benign text together with full raw-container
body removal and bounded malformed-input scaling.

## 🚀 Why Purifai?

### ✅ Security boundaries
- Produces no executable output in the current 84-vector DOM re-parse corpus
- Uses a forward-only scanner with measured near-linear adversarial scaling
- Removes scriptable/raw-text containers together with their bodies
- Rejects invalid numeric entity scalars instead of emitting control characters
- Contextual encoders for HTML body, attribute, and URL contexts

### ⚡ High Performance
- **Fast processing** - optimized algorithms for high-throughput applications
- **Zero dependencies** - minimal bundle size and attack surface
- **TypeScript native** with full type definitions
- **Node.js and Browser** compatible

### 🎯 Developer Friendly
- Simple API with intelligent defaults
- Detailed threat analysis and reporting
- Batch processing support
- Comprehensive documentation

## Test coverage

The repository exercises 64 classic and 20 modern mutation/namespace vectors,
seeded fuzzing, real-browser parsing, malformed raw-text containers, URL context
validation, idempotence, and adversarial inputs from 2–128 KiB. A passing corpus
is regression evidence, not proof against every future browser or payload.

## 🛠️ Other package managers

```bash
yarn add purifai
# or
pnpm add purifai
```

## 📖 Usage

### Advanced Analysis

```typescript
import { analyze } from 'purifai';

const result = analyze('<script>alert("hack")</script>User content');

console.log(result.content);        // "User content"
console.log(result.hadThreats);     // true
console.log(result.threatLevel);    // "critical"
console.log(result.processingTime); // 0.023 (ms)
```

### Batch Processing

```typescript
import { sanitizeBatch } from 'purifai';

const userInputs = [
  '<script>alert(1)</script>Hello',
  '<img src=x onerror=alert(1)>World',
  'Safe content'
];

const cleanData = sanitizeBatch(userInputs);
// Result: ["Hello", "World", "Safe content"]
```

### Threat Detection

```typescript
import { isDangerous } from 'purifai';

if (isDangerous(userInput)) {
  // Optional telemetry only. Do not use this advisory signal as an
  // authorization, authentication, or request-blocking decision.
  console.warn('Potentially dangerous markup observed');
}
```

### Contextual Escaping

`sanitize()` treats its input as HTML and removes markup. When the input is
**plain text**, escaping is the better tool — it is lossless, and no guessing is
involved. These follow OWASP's context-specific output encoding guidance.

```typescript
import { escape, escapeAttribute, escapeUrl } from 'purifai';

// HTML body context — lossless, nothing is removed
escape('if (a<b && c>d) return;');
// "if (a&lt;b &amp;&amp; c&gt;d) return;"

// Attribute context — safe even unquoted, since a bare space or
// backtick could otherwise close the value and start onerror=
`<div title="${escapeAttribute(userInput)}">`;

// URL context — returns '' when the protocol is not allow-listed
escapeUrl('https://example.com'); // escaped, safe for href
escapeUrl('javascript:alert(1)'); // ""
escapeUrl('java\tscript:alert(1)'); // "" (whitespace-split protocols too)
```

Why both exist: `sanitize()` uses a conservative HTML-like scanner and returns
clean reader text, while `escape()` is lossless for text that must be displayed
exactly. Only the caller knows the destination context.

## ⚙️ Configuration Options

```typescript
interface PurifaiOptions {
  /** Maximum input length (default: 1MB) */
  maxLength?: number;
  
  /** Subset of built-in safe protocols: http, https, mailto */
  allowedProtocols?: string[];
  
  /** @deprecated Retained for compatibility; strip-to-text is always used. */
  aggressiveMode?: boolean;
}
```

`allowedProtocols` can narrow the built-in set but cannot add executable
schemes. Protocol-relative URLs are rejected.

## Scope and security boundaries

- Purifai always returns text. It does not preserve safe HTML, CSS, embeds, or
  rich-text formatting.
- It is not a browser HTML parser and does not promise browser-equivalent error
  recovery. The scanner deliberately follows a bounded strip-to-text contract.
- `analyze()` and `isDangerous()` are advisory telemetry, not authentication,
  authorization, moderation, or request-blocking decisions.
- Output encoding is sink-specific. HTML text, attributes, and URLs require the
  matching encoder; Purifai does not make text universally safe for JavaScript,
  CSS, SQL, shell commands, or templates.
- The published attack corpus is regression evidence, not a guarantee against
  every future browser behavior or payload.

## Test Purifai in your project

The example below imports only the public package API and runs with Node's
built-in test runner:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, escape, escapeUrl } from 'purifai';

test('renders untrusted markup as plain text', () => {
  assert.equal(sanitize('<script>bad()</script><b>Hello</b>'), 'Hello');
  assert.equal(escape('a<b && c>d'), 'a&lt;b &amp;&amp; c&gt;d');
  assert.equal(escapeUrl('javascript:alert(1)'), '');
});
```

Save it as `purifai.test.mjs`, then run:

```bash
node --test purifai.test.mjs
```

This is a regression example, not proof that an application is secure. Keep
authorization separate and use the encoder for the actual output context. The
repository-owned copy runs with `pnpm test:example`.

More complete examples cover
[basic usage](examples/basic-usage.js),
[Express integration](examples/express-middleware.js), and
[React rendering](examples/react-integration.jsx).

## 🧪 Testing Methodology

Our comprehensive test suite evaluates sanitizers against:

- **84 attack vectors** from OWASP, PortSwigger, cure53, and regression research
- **Advanced polyglot attacks** that combine multiple bypass techniques
- **Encoding variations** (Unicode, HTML entities, URL encoding)
- **Context-breaking attacks** for different HTML contexts
- **Modern browser vectors** including HTML5 and SVG attacks
- **Template injection** patterns from popular frameworks

### Test Categories:
1. **Basic XSS** - Standard script injection attempts
2. **Event Handlers** - Various HTML event attributes
3. **Protocol Variations** - javascript:, vbscript:, data: URIs
4. **CSS Expressions** - Style-based code execution
5. **Template Injection** - Framework-specific patterns
6. **Polyglot Attacks** - Multi-context bypass attempts
7. **Encoding Bypasses** - Obfuscation techniques
8. **Modern Vectors** - HTML5, SVG, and browser-specific attacks

## 📊 Detailed Comparison

### Security Comparison by Attack Type

Superseded by the two-axis benchmark above. The per-category percentages that
used to sit here came from a scoring rule that counted "output is empty" as a
win, so it rewarded deletion rather than safety and marked correct competitor
behaviour as failure. Run `pnpm test:fair` for numbers that survive scrutiny.

### Bundle Size Comparison

| Library | Category | Target | Minified | Gzip | Direct runtime deps |
|---------|----------|--------|----------|------|---------------------|
| **Purifai** | strip-text | browser | **3.5 KB** | **1.6 KB** | **0** |
| striptags | strip-text | browser | 2.1 KB | 1.1 KB | 0 |
| DOMPurify | preserve-html | browser | 28.0 KB | 10.6 KB | 0 |
| sanitize-html | preserve-html | Node | 192.2 KB | 70.4 KB | 7 |
| xss | preserve-html | browser | 18.4 KB | 6.2 KB | 2 |
| rehype-sanitize | preserve-html | browser | 244.5 KB | 70.7 KB | 2 |
| escape-html | escape-html | browser | 1.2 KB | 0.7 KB | 0 |
| validator.escape | escape-html | browser | 0.4 KB | 0.2 KB | 0 |
| entities.escapeUTF8 | escape-html | browser | 0.7 KB | 0.4 KB | 0 |
| html-entities | escape-html | browser | 34.8 KB | 13.1 KB | 0 |
| he.escape | escape-html | browser | 85.7 KB | 30.2 KB | 0 |

Measured by `pnpm test:size` with esbuild 0.27.7: smallest supported ESM
import, bundled and minified for ES2020, then gzipped. The lockfile pins the
exact library versions. DOMPurify is measured against the native browser API;
sanitize-html is a Node bundle; the rehype row includes the parser, sanitizer,
and serializer pipeline. Direct dependency counts come from each named package's
manifest. Compare sizes within a category and target—the tools do different jobs.

## 🌟 Use Cases

### Web Applications
```typescript
// Sanitize user-generated content
app.post('/comments', (req, res) => {
  const safeComment = Purifai.sanitize(req.body.comment);
  // Store safeComment in database
});
```

### Content Management Systems
```typescript
// Reduce rich text editor content to safe plain text.
// Note: Purifai strips ALL markup. If you need to KEEP <b>/<a href>,
// use DOMPurify or sanitize-html instead - that is a different job.
const cleanText = Purifai.sanitize(editorContent, {
  maxLength: 50000
});
```

### Real-time Chat
```typescript
// Clean messages before broadcasting
socket.on('message', (data) => {
  const result = analyze(data.message);
  // hadThreats/threatLevel are advisory telemetry, not an auth gate.
  broadcast(result.content);
});
```

## 🚦 Migration Guide

### From DOMPurify
```typescript
// Before
import DOMPurify from 'dompurify';
const clean = DOMPurify.sanitize(dirty);

// After  
import { sanitize } from 'purifai';
const clean = sanitize(dirty);
// Only migrate when dropping every tag is intended. Otherwise keep DOMPurify.
```

### From sanitize-html
```typescript
// Before
import sanitizeHtml from 'sanitize-html';
const clean = sanitizeHtml(dirty, options);

// After
import { sanitize } from 'purifai';
const clean = sanitize(dirty);
// Purifai removes all tags. If the migration needs to KEEP safe HTML,
// stay on sanitize-html - Purifai targets the strip-to-text case.
```

### From xss
```typescript
// Before
import xss from 'xss';
const clean = xss(dirty);

// After
import { sanitize } from 'purifai';
const clean = sanitize(dirty);
// Only migrate when dropping every tag is intended. Otherwise keep xss.
```

### From validator.js
```typescript
// Before
import validator from 'validator';
const clean = validator.escape(dirty);

// After: preserve the original encode-as-text behavior
import { escape } from 'purifai';
const clean = escape(dirty);
```

### From node-sanitize
```typescript
// Before
import sanitize from 'node-sanitize';
const clean = sanitize(dirty);

// After
import { sanitize } from 'purifai';
const clean = sanitize(dirty);
```

## 🔐 Security Features

### Defensive design
- **Forward-only scanning** with bounded adversarial scaling checks
- **Fail-closed raw-text removal** for unclosed scriptable containers
- **Context-specific encoders** instead of one output reused everywhere
- **No executable output observed** across the current 84-vector corpus

### Encoded Attack Detection
```typescript
// Markup variants are decoded before the strip-to-text scan:
'<script>alert(1)</script>'           // Direct
'&#60;script&#62;alert(1)&#60;/script&#62;'  // HTML entities
'%3Cscript%3Ealert(1)%3C/script%3E'   // URL encoded
'\\u003cscript\\u003ealert(1)\\u003c/script\\u003e' // Unicode
```

## 📈 Performance Optimization

`pnpm test:perf` measures two malformed-tag shapes from 2–128 KiB. In the
2026-08-02 Node 26.3.0 run, 64× larger inputs took 67.55× and 59.88× longer;
normalized cost stayed at 1.06× and 0.94×. These local results support the
scanner's near-linear design but are not a universal runtime guarantee.

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup
```bash
git clone https://github.com/moji2002/purifai.git
cd purifai
pnpm install
pnpm build
pnpm test
```

### Running Benchmarks
```bash
pnpm benchmark
```

This builds the published artifact, runs the two-axis competitor benchmark, and
then measures Purifai's throughput, critical-attack checks, and bundle size. The
competitor set and exact versions are pinned in `package.json` and
`pnpm-lock.yaml` so results are reproducible.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Security research from OWASP, PortSwigger, and the security community
- Inspiration from existing sanitization libraries
- Comprehensive testing methodologies from security experts

## 📚 Related Resources

- [OWASP XSS Prevention](https://owasp.org/www-community/xss-filter-evasion-cheatsheet)
- [PortSwigger XSS Labs](https://portswigger.net/web-security/cross-site-scripting)
- [MDN Web Security](https://developer.mozilla.org/en-US/docs/Web/Security)

---

**⚡ Need untrusted markup reduced to plain text? Install Purifai.**

```bash
npm install purifai
```

*Purifai — strip untrusted markup, keep the text.*
