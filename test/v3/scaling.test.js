import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

function measurement(script, env = {}) {
  const result = spawnSync(process.execPath, [resolve(root, `scripts/${script}`)], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 20 * 60 * 1000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.notEqual(result.stdout.trim(), '', `${script} returned no measurement`);
  return JSON.parse(result.stdout);
}

test('release resource measurements enforce real non-missing bounds', () => {
  const size = measurement('verify-size.mjs', { PURIFAI_PACK_COMMAND: 'npm' });
  const scaling = measurement('verify-scaling.mjs');
  assert.equal(size.runtimeDependencies, 0);
  assert.ok(size.esmGzipLevel9Bytes <= 25 * 1024);
  assert.equal(size.entityDataIncluded, true);
  assert.ok(scaling.maxTimeSlope <= 1.15);
  assert.ok(scaling.maxStreamingRssGrowthBytes <= 8 * 1024 * 1024);
});
