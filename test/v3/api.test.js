import test from 'node:test';
import assert from 'node:assert/strict';
import * as purifai from '../../dist/index.js';

test('exports only the v3 runtime values', () => {
  assert.deepEqual(Object.keys(purifai).sort(), [
    'PurifaiLimitError',
    'convert',
    'createTextTransform',
    'escapeHtmlText',
    'toText',
  ]);
  assert.equal('default' in purifai, false);
  assert.equal('Purifai' in purifai, false);
  assert.equal('sanitize' in purifai, false);
});

test('converts plain reader text and normalizes preprocessing', () => {
  assert.equal(purifai.toText('  Alpha\r\n\tBeta\u0000Gamma  '), 'Alpha Beta�Gamma');
  assert.equal(purifai.toText('Alpha\n\n\nBeta'), 'Alpha Beta');
});

test('compact and readable are validated enum values', () => {
  assert.equal(purifai.toText(' Alpha  Beta ', { layout: 'compact' }), 'Alpha Beta');
  assert.throws(() => purifai.toText('x', { layout: 'wide' }), TypeError);
});

test('rejects non-strings and unknown keys', () => {
  assert.throws(() => purifai.toText(null), TypeError);
  assert.throws(() => purifai.toText('x', { maxLength: 4 }), TypeError);
  assert.throws(() => purifai.toText('x', { limits: { bytes: 4 } }), TypeError);
  assert.throws(() => purifai.toText('x', { overflow: 'truncate' }), TypeError);
});

test('escapeHtmlText encodes exactly the five HTML text delimiters', () => {
  assert.equal(
    purifai.escapeHtmlText(`&<>"' /`),
    '&amp;&lt;&gt;&quot;&#39; /',
  );
  assert.throws(() => purifai.escapeHtmlText(1), TypeError);
});
