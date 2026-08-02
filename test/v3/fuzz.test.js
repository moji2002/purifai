import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convert,
  createTextTransform,
  PurifaiLimitError,
  toText,
} from '../../dist/index.js';
import { oneUnitChunks } from './helpers/chunks.js';

const SEED = 20_260_802;
const CASES = 10_000;

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const PARTS = [
  'text', ' ', '\r', '\n', '😀', '&amp;', '&#x80;', '&notit;', '&broken',
  '<', '>', '<div>', '</div>', '<a href="/x">', '</a>', '<img alt="A&amp;B">',
  '<!--', '-->', '<script>', '</script>', '<style>', '</style>',
  '<textarea>', '</textarea>', '<xmp>', '</xmp>', '<plaintext>',
  '<template>', '</template>', '<svg>', '</svg>', '<p title="a>b">', '</p>',
  '<broken attr="', "'", '"', '/', '=', '\u0000',
];

function generatedCase(random, index) {
  if (index % 211 === 0) return '<div>'.repeat(80) + 'x' + '</div>'.repeat(80);
  if (index % 197 === 0) return '<!--'.repeat(40) + 'tail';
  const count = 1 + Math.floor(random() * 12);
  let value = '';
  for (let part = 0; part < count; part += 1) {
    value += PARTS[Math.floor(random() * PARTS.length)];
  }
  return value;
}

function generatedOptions(random, index) {
  if (index % 5 !== 0) return index % 2 === 0 ? { layout: 'readable' } : { layout: 'compact' };
  return {
    layout: index % 2 === 0 ? 'readable' : 'compact',
    links: index % 3 === 0 ? 'label-and-url' : 'label',
    baseUrl: 'https://example.test/base/',
    limits: {
      input: Math.floor(random() * 96),
      output: Math.floor(random() * 96),
      depth: Math.floor(random() * 12),
      token: Math.floor(random() * 48),
    },
  };
}

function errorFields(error) {
  return { kind: error.kind, limit: error.limit, observed: error.observed };
}

async function streamOutcome(html, options) {
  const transform = createTextTransform(options);
  const reader = transform.readable.getReader();
  const writer = transform.writable.getWriter();
  const output = [];
  const reading = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return { error: null };
        output.push(value);
      }
    } catch (error) {
      return { error };
    }
  })();
  const result = transform.result.then(
    (report) => ({ report, error: null }),
    (error) => ({ report: null, error }),
  );
  let writeError = null;
  try {
    for (const chunk of oneUnitChunks(html)) await writer.write(chunk);
    await writer.close();
  } catch (error) {
    writeError = error;
  }
  const [readOutcome, resultOutcome] = await Promise.all([reading, result]);
  return { text: output.join(''), writeError, readOutcome, resultOutcome };
}

test(`seeded malformed-input properties (${SEED}, ${CASES} cases)`, async () => {
  const random = mulberry32(SEED);
  for (let index = 0; index < CASES; index += 1) {
    const html = generatedCase(random, index);
    const options = generatedOptions(random, index);
    let expectedError = null;
    let first = null;
    try {
      const text = toText(html, options);
      const secondText = toText(html, options);
      assert.equal(secondText, text, `toText deterministic at ${index}`);
      first = convert(html, options);
      const second = convert(html, options);
      assert.deepEqual(second, first, `convert deterministic at ${index}`);
      assert.equal(first.text, text, `public adapters agree at ${index}`);
      assert.equal(Object.isFrozen(first), true, `result frozen at ${index}`);
      assert.equal(Object.isFrozen(first.droppedContainers), true, `counters frozen at ${index}`);
      assert.equal(first.consumedInputCodeUnits <= (options.limits?.input ?? 1_000_000), true);
      assert.equal(first.outputCodeUnits <= (options.limits?.output ?? 250_000), true);
      const final = text.charCodeAt(text.length - 1);
      assert.equal(final >= 0xD800 && final <= 0xDBFF, false, `surrogate boundary at ${index}`);
    } catch (error) {
      assert.equal(error instanceof PurifaiLimitError, true, `unexpected error at ${index}: ${error}`);
      expectedError = error;
    }

    const streamed = await streamOutcome(html, options);
    if (expectedError !== null) {
      assert.equal(streamed.writeError instanceof PurifaiLimitError, true, `stream error at ${index}`);
      assert.deepEqual(errorFields(streamed.writeError), errorFields(expectedError), `error fields at ${index}`);
      assert.strictEqual(streamed.readOutcome.error, streamed.writeError, `read error identity at ${index}`);
      assert.strictEqual(streamed.resultOutcome.error, streamed.writeError, `result error identity at ${index}`);
    } else {
      assert.equal(streamed.writeError, null, `unexpected stream write error at ${index}`);
      assert.equal(streamed.readOutcome.error, null, `unexpected stream read error at ${index}`);
      assert.equal(streamed.resultOutcome.error, null, `unexpected stream result error at ${index}`);
      assert.equal(streamed.text, first.text, `stream text at ${index}`);
      assert.equal(streamed.resultOutcome.report.scanComplete, true, `stream report at ${index}`);
    }
  }
});
