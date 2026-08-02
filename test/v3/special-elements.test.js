import test from 'node:test';
import assert from 'node:assert/strict';
import { convert, createTextTransform, toText } from '../../dist/index.js';

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

test('drops source and non-reader bodies', () => {
  assert.equal(toText('<script/>alert(1)</script><p>Keep</p>'), 'Keep');
  assert.equal(toText('<style>.x{color:red}</style><p>Keep</p>'), 'Keep');
  assert.equal(toText('<iframe>fallback</iframe><template><p>hidden</p></template>Keep'), 'Keep');
  assert.equal(toText('<svg><text>foreign</text></svg><math><mi>x</mi></math>Keep'), 'Keep');
});

test('preserves selected fallback and control text', () => {
  assert.equal(toText('<object><p>Object fallback</p></object>'), 'Object fallback');
  assert.equal(toText('<canvas>Canvas fallback</canvas> <video>Video fallback</video>'), 'Canvas fallback Video fallback');
  assert.equal(toText('<textarea>A&amp;B\nC</textarea>'), 'A&B\nC');
  assert.equal(toText('<xmp>A&amp;B\n C</xmp>'), 'A&amp;B\n C');
});

test('plaintext consumes through EOF', () => {
  assert.equal(toText('A<plaintext><b>B</b>&amp;</plaintext>C'), 'A\n\n<b>B</b>&amp;</plaintext>C');
});

test('malformed head exits on reader content', () => {
  assert.equal(toText('<head><title>Meta</title><meta name=x><body><h1>Reader</h1>'), 'Reader');
  assert.equal(toText('<head>Reader text<p>Body</p>'), 'Reader text\n\nBody');
});

test('drops raw and lexically nested omission classes through bounded EOF', () => {
  assert.equal(toText('<noscript>no</noscript><noembed>no</noembed><noframes>no</noframes>Yes'), 'Yes');
  assert.equal(toText('<applet><applet>nested</applet>hidden</applet>Yes'), 'Yes');
  assert.equal(toText('<frameset><frame>hidden</frameset>Yes'), 'Yes');
  assert.equal(toText('<template>one<template>two</template>three</template>Yes'), 'Yes');
  assert.equal(toText('<script>one<script>two</script>Yes'), 'Yes');
  assert.equal(toText('Before<style>never closes'), 'Before');
});

test('reports fixed dropped-container counts', () => {
  const result = convert('<script>x</script><template>x</template><svg>x</svg><p>Keep</p>');
  assert.equal(result.text, 'Keep');
  assert.deepEqual(Object.fromEntries(Object.entries(result.droppedContainers).sort()), {
    script: 1,
    svg: 1,
    template: 1,
  });
  assert.equal(Object.getPrototypeOf(result.droppedContainers), null);
  assert.equal(Object.isFrozen(result.droppedContainers), true);
});

test('recognizes raw closing tags across chunks', async () => {
  const chunks = ['<sty', 'le>hidden</st', 'yle><text', 'area>A&amp;', 'B</text', 'area>Keep'];
  assert.equal(await streamText(chunks), 'A&B\n\nKeep');
  assert.equal(await streamText(['<xmp>A&am', 'p;\nB</x', 'mp>C']), 'A&amp;\nB\n\nC');
});
