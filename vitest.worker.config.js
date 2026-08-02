import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const packedInput = process.env.PURIFAI_PACKED_ESM;
if (!packedInput) throw new Error('PURIFAI_PACKED_ESM is required');
const packedEsm = path.resolve(packedInput);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './test/runtime/wrangler.jsonc' },
    }),
  ],
  resolve: {
    alias: {
      'purifai-packed': packedEsm,
    },
  },
  server: {
    fs: {
      allow: [path.dirname(packedEsm)],
    },
  },
  test: {
    include: ['test/runtime/cloudflare.test.js'],
    fileParallelism: false,
  },
});
