import { runtimeVersion, withPackedPackage } from './with-packed-package.mjs';

const allowMissing = process.env.PURIFAI_ALLOW_MISSING_RUNTIMES === '1';
const rows = [];

function record(runtime, moduleSystem, version, status) {
  rows.push({ runtime, moduleSystem, version, status });
}

await withPackedPackage(async ({ runPacked }) => {
  const nodeVersion = runtimeVersion('node');
  runPacked('node', ['consumer.mjs'], { stdio: 'inherit' });
  record('Node', 'ESM', nodeVersion, 'PASS');
  runPacked('node', ['consumer.cjs'], { stdio: 'inherit' });
  record('Node', 'CommonJS', nodeVersion, 'PASS');

  const bunVersion = runtimeVersion('bun');
  if (bunVersion === null) {
    if (!allowMissing) throw new Error('Bun is required; set PURIFAI_ALLOW_MISSING_RUNTIMES=1 only for local development');
    record('Bun', 'ESM/CommonJS', 'missing', 'SKIP (local override)');
  } else {
    runPacked('bun', ['consumer.mjs'], { stdio: 'inherit' });
    record('Bun', 'ESM', bunVersion, 'PASS');
    runPacked('bun', ['consumer.cjs'], { stdio: 'inherit' });
    record('Bun', 'CommonJS', bunVersion, 'PASS');
  }

  const denoVersion = runtimeVersion('deno');
  if (denoVersion === null) {
    if (!allowMissing) throw new Error('Deno is required; set PURIFAI_ALLOW_MISSING_RUNTIMES=1 only for local development');
    record('Deno', 'ESM', 'missing', 'SKIP (local override)');
  } else {
    runPacked('deno', [
      'run', '--allow-read', '--node-modules-dir=manual', 'consumer.mjs',
    ], { stdio: 'inherit' });
    record('Deno', 'ESM', denoVersion, 'PASS');
  }
});

console.log('runtime | module system | version | result');
for (const row of rows) {
  console.log(`${row.runtime} | ${row.moduleSystem} | ${row.version} | ${row.status}`);
}
