import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootManifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    stdio: options.stdio ?? 'pipe',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(
      `${command} ${args.join(' ')} failed with exit ${result.status}\n`
      + `${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
    error.exitCode = result.status;
    throw error;
  }
  return result;
}

function validateTemporaryDirectory(directory) {
  const resolved = resolve(directory);
  const allowedRoot = resolve(tmpdir()) + sep;
  if (!resolved.startsWith(allowedRoot) || !basename(resolved).startsWith('purifai-packed-')) {
    throw new Error(`Refusing to operate on unexpected temporary directory: ${resolved}`);
  }
  return resolved;
}

export async function withPackedPackage(callback) {
  const temporary = validateTemporaryDirectory(
    await mkdtemp(join(tmpdir(), 'purifai-packed-')),
  );
  const packCommand = process.env.PURIFAI_PACK_COMMAND ?? 'pnpm';
  try {
    const packArgs = packCommand === 'npm'
      ? ['pack', '--pack-destination', temporary, '--ignore-scripts', '--cache', join(temporary, 'npm-cache')]
      : ['pack', '--pack-destination', temporary];
    run(packCommand, packArgs);
    const tarballs = (await readdir(temporary)).filter((name) => name.endsWith('.tgz'));
    if (tarballs.length !== 1) {
      throw new Error(`Expected exactly one packed tarball, found ${tarballs.length}`);
    }
    const tarball = resolve(temporary, tarballs[0]);
    await writeFile(
      join(temporary, 'package.json'),
      `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
      'utf8',
    );

    if (packCommand === 'npm') {
      run('npm', [
        'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
        '--cache', join(temporary, 'npm-cache'), '--prefix', temporary, tarball,
      ]);
    } else {
      run('pnpm', ['add', '--dir', temporary, '--offline', tarball]);
    }

    const packageRoot = resolve(temporary, 'node_modules/purifai');
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    if (manifest.name !== rootManifest.name || manifest.version !== rootManifest.version) {
      throw new Error(`Unexpected packed package identity: ${manifest.name}@${manifest.version}`);
    }
    if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
      throw new Error('Packed Purifai must have zero runtime dependencies');
    }

    await copyFile(resolve(root, 'test/runtime/consumer.mjs'), join(temporary, 'consumer.mjs'));
    await copyFile(resolve(root, 'test/runtime/consumer.cjs'), join(temporary, 'consumer.cjs'));

    const runPacked = (command, args, options = {}) => run(command, args, {
      ...options,
      cwd: options.cwd ?? temporary,
    });
    return await callback({
      directory: temporary,
      packageRoot,
      packedEsm: join(packageRoot, 'dist/index.js'),
      packedCjs: join(packageRoot, 'dist/index.cjs'),
      manifest,
      runPacked,
      tarball,
    });
  } finally {
    validateTemporaryDirectory(temporary);
    await rm(temporary, { recursive: true, force: true });
  }
}

export function runtimeVersion(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return (result.stdout || result.stderr).trim().split(/\r?\n/, 1)[0] ?? null;
}
