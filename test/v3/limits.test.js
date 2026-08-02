import test from 'node:test';
import assert from 'node:assert/strict';
import { convert, PurifaiLimitError, toText } from '../../dist/index.js';

function isLimit(kind, limit, observed) {
  return (error) => error instanceof PurifaiLimitError
    && error.kind === kind
    && error.limit === limit
    && error.observed === observed;
}

test('throws deterministic errors from toText', () => {
  assert.throws(() => toText('12345', { limits: { input: 4 } }), isLimit('input', 4, 5));
  assert.throws(
    () => toText('<div><div>x</div></div>', { limits: { depth: 1 } }),
    isLimit('depth', 1, 2),
  );
  assert.throws(() => toText('12345', { limits: { output: 4 } }), isLimit('output', 4, 5));
  assert.throws(() => toText('<broken', { limits: { token: 3 } }), isLimit('token', 3, 4));
});

test('convert truncates only when explicitly requested', () => {
  assert.throws(() => convert('12345', { limits: { output: 4 } }), isLimit('output', 4, 5));
  const result = convert('12345', { limits: { output: 4 }, overflow: 'truncate' });
  assert.equal(result.text, '1234');
  assert.equal(result.truncatedBy, 'output');
  assert.equal(result.scanComplete, false);
  assert.equal(result.consumedInputCodeUnits, 5);
  assert.equal(result.outputCodeUnits, 4);
  assert.deepEqual(Object.keys(result.droppedContainers), []);
});

test('never cuts an emitted surrogate pair', () => {
  assert.equal(convert('A😀B', {
    limits: { output: 2 },
    overflow: 'truncate',
  }).text, 'A');
  const input = convert('A😀B', {
    limits: { input: 2 },
    overflow: 'truncate',
  });
  assert.equal(input.text, 'A');
  assert.equal(input.consumedInputCodeUnits, 1);
  assert.equal(input.truncatedBy, 'input');
});

test('enforces zero limits and validates every limit value', () => {
  for (const kind of ['input', 'output', 'depth', 'token']) {
    const html = kind === 'depth' ? '<div>x</div>' : kind === 'token' ? '<x' : 'x';
    assert.throws(() => toText(html, { limits: { [kind]: 0 } }), isLimit(kind, 0, 1));
  }
  for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => toText('x', { limits: { input: invalid } }), TypeError);
  }
});

test('charges incomplete syntax and aggregate live href values', () => {
  assert.throws(
    () => toText('<a href="unterminated', { limits: { token: 8 } }),
    isLimit('token', 8, 9),
  );
  assert.throws(
    () => toText('<a href="12345"><a href="67890">x</a></a>', {
      limits: { token: 20, depth: 10 },
    }),
    isLimit('token', 20, 21),
  );
});

test('discards pending whitespace and boundaries on output truncation', () => {
  assert.equal(convert('A B', {
    limits: { output: 1 },
    overflow: 'truncate',
  }).text, 'A');
  assert.equal(convert('A<p>B</p>', {
    limits: { output: 2 },
    overflow: 'truncate',
  }).text, 'A');
  assert.equal(convert('<ol><li>X</li></ol>', {
    limits: { output: 3 },
    overflow: 'truncate',
  }).text, '');
});

test('freezes reports and keeps dropped counters after truncation', () => {
  const result = convert('<script>x</script>ABCDE', {
    limits: { output: 2 },
    overflow: 'truncate',
  });
  assert.equal(result.text, 'AB');
  assert.equal(result.droppedContainers.script, 1);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.droppedContainers), true);
  assert.equal(Object.getPrototypeOf(result.droppedContainers), null);
  assert.throws(() => { result.text = 'changed'; }, TypeError);
});

test('the first limit reached wins deterministically', () => {
  const result = convert('<div>x</div>', {
    limits: { input: 0, output: 0, depth: 0, token: 0 },
    overflow: 'truncate',
  });
  assert.equal(result.truncatedBy, 'input');
  assert.equal(result.consumedInputCodeUnits, 0);
  assert.equal(result.text, '');
});
