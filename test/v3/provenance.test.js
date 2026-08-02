import assert from 'node:assert/strict';
import test from 'node:test';

import { statementMatches } from '../../scripts/provenance.mjs';

const expected = {
  name: 'purifai',
  version: '3.0.0',
  tarballSha512Hex: 'abc123',
  githubSha: 'bf8c8dcf122b916b502644bc6feaf4149c368757',
};

function statement(type) {
  return {
    _type: type,
    subject: [{
      name: 'pkg:npm/purifai@3.0.0',
      digest: { sha512: 'abc123' },
    }],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        resolvedDependencies: [{
          uri: 'git+https://github.com/moji2002/purifai@refs/tags/v3.0.0',
          digest: { gitCommit: expected.githubSha },
        }],
      },
    },
  };
}

test('accepts npm provenance using current and legacy in-toto statement versions', () => {
  assert.equal(statementMatches(statement('https://in-toto.io/Statement/v1'), expected), true);
  assert.equal(statementMatches(statement('https://in-toto.io/Statement/v0.1'), expected), true);
});

test('rejects provenance for a different source commit', () => {
  const mismatched = statement('https://in-toto.io/Statement/v1');
  mismatched.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = '0'.repeat(40);
  assert.equal(statementMatches(mismatched, expected), false);
});
