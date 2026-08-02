import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convert,
  createTextTransform,
  PurifaiLimitError,
} from '../../dist/index.js';
import {
  everyTwoWaySplit,
  fixedChunks,
  oneUnitChunks,
  seededChunks,
} from './helpers/chunks.js';

async function runStream(chunks, options) {
  const transform = createTextTransform(options);
  const output = [];
  const reader = transform.readable.getReader();
  const writer = transform.writable.getWriter();
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
  return { chunks: output, report: await transform.result, transform };
}

async function assertChunkInvariant(html, options, partitions) {
  const expected = convert(html, options);
  for (const chunks of partitions) {
    const actual = await runStream(chunks, options);
    assert.equal(actual.chunks.join(''), expected.text, chunks.join('|'));
    assert.equal(actual.report.truncatedBy, null);
    assert.equal(actual.report.scanComplete, true);
    assert.equal(actual.report.consumedInputCodeUnits, expected.consumedInputCodeUnits);
    assert.equal(actual.report.outputCodeUnits, expected.outputCodeUnits);
    assert.deepEqual(actual.report.droppedContainers, expected.droppedContainers);
    assert.equal(Object.isFrozen(actual.report), true);
  }
}

test('is invariant across scanner, entity, raw, CRLF, and surrogate partitions', async () => {
  const fixtures = [
    'A\r\nB\uD83D\uDE00C',
    '<p title="a>b">A&amp;&#x41;</p><!--x--><div>B</div>',
    '<style>hidden</style><textarea>A&amp;B\nC</textarea>',
    '<template><template>x</template></template><p>Keep</p>',
    'A<plaintext><b>B</b>&amp;</plaintext>C',
    '<a href="/x?y=1&amp;z=2">Link</a><img alt="A&amp;B">',
  ];
  const options = { links: 'label-and-url', baseUrl: 'https://example.com/base/' };
  for (const html of fixtures) {
    const partitions = [
      [html],
      oneUnitChunks(html),
      fixedChunks(html, 2),
      fixedChunks(html, 7),
      seededChunks(html, 0xC0FFEE),
      ...everyTwoWaySplit(html),
    ];
    await assertChunkInvariant(html, options, partitions);
  }
});

test('result remains pending until close and then resolves with the final report', async () => {
  const transform = createTextTransform();
  let settled = false;
  transform.result.then(() => { settled = true; });
  const reader = transform.readable.getReader();
  const writer = transform.writable.getWriter();
  const reading = reader.read();
  await writer.write('A');
  await Promise.resolve();
  assert.equal(settled, false);
  await writer.close();
  assert.deepEqual(await reading, { done: false, value: 'A' });
  assert.deepEqual(await reader.read(), { done: true, value: undefined });
  const report = await transform.result;
  assert.equal(settled, true);
  assert.equal(report.scanComplete, true);
});

test('non-string chunks error both sides and result with the same object', async () => {
  const transform = createTextTransform();
  const reader = transform.readable.getReader();
  const writer = transform.writable.getWriter();
  const resultReason = transform.result.catch((error) => error);
  const readReason = reader.read().catch((error) => error);
  const writeReason = writer.write(42).catch((error) => error);
  const [fromWrite, fromRead, fromResult] = await Promise.all([writeReason, readReason, resultReason]);
  assert.equal(fromWrite instanceof TypeError, true);
  assert.strictEqual(fromRead, fromWrite);
  assert.strictEqual(fromResult, fromWrite);
});

test('limit overflow errors both sides and result with the same object', async () => {
  const transform = createTextTransform({ limits: { output: 1 } });
  const reader = transform.readable.getReader();
  const writer = transform.writable.getWriter();
  const resultReason = transform.result.catch((error) => error);
  const readReason = reader.read().catch((error) => error);
  const writeReason = writer.write('AB').catch((error) => error);
  const [fromWrite, fromRead, fromResult] = await Promise.all([writeReason, readReason, resultReason]);
  assert.equal(fromWrite instanceof PurifaiLimitError, true);
  assert.deepEqual(
    { kind: fromWrite.kind, limit: fromWrite.limit, observed: fromWrite.observed },
    { kind: 'output', limit: 1, observed: 2 },
  );
  assert.strictEqual(fromRead, fromWrite);
  assert.strictEqual(fromResult, fromWrite);
});

test('readable cancellation follows native TransformStream propagation', async () => {
  const reason = new Error('consumer stopped');
  const transform = createTextTransform();
  const reader = transform.readable.getReader();
  const writer = transform.writable.getWriter();
  await reader.cancel(reason);
  await assert.rejects(writer.closed, (error) => error === reason);
});

test('emits bounded chunks without splitting surrogate pairs', async () => {
  const text = `A${'😀'.repeat(3_000)}B`;
  const actual = await runStream([text]);
  assert.equal(actual.chunks.join(''), text);
  for (const chunk of actual.chunks) {
    assert.equal(chunk.length <= 4_096, true);
    const final = chunk.charCodeAt(chunk.length - 1);
    assert.equal(final >= 0xD800 && final <= 0xDBFF, false);
  }
});
