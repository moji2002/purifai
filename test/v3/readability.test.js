import test from 'node:test';
import assert from 'node:assert/strict';
import { toText } from '../../dist/index.js';
import { READABILITY_FIXTURES } from './fixtures/readability.js';

for (const fixture of READABILITY_FIXTURES) {
  test(`readable: ${fixture.name}`, () => {
    assert.equal(toText(fixture.html), fixture.readable);
  });

  test(`compact: ${fixture.name}`, () => {
    assert.equal(toText(fixture.html, { layout: 'compact' }), fixture.compact);
  });
}
