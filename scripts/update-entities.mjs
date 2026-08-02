import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL = 'https://html.spec.whatwg.org/entities.json';
const LICENSE_URL = 'https://whatwg.org/ipr-policy/';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDirectory = resolve(root, 'vendor/whatwg');

const response = await fetch(SOURCE_URL, {
  headers: { accept: 'application/json' },
  redirect: 'error',
});
if (response.status !== 200) {
  throw new Error(`Expected HTTP 200 from ${SOURCE_URL}, received ${response.status}`);
}
const contentType = response.headers.get('content-type') ?? '';
if (!contentType.toLowerCase().includes('json')) {
  throw new Error(`Expected JSON content type from ${SOURCE_URL}, received ${contentType || '(missing)'}`);
}

const bytes = new Uint8Array(await response.arrayBuffer());
const source = JSON.parse(new TextDecoder().decode(bytes));
if (source === null || typeof source !== 'object' || Array.isArray(source)) {
  throw new Error('WHATWG entity data must be a JSON object');
}
for (const [key, value] of Object.entries(source)) {
  if (
    !key.startsWith('&')
    || value === null
    || typeof value !== 'object'
    || !Array.isArray(value.codepoints)
    || typeof value.characters !== 'string'
    || !value.codepoints.every((point) => Number.isSafeInteger(point) && point >= 0)
  ) {
    throw new Error(`Invalid WHATWG entity entry: ${key}`);
  }
}

const digest = createHash('sha256').update(bytes).digest('hex');
const retrievedAt = new Date().toISOString();
const sourceNote = `# WHATWG named character references\n\n`
  + `- Source: ${SOURCE_URL}\n`
  + `- Retrieved (UTC): ${retrievedAt}\n`
  + `- SHA-256: \`${digest}\`\n`
  + `- Entries: ${Object.keys(source).length}\n`
  + `- Copyright and licensing: ${LICENSE_URL}\n`
  + `- Regenerate: \`node scripts/generate-entities.mjs\`\n`;

await mkdir(vendorDirectory, { recursive: true });
await writeFile(resolve(vendorDirectory, 'entities.json'), bytes);
await writeFile(resolve(vendorDirectory, 'SOURCE.md'), sourceNote, 'utf8');
console.log(`Pinned ${Object.keys(source).length} WHATWG entity entries (${digest})`);
