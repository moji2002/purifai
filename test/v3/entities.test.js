import test from 'node:test';
import assert from 'node:assert/strict';
import { toText } from '../../dist/index.js';

test('decodes named references with longest-match behavior', () => {
  assert.equal(toText('&amp; &copy &notin; &notit;'), '& © ∉ ¬it;');
  assert.equal(toText('&NotEqualTilde;'), '≂̸');
  assert.equal(toText('&lt;script&gt;'), '<script>');
});

test('decodes numeric references with WHATWG replacement behavior', () => {
  assert.equal(toText('&#65; &#x41; &#0; &#xD800; &#x110000;'), 'A A � � �');
  assert.equal(toText('&#128;'), '€');
});

test('does not reinterpret decoded markup', () => {
  assert.equal(toText('&lt;script&gt;alert(1)&lt;/script&gt;'), '<script>alert(1)</script>');
});
