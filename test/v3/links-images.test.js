import test from 'node:test';
import assert from 'node:assert/strict';
import { toText } from '../../dist/index.js';

test('applies link modes', () => {
  const html = '<a href="https://example.com/a?x=1&amp;y=2">Docs</a>';
  assert.equal(toText(html), 'Docs');
  assert.equal(toText(html, { links: 'label-and-url' }), 'Docs [https://example.com/a?x=1&y=2]');
  assert.equal(toText(html, { links: 'drop' }), '');
});

test('resolves only accepted display destinations', () => {
  assert.equal(toText('<a href="/guide">Guide</a>', {
    links: 'label-and-url',
    baseUrl: 'https://example.com/docs/',
  }), 'Guide [https://example.com/guide]');
  assert.equal(toText('<a href="javascript:alert(1)">Bad</a>', { links: 'label-and-url' }), 'Bad');
  assert.equal(toText('<a href="//evil.test/x">Bad</a>', { links: 'label-and-url' }), 'Bad');
  assert.equal(toText('<a href="https://u:p@example.com/">Bad</a>', { links: 'label-and-url' }), 'Bad');
});

test('emits only context-decoded image alt text', () => {
  assert.equal(toText('A<img alt="Tom &amp; Jerry" src="javascript:1">B'), 'A Tom & Jerry B');
  assert.equal(toText('A<img alt="ignored">B', { images: 'drop' }), 'A B');
  assert.equal(toText('<img alt="">'), '');
});

test('applies semicolonless attribute rules', () => {
  assert.equal(toText('<img alt="&copy=">'), '&copy=');
  assert.equal(toText('<img alt="&copy;=">'), '©=');
});

test('accepts only supported absolute URL schemes', () => {
  const options = { links: 'label-and-url' };
  assert.equal(toText('<a href="HTTP://EXAMPLE.COM/a">H</a>', options), 'H [http://example.com/a]');
  assert.equal(toText('<a href="https://example.com/a b">S</a>', options), 'S [https://example.com/a%20b]');
  assert.equal(toText('<a href="mailto:dev@example.com">M</a>', options), 'M [mailto:dev@example.com]');
  assert.equal(toText('<a href="/relative">R</a>', options), 'R');
});

test('rejects control, ambiguous, and credentialed destinations', () => {
  const options = { links: 'label-and-url', baseUrl: 'https://base.test/' };
  const rejected = [
    'http&#x0A;://example.com',
    'java script:alert(1)',
    '\\\\evil.test/x',
    '//evil.test/x',
    'ftp://example.com/x',
    'https://user@example.com/x',
  ];
  for (const href of rejected) {
    assert.equal(toText(`<a href="${href}">Label</a>`, options), 'Label', href);
  }
});

test('handles empty labels, nested anchors, and long labels without retaining them', () => {
  assert.equal(
    toText('<a href="https://example.com/"></a>', { links: 'label-and-url' }),
    '[https://example.com/]',
  );
  assert.equal(
    toText('<a href="https://outer.test/">A<a href="https://inner.test/">B</a>C</a>', { links: 'label-and-url' }),
    'AB [https://inner.test/]C [https://outer.test/]',
  );
  const label = 'x'.repeat(5_000);
  assert.equal(
    toText(`<a href="https://example.com/">${label}</a>`, {
      links: 'label-and-url',
      limits: { token: 64 },
    }),
    `${label} [https://example.com/]`,
  );
});
