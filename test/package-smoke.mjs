import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const temporary = await mkdtemp(join(tmpdir(), 'purifai-package-'));
const packCommand = process.env.PURIFAI_PACK_COMMAND ?? 'pnpm';

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

async function filesBelow(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await filesBelow(join(directory, entry.name), relative));
    else result.push(relative);
  }
  return result;
}

async function streamText(api, html) {
  const transform = api.createTextTransform();
  const output = [];
  const reading = (async () => {
    for await (const chunk of transform.readable) output.push(chunk);
  })();
  const writer = transform.writable.getWriter();
  await writer.write(html.slice(0, 7));
  await writer.write(html.slice(7));
  await writer.close();
  await reading;
  await transform.result;
  return output.join('');
}

try {
  const packArgs = packCommand === 'npm'
    ? ['pack', '--pack-destination', temporary, '--ignore-scripts', '--cache', join(temporary, 'npm-cache')]
    : ['pack', '--pack-destination', temporary];
  run(packCommand, packArgs);
  const archive = (await readdir(temporary)).find((name) => name.endsWith('.tgz'));
  assert.ok(archive, 'pack must produce a tarball');
  run('tar', ['-xzf', join(temporary, archive), '-C', temporary]);

  const packageRoot = join(temporary, 'package');
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'purifai');
  assert.equal(manifest.version, rootManifest.version);
  assert.equal('dependencies' in manifest, false);

  const packedFiles = await filesBelow(packageRoot);
  for (const forbidden of ['src/', 'test/', 'vendor/', 'scripts/']) {
    assert.equal(packedFiles.some((name) => name.startsWith(forbidden)), false, forbidden);
  }
  assert.equal(packedFiles.includes('dist/index.js'), true);
  assert.equal(packedFiles.includes('dist/index.cjs'), true);
  assert.equal(packedFiles.includes('dist/index.d.ts'), true);
  assert.equal(packedFiles.includes('dist/index.d.cts'), true);

  const esm = await import(pathToFileURL(join(packageRoot, 'dist/index.js')).href);
  const require = createRequire(import.meta.url);
  const cjs = require(join(packageRoot, 'dist/index.cjs'));
  const expectedKeys = ['PurifaiLimitError', 'convert', 'createTextTransform', 'escapeHtmlText', 'toText'];
  assert.deepEqual(Object.keys(esm).sort(), expectedKeys);
  assert.deepEqual(Object.keys(cjs).sort(), expectedKeys);

  const html = '<p>Hello <b>package</b>.</p>';
  assert.equal(esm.toText(html), 'Hello package.');
  assert.equal(cjs.toText(html), 'Hello package.');
  assert.equal(await streamText(esm, html), 'Hello package.');
  assert.equal(await streamText(cjs, html), 'Hello package.');
  console.log(`Packed package smoke passed (${packedFiles.length} files)`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
