import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextTransform, toText } from '../../dist/index.js';

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

test('removes markup while preserving inline text', () => {
  assert.equal(toText('<p>Hello <b>brave</b> world</p>'), 'Hello brave world');
  assert.equal(toText('<custom>A</custom><wbr>B'), 'AB');
});

test('handles comments declarations and literal less-than', () => {
  assert.equal(toText('A<!-- hidden -->B<!doctype html>C'), 'ABC');
  assert.equal(toText('5 < 6 and 7 > 3'), '5 < 6 and 7 > 3');
});

test('uses HTML self-closing semantics', () => {
  assert.equal(toText('<div/>A</div>B'), 'A\n\nB');
  assert.equal(toText('<br/>A'), 'A');
});

test('defines malformed EOF recovery', () => {
  assert.equal(toText('A <broken attr="x'), 'A <broken attr="x');
  assert.equal(toText('A <!-- hidden'), 'A');
  assert.equal(toText('A </unmatched>B'), 'A B');
});

test('is invariant across scanner and preprocessing boundaries', async () => {
  const cases = [
    ['A\r', '\nB'],
    ['<di', 'v>A</d', 'iv>B'],
    ['<p title="a', '>b">A</p>'],
    ['A<!-', '- hidden -', '->B'],
    ['A \uD83D', '\uDE00 B'],
  ];
  for (const chunks of cases) {
    assert.equal(await streamText(chunks), toText(chunks.join('')), chunks.join('|'));
  }
});
