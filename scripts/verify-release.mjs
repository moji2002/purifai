import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { statementMatches } from './provenance.mjs';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const SHARDS = Object.freeze({
  core: [['Core', pnpm, ['run', 'test:core']]],
  runtimes: [['Packed runtimes', pnpm, ['run', 'test:runtimes']]],
  worker: [['Cloudflare Worker', pnpm, ['run', 'test:cloudflare']]],
  browsers: [['Browsers', pnpm, ['run', 'test:browsers']]],
  resource: [
    ['Artifact size', pnpm, ['run', 'test:size']],
    ['Adversarial scaling', pnpm, ['run', 'test:scaling']],
  ],
  benchmark: [['Saved benchmark', pnpm, ['run', 'bench:check']]],
  docs: [['Documentation', pnpm, ['run', 'test:docs']]],
});

function requireNode24() {
  const major = Number(process.versions.node.split('.', 1)[0]);
  if (major !== 24) {
    throw new Error(`Release qualification requires Node 24; received ${process.version}`);
  }
}

function run(label, command, args, options = {}) {
  process.stdout.write(`\n=== ${label} ===\n`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? 'pipe' : 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stdout ?? ''}${result.stderr ?? ''}` : '';
    throw new Error(`${label} failed with exit ${result.status}${detail}`);
  }
  return options.capture ? result.stdout : '';
}

function parseArguments(argv) {
  let shard = null;
  let postpublish = null;
  for (const argument of argv) {
    if (argument.startsWith('--ci-shard=')) {
      if (shard !== null) throw new Error('--ci-shard may be provided only once');
      shard = argument.slice('--ci-shard='.length);
      if (!(shard in SHARDS)) {
        throw new Error(`Unknown CI shard ${shard}; expected one of ${Object.keys(SHARDS).join(', ')}`);
      }
    } else if (argument.startsWith('--postpublish=')) {
      if (postpublish !== null) throw new Error('--postpublish may be provided only once');
      postpublish = argument.slice('--postpublish='.length);
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(postpublish)) {
        throw new Error(`Invalid postpublish version: ${postpublish}`);
      }
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (shard !== null && postpublish !== null) {
    throw new Error('--ci-shard and --postpublish are mutually exclusive');
  }
  return { shard, postpublish };
}

function validateTemporaryDirectory(directory) {
  const resolved = resolve(directory);
  const temporaryRoot = resolve(tmpdir()) + sep;
  if (!resolved.startsWith(temporaryRoot) || !basename(resolved).startsWith('purifai-postpublish-')) {
    throw new Error(`Refusing to operate on unexpected temporary directory: ${resolved}`);
  }
  return resolved;
}

function npmVersionAtLeast(actual, minimum) {
  const left = actual.trim().split('.').map(Number);
  const right = minimum.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] ?? 0) > (right[index] ?? 0)) return true;
    if ((left[index] ?? 0) < (right[index] ?? 0)) return false;
  }
  return true;
}

function collectStatements(value, statements, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (typeof value.payload === 'string' && typeof value.payloadType === 'string') {
    try {
      const statement = JSON.parse(Buffer.from(value.payload, 'base64').toString('utf8'));
      statements.push(statement);
    } catch {
      // Ignore non-JSON envelopes; npm verification has already checked signatures.
    }
  }
  for (const nested of Object.values(value)) collectStatements(nested, statements, seen);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'purifai-release-verifier' },
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function verifyPublishedOnce(version, githubSha) {
  const encodedName = encodeURIComponent(manifest.name);
  const published = await fetchJson(`https://registry.npmjs.org/${encodedName}/${encodeURIComponent(version)}`);
  if (published.name !== manifest.name || published.version !== version) {
    throw new Error(`Registry returned unexpected package identity ${published.name}@${published.version}`);
  }
  const integrity = published.dist?.integrity;
  const tarballUrl = published.dist?.tarball;
  if (typeof integrity !== 'string' || !integrity.startsWith('sha512-') || typeof tarballUrl !== 'string') {
    throw new Error('Published metadata is missing a sha512 integrity or tarball URL');
  }
  const tarballResponse = await fetch(tarballUrl);
  if (!tarballResponse.ok) throw new Error(`Published tarball returned ${tarballResponse.status}`);
  const tarball = Buffer.from(await tarballResponse.arrayBuffer());
  const tarballSha512Base64 = createHash('sha512').update(tarball).digest('base64');
  if (`sha512-${tarballSha512Base64}` !== integrity) {
    throw new Error('Published tarball bytes do not match registry integrity');
  }
  const tarballSha512Hex = Buffer.from(tarballSha512Base64, 'base64').toString('hex');

  const temporary = validateTemporaryDirectory(await mkdtemp(join(tmpdir(), 'purifai-postpublish-')));
  try {
    await writeFile(
      join(temporary, 'package.json'),
      `${JSON.stringify({ name: 'purifai-provenance-check', private: true, version: '0.0.0' }, null, 2)}\n`,
      'utf8',
    );
    run('Install published artifact', npm, [
      'install', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund',
      `${manifest.name}@${version}`,
    ], { cwd: temporary, capture: true });
    const auditOutput = run('Verify npm signatures and provenance', npm, [
      'audit', 'signatures', '--json', '--include-attestations',
    ], { cwd: temporary, capture: true });
    const audit = JSON.parse(auditOutput);
    if (!Array.isArray(audit.verified) || audit.verified.length === 0) {
      throw new Error('npm did not return a verified attestation bundle');
    }
    const statements = [];
    collectStatements(audit.verified, statements);
    const expected = {
      name: manifest.name,
      version,
      tarballSha512Hex,
      githubSha,
    };
    if (!statements.some((statement) => statementMatches(statement, expected))) {
      throw new Error('No verified SLSA statement binds this tarball to the exact GITHUB_SHA');
    }
    process.stdout.write(
      `Postpublish PASS: ${manifest.name}@${version} sha512 ${tarballSha512Hex.slice(0, 16)}… `
      + `from ${githubSha}\n`,
    );
  } finally {
    validateTemporaryDirectory(temporary);
    await rm(temporary, { recursive: true, force: true });
  }
}

async function verifyPublished(version) {
  if (version !== manifest.version) {
    throw new Error(`Postpublish version ${version} does not match package.json ${manifest.version}`);
  }
  const githubSha = process.env.GITHUB_SHA?.toLowerCase();
  if (!githubSha || !/^[0-9a-f]{40}$/.test(githubSha)) {
    throw new Error('Postpublish verification requires an exact 40-character GITHUB_SHA');
  }
  const npmVersion = run('Check npm version', npm, ['--version'], { capture: true }).trim();
  if (!npmVersionAtLeast(npmVersion, '11.5.1')) {
    throw new Error(`Trusted-publishing verification requires npm >=11.5.1; received ${npmVersion}`);
  }
  const deadline = Date.now() + 120_000;
  let lastError;
  do {
    try {
      await verifyPublishedOnce(version, githubSha);
      return;
    } catch (error) {
      lastError = error;
      if (Date.now() >= deadline) break;
      process.stderr.write(`Registry/provenance not ready: ${error.message}; retrying in 5 seconds\n`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000));
    }
  } while (Date.now() < deadline);
  throw lastError;
}

requireNode24();
const { shard, postpublish } = parseArguments(process.argv.slice(2));
if (postpublish !== null) {
  await verifyPublished(postpublish);
} else {
  const selected = shard === null ? Object.values(SHARDS).flat() : SHARDS[shard];
  for (const [label, command, args] of selected) run(label, command, args);
  process.stdout.write(`\nRelease qualification PASS (${shard ?? 'all gates'})\n`);
}
