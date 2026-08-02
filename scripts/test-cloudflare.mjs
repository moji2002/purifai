import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPackedPackage } from './with-packed-package.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await withPackedPackage(async ({ packedEsm, runPacked }) => {
  const toolCommand = process.env.PURIFAI_TOOL_COMMAND ?? 'pnpm';
  const command = toolCommand === 'direct'
    ? resolve(root, 'node_modules/.bin/vitest')
    : toolCommand;
  const args = toolCommand === 'direct'
    ? ['run', '--config', 'vitest.worker.config.js']
    : ['exec', 'vitest', 'run', '--config', 'vitest.worker.config.js'];
  runPacked(command, args, {
    cwd: root,
    env: { PURIFAI_PACKED_ESM: packedEsm },
    stdio: 'inherit',
  });
});
