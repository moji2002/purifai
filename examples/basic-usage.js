import {
  analyze,
  escape,
  escapeAttribute,
  escapeUrl,
  sanitize,
  sanitizeBatch,
} from 'purifai';

// Convert markup-bearing input to reader text. All tags are removed.
const comment = sanitize('<script>bad()</script><p>Hello <b>world</b></p>');
console.log(comment); // Hello world

// Plain text should use the encoder for its destination context.
console.log(escape('a<b && c>d'));
console.log(escapeAttribute('x onmouseover=bad()'));
console.log(escapeUrl('https://example.com/docs'));
console.log(escapeUrl('javascript:alert(1)')); // ""

console.log(sanitizeBatch([
  '<style>body{display:none}</style><p>First</p>',
  '<iframe>hidden</iframe><p>Second</p>',
])); // ["First", "Second"]

// Analysis is advisory telemetry. A transformation or threat classification is
// not an authorization decision and should not block an otherwise valid user.
console.log(analyze('<script>bad()</script>Hello'));
