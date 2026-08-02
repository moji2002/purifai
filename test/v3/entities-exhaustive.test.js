import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTextTransform, toText } from '../../dist/index.js';

const entities = JSON.parse(
  await readFile(new URL('../../vendor/whatwg/entities.json', import.meta.url), 'utf8'),
);

function formattedText(value) {
  return value
    .replace(/\r\n?/g, '\n')
    .replaceAll('\u0000', '\uFFFD')
    .replace(/[\t\n\f\r ]+/g, ' ')
    .replace(/^ +| +$/g, '');
}

async function streamText(chunks) {
  const transform = createTextTransform();
  const reader = transform.readable.getReader();
  const writer = transform.writable.getWriter();
  const output = [];
  const reading = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      output.push(value);
    }
  })();
  for (const chunk of chunks) await writer.write(chunk);
  await writer.close();
  await reading;
  await transform.result;
  return output.join('');
}

test('decodes every pinned WHATWG named reference', () => {
  for (const [reference, entry] of Object.entries(entities)) {
    assert.equal(toText(reference), formattedText(entry.characters), reference);
  }
});

test('decodes every named reference across every possible split', async () => {
  for (const [reference, entry] of Object.entries(entities)) {
    const expected = formattedText(entry.characters);
    for (let split = 0; split <= reference.length; split += 1) {
      assert.equal(
        await streamText([reference.slice(0, split), reference.slice(split)]),
        expected,
        `${reference} at ${split}`,
      );
    }
  }
});

test('implements numeric replacement boundaries and every C1 mapping', () => {
  const c1 = new Map([
    [0x80, 0x20AC], [0x82, 0x201A], [0x83, 0x0192], [0x84, 0x201E],
    [0x85, 0x2026], [0x86, 0x2020], [0x87, 0x2021], [0x88, 0x02C6],
    [0x89, 0x2030], [0x8A, 0x0160], [0x8B, 0x2039], [0x8C, 0x0152],
    [0x8E, 0x017D], [0x91, 0x2018], [0x92, 0x2019], [0x93, 0x201C],
    [0x94, 0x201D], [0x95, 0x2022], [0x96, 0x2013], [0x97, 0x2014],
    [0x98, 0x02DC], [0x99, 0x2122], [0x9A, 0x0161], [0x9B, 0x203A],
    [0x9C, 0x0153], [0x9E, 0x017E], [0x9F, 0x0178],
  ]);
  for (let value = 0x80; value <= 0x9F; value += 1) {
    assert.equal(toText(`&#${value};`), String.fromCodePoint(c1.get(value) ?? value));
  }
  assert.equal(toText('&#0;'), '�');
  assert.equal(toText('&#55295;'), String.fromCodePoint(0xD7FF));
  assert.equal(toText('&#55296; &#56319; &#56320; &#57343;'), '� � � �');
  assert.equal(toText('&#57344;'), String.fromCodePoint(0xE000));
  assert.equal(toText('&#1114111;'), String.fromCodePoint(0x10FFFF));
  assert.equal(toText('&#1114112; &#999999999999999999999;'), '� �');
});
