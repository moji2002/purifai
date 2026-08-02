import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitize,
  escape,
  escapeAttribute,
  escapeUrl,
} from '../dist/index.js';

test('consumer can reduce untrusted markup to plain text', () => {
  assert.equal(
    sanitize('<script>bad()</script><p>Hello <b>world</b></p>'),
    'Hello world',
  );
});

test('consumer can encode values for their destination context', () => {
  assert.equal(escape('a<b && c>d'), 'a&lt;b &amp;&amp; c&gt;d');
  assert.equal(escapeAttribute('x onmouseover=bad()'), 'x&#x20;onmouseover&#x3d;bad&#x28;&#x29;');
  assert.equal(escapeUrl('javascript:alert(1)'), '');
  assert.equal(escapeUrl('//evil.example/path'), '');
  assert.notEqual(escapeUrl('https://example.com/docs'), '');
});
