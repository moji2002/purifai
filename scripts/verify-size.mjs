import { spawnSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { withPackedPackage } from './with-packed-package.mjs';

const root = resolve(import.meta.dirname, '..');
const esmPath = resolve(root, 'dist/index.js');
const PUBLIC_EXPORTS = [
  'PurifaiLimitError',
  'convert',
  'createTextTransform',
  'escapeHtmlText',
  'toText',
];

function nearestRank(values, quantile) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * quantile) - 1)];
}

function runNode(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Node measurement failed:\n${result.stdout}${result.stderr}`);
  }
  return result.stdout.trim();
}

async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const esm = await readFile(esmPath);
const source = esm.toString('utf8');
const missingExports = PUBLIC_EXPORTS.filter((name) => !source.includes(name));
if (missingExports.length > 0) throw new Error(`Bundle is missing exports: ${missingExports.join(', ')}`);
const entityDataIncluded = source.includes('CounterClockwiseContourIntegral;')
  && source.includes('NotNestedGreaterGreater;');
if (!entityDataIncluded) throw new Error('Generated WHATWG entity sentinels are missing from the bundle');
const esmGzipLevel9Bytes = gzipSync(esm, { level: 9 }).length;
if (esmGzipLevel9Bytes > 25 * 1024) {
  throw new Error(`ESM gzip ceiling exceeded: ${esmGzipLevel9Bytes} > ${25 * 1024}`);
}

const result = await withPackedPackage(async ({ manifest, packageRoot, packedEsm, tarball }) => {
  const distFiles = await filesBelow(resolve(packageRoot, 'dist'));
  let unpackedRuntimeBytes = 0;
  let unpackedDeclarationBytes = 0;
  const packedFiles = [];
  for (const file of distFiles) {
    const bytes = (await stat(file)).size;
    const extension = extname(file);
    if (extension === '.js' || extension === '.cjs') unpackedRuntimeBytes += bytes;
    if (file.endsWith('.d.ts') || file.endsWith('.d.cts')) unpackedDeclarationBytes += bytes;
    packedFiles.push({ path: relative(packageRoot, file), bytes });
  }

  const importUrl = pathToFileURL(packedEsm).href;
  const coldImportMilliseconds = [];
  for (let sample = 0; sample < 30; sample += 1) {
    const measured = runNode([
      '--input-type=module',
      '-e',
      `const started=performance.now();await import(${JSON.stringify(importUrl)});process.stdout.write(String(performance.now()-started));`,
    ]);
    coldImportMilliseconds.push(Number(measured));
  }
  const retained = JSON.parse(runNode([
    '--expose-gc',
    '--input-type=module',
    '-e',
    `globalThis.gc();const before=process.memoryUsage().heapUsed;await import(${JSON.stringify(importUrl)});globalThis.gc();const after=process.memoryUsage().heapUsed;process.stdout.write(JSON.stringify({beforeHeapBytes:before,afterHeapBytes:after,retainedHeapBytes:after-before}));`,
  ]));

  return {
    runtimeDependencies: Object.keys(manifest.dependencies ?? {}).length,
    packageTarballBytes: (await stat(tarball)).size,
    unpackedRuntimeBytes,
    unpackedDeclarationBytes,
    packedFiles,
    coldImportSamplesMilliseconds: coldImportMilliseconds,
    coldImportMedianMilliseconds: nearestRank(coldImportMilliseconds, 0.5),
    coldImportP95Milliseconds: nearestRank(coldImportMilliseconds, 0.95),
    ...retained,
  };
});

if (result.runtimeDependencies !== 0) throw new Error('Packed package has runtime dependencies');
const measurements = {
  schemaVersion: 1,
  node: process.version,
  esmRawBytes: esm.length,
  esmGzipLevel9Bytes,
  gzipCeilingBytes: 25 * 1024,
  stretchGoalBytes: 20 * 1024,
  stretchGoalMet: esmGzipLevel9Bytes < 20 * 1024,
  entityDataIncluded,
  publicExportsIncluded: missingExports.length === 0,
  ...result,
  pass: true,
};
process.stderr.write(
  `Size PASS: ${esmGzipLevel9Bytes}/${25 * 1024} gzip bytes; `
  + `${measurements.packageTarballBytes} package bytes; `
  + `${measurements.coldImportP95Milliseconds.toFixed(3)} ms cold-import p95\n`,
);
process.stdout.write(`${JSON.stringify(measurements)}\n`);
