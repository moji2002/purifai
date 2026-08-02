#!/usr/bin/env node
/**
 * Reproducible competitor bundle-size snapshot.
 *
 * Each row bundles the smallest supported import needed for the operation used
 * in the fair benchmark, then reports the minified ESM bytes and gzip bytes.
 * Browser and Node bundles are labelled because they are not interchangeable.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import Table from 'cli-table3';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(here, '..');
const require = createRequire(import.meta.url);

const candidates = [
  {
    name: 'Purifai',
    packageName: 'purifai',
    category: 'strip-text',
    platform: 'browser',
    source: "export { sanitize } from './dist/index.js';",
  },
  {
    name: 'striptags',
    packageName: 'striptags',
    category: 'strip-text',
    platform: 'browser',
    source: "export { default } from 'striptags';",
  },
  {
    name: 'DOMPurify',
    packageName: 'dompurify',
    category: 'preserve-html',
    platform: 'browser',
    source: "export { default } from 'dompurify';",
  },
  {
    name: 'sanitize-html',
    packageName: 'sanitize-html',
    category: 'preserve-html',
    platform: 'node',
    source: "export { default } from 'sanitize-html';",
  },
  {
    name: 'xss',
    packageName: 'xss',
    category: 'preserve-html',
    platform: 'browser',
    source: "export { default } from 'xss';",
  },
  {
    name: 'rehype-sanitize',
    packageName: 'rehype-sanitize',
    category: 'preserve-html',
    platform: 'browser',
    source: `
      import { rehype } from 'rehype';
      import rehypeSanitize from 'rehype-sanitize';
      const processor = rehype().use(rehypeSanitize);
      export const sanitize = (input) => String(processor.processSync(input));
    `,
  },
  {
    name: 'escape-html',
    packageName: 'escape-html',
    category: 'escape-html',
    platform: 'browser',
    source: "export { default } from 'escape-html';",
  },
  {
    name: 'validator.escape',
    packageName: 'validator',
    category: 'escape-html',
    platform: 'browser',
    source: "export { default } from 'validator/es/lib/escape.js';",
  },
  {
    name: 'entities.escapeUTF8',
    packageName: 'entities',
    category: 'escape-html',
    platform: 'browser',
    source: "export { escapeUTF8 } from 'entities';",
  },
  {
    name: 'html-entities',
    packageName: 'html-entities',
    category: 'escape-html',
    platform: 'browser',
    source: "export { encode } from 'html-entities';",
  },
  {
    name: 'he.escape',
    packageName: 'he',
    category: 'escape-html',
    platform: 'browser',
    source: "import he from 'he'; export const escape = he.escape;",
  },
];

function readPackageJson(packageName) {
  if (packageName === 'purifai') {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  }

  let current = path.dirname(require.resolve(packageName));
  const root = path.parse(current).root;
  while (current !== root) {
    const packagePath = path.join(current, 'package.json');
    if (fs.existsSync(packagePath)) {
      const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      if (manifest.name === packageName) return manifest;
    }
    current = path.dirname(current);
  }
  throw new Error(`Could not locate package.json for ${packageName}`);
}

const rows = [];
for (const candidate of candidates) {
  const result = await build({
    stdin: {
      contents: candidate.source,
      resolveDir: projectRoot,
      sourcefile: `${candidate.packageName}-bundle-entry.js`,
      loader: 'js',
    },
    bundle: true,
    format: 'esm',
    minify: true,
    platform: candidate.platform,
    target: 'es2020',
    treeShaking: true,
    write: false,
    logLevel: 'silent',
  });

  const bytes = result.outputFiles[0].contents;
  const manifest = readPackageJson(candidate.packageName);
  rows.push({
    ...candidate,
    minifiedBytes: bytes.length,
    gzipBytes: zlib.gzipSync(bytes).length,
    directDependencies: Object.keys(manifest.dependencies ?? {}).length,
  });
}

const table = new Table({
  head: ['Library', 'Category', 'Target', 'Minified', 'Gzip', 'Direct deps'],
  colWidths: [21, 15, 9, 12, 10, 13],
});

for (const row of rows) {
  table.push([
    row.name,
    row.category,
    row.platform,
    `${(row.minifiedBytes / 1024).toFixed(1)} KB`,
    `${(row.gzipBytes / 1024).toFixed(1)} KB`,
    String(row.directDependencies),
  ]);
}

console.log('\n📦 BUNDLE SIZE COMPARISON');
console.log('   esbuild ESM bundle · minified · gzip · target es2020\n');
console.log(table.toString());
console.log('\nMarkdown rows:');
for (const row of rows) {
  console.log(`| ${row.name} | ${row.category} | ${row.platform} | ${(row.minifiedBytes / 1024).toFixed(1)} KB | ${(row.gzipBytes / 1024).toFixed(1)} KB | ${row.directDependencies} |`);
}
