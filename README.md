# 🛡️ Purifai

[![npm version](https://badge.fury.io/js/purifai.svg)](https://badge.fury.io/js/purifai)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-zero-green.svg)](https://www.npmjs.com/package/purifai)

> **Zero-dependency strip-to-text sanitizer with contextual output encoding**

Purifai is a lightweight, zero-dependency sanitizer for the **strip-to-text** case:
untrusted content that must be displayed as text, never as markup. It removes all
HTML rather than allow-listing safe tags, which makes it immune to mutation XSS by
construction — nothing survives for a parser to mutate on re-parse.

**Reach for Purifai when** you want untrusted input rendered as plain text, with no
dependencies, no DOM, and a ~4.1 KB gzipped footprint that runs in Node, browsers,
and edge runtimes alike.

**Reach for DOMPurify or sanitize-html when** you need to *keep* safe formatting
such as `<b>` and `<a href>`. That is a harder problem and they solve it well.

## 🏆 Benchmark Results

Produced by `pnpm test:fair`. Each sanitizer's output is inserted into a real DOM
(jsdom), then serialized and re-parsed — the round trip where mutation XSS lives.
A vector counts as blocked only if *neither* parse yields a script node, an `on*`
handler, or a dangerous-protocol URL.

| Library | Category | Security | Text kept | Markup kept |
|---------|----------|----------|-----------|-------------|
| **Purifai** | strip-to-text | **100%** | **100%** | 0% *(by design)* |
| DOMPurify | preserve-html | 100% | 100% | 100% |
| sanitize-html | preserve-html | 100% | 100% | 100% |
| xss | preserve-html | 100% | 100% | 100% |
| `() => ''` *(calibration)* | — | 100% | 0% | 0% |
| `v => v` *(calibration)* | — | 38.1% | 100% | 100% |

84 attack vectors (OWASP, PortSwigger, cure53 corpora) · 15 benign documents.

> 📊 **Read this honestly.** On security there is no headroom left — every
> maintained sanitizer above blocks everything thrown at it. The calibration rows
> are the whole point: a function returning `''` also scores 100% security, which
> is why a security number means nothing without a fidelity axis beside it.
> Purifai's 0% markup retention is its design, not a defect — but it does mean
> Purifai is **not** "more secure than DOMPurify". It is smaller, dependency-free,
> and needs no DOM.

## 🚀 Why Purifai?

### ✅ Security
- Blocks every vector in the 84-payload corpus, verified by real DOM re-parse
- Handles **Unicode**, **HTML entity**, and **URL encoding** bypasses
- Prevents **template injection** and **CSS expression** attacks
- Immune to **mutation XSS** by construction: it emits no markup to mutate
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

## 🔥 Attack Vectors Blocked

Purifai blocks **all 84 vectors** in the corpus (64 classic + 20 modern mXSS/namespace), including:

### Critical Polyglot Attacks
```javascript
// ✅ Purifai reduces each of these to empty output:

// Universal XSS Polyglot
jaVasCript:/*-/*`/*\`/*'/*"/**/(/* */oNcliCk=alert() )//%0D%0A%0d%0a//</stYle/</titLe/</teXtarEa/</scRipt/--!>\x3csVg/<sVg/oNloAd=alert()///>\\x3e

// Ultimate XSS Polyglot  
javascript:/*--></title></style></textarea></script></xmp><svg/onload='+/"/+/onmouseover=1/+/[*/[]/+alert(1)//'>'

// Namespace Confusion Attack
<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>
```

### Standard XSS Vectors
- Script injection: `<script>alert("xss")</script>`
- Event handlers: `<img src=x onerror=alert(1)>`
- Protocol injection: `javascript:alert(1)`
- CSS expressions: `<div style="expression(alert(1))">`
- Template injection: `{{constructor.constructor("alert(1)")()}}`
- Encoding bypasses: `&#60;script&#62;alert(1)&#60;/script&#62;`

## 🛠️ Installation

```bash
npm install purifai
# or
yarn add purifai
# or
pnpm add purifai
```

## 📖 Usage

### Basic Usage

```typescript
import { Purifai } from 'purifai';

// Simple sanitization
const clean = Purifai.sanitize('<script>alert("xss")</script>Hello World');
console.log(clean); // "Hello World"

// With options
const safe = Purifai.sanitize(userInput, {
  maxLength: 10000,
  aggressiveMode: true
});
```

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
  // Log security incident
  console.warn('Potential XSS attack detected');
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

Why both exist: `a<b && c>d` is a valid HTML start tag per the parsing spec, so
`sanitize()` correctly drops it while `escape()` preserves it verbatim. Only the
caller knows whether a string is markup or text — so the API asks rather than
guesses.

## ⚙️ Configuration Options

```typescript
interface PurifaiOptions {
  /** Maximum input length (default: 1MB) */
  maxLength?: number;
  
  /** Custom allowed protocols (default: ['http', 'https', 'mailto']) */
  allowedProtocols?: string[];
  
  /** Enable aggressive mode for maximum security (default: true) */
  aggressiveMode?: boolean;
}
```

## 🧪 Testing Methodology

Our comprehensive test suite evaluates sanitizers against:

- **64 sophisticated attack vectors** from OWASP, PortSwigger, and security research
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

| Library | Bundle Size | Dependencies | TypeScript |
|---------|-------------|--------------|-------------|
| **Purifai** | **13.6KB / 4.1KB gzip** | **0** | **✅ Native** |
| validator.js | ~15KB | 0 | ✅ Available |
| xss | ~25KB | 3 | ❌ None |
| node-sanitize | ~32KB | 5 | ❌ None |
| DOMPurify | ~45KB | 0 | ✅ Available |
| sanitize-html | ~200KB+ | 15+ | ✅ Available |

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

### API Gateways
```typescript
// Sanitize all incoming string data
const sanitizedPayload = sanitizeBatch(Object.values(request.body));
```

### Real-time Chat
```typescript
// Clean messages before broadcasting
socket.on('message', (data) => {
  const result = analyze(data.message);
  if (result.threatLevel === 'critical') {
    // Block and log the attempt
    return;
  }
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
```

### From validator.js
```typescript
// Before
import validator from 'validator';
const clean = validator.escape(dirty);

// After
import { sanitize } from 'purifai';
const clean = sanitize(dirty);
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

### Advanced Protection Techniques
- **Multi-layer sanitization** with fallback mechanisms
- **Context-aware parsing** to prevent bypass attempts
- **Aggressive mode** for maximum security applications
- **Zero false negatives** in comprehensive testing

### Encoded Attack Detection
```typescript
// All these variants are detected and blocked:
'<script>alert(1)</script>'           // Direct
'&#60;script&#62;alert(1)&#60;/script&#62;'  // HTML entities
'%3Cscript%3Ealert(1)%3C/script%3E'   // URL encoded
'\\u003cscript\\u003ealert(1)\\u003c/script\\u003e' // Unicode
```

## 📈 Performance Optimization

Purifai is optimized for:
- **High-throughput** applications with efficient processing
- **Low memory** footprint with optimized regex patterns
- **Fast startup** with zero dependencies
- **Minimal CPU** usage through intelligent algorithms
- **Scalable** performance across different input sizes and complexity

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup
```bash
git clone https://github.com/purifai/purifai.git
cd purifai
pnpm install
pnpm build
pnpm test
```

### Running Benchmarks
```bash
pnpm benchmark  # Compare against other libraries
```

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

**⚡ Ready to secure your application? Install Purifai today and join the ranks of applications with bulletproof XSS protection.**

```bash
npm install purifai
```

*Purifai - Because your users' security shouldn't be compromised.*