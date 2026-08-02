import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

const [readme, migration, basic, express, react] = await Promise.all([
  read('README.md'),
  read('docs/migration-v3.md'),
  read('examples/basic-usage.js'),
  read('examples/express-middleware.js'),
  read('examples/react-integration.jsx'),
]);

const proposition = [
  '> Stream untrusted HTML into clean, readable text with bounded working memory.',
  '> No DOM. No document tree. No runtime dependencies.',
].join('\n');
assert.ok(readme.startsWith(proposition), 'README must begin with the approved proposition');

const benchmarkPosition = readme.indexOf('## Benchmarks');
for (const sink of [
  'element.textContent = toText(untrustedHtml);',
  'element.innerHTML = escapeHtmlText(toText(untrustedHtml));',
]) {
  const sinkPosition = readme.indexOf(sink);
  assert.ok(sinkPosition >= 0, `README is missing supported sink: ${sink}`);
  assert.ok(sinkPosition < benchmarkPosition, `${sink} must appear before benchmark claims`);
}

for (const exactPackage of ['striptags@3.2.0', 'html-to-text@10.0.0']) {
  assert.ok(readme.includes(exactPackage), `README must name ${exactPackage}`);
}
assert.ok(readme.includes('docs/benchmarks/v3.md'), 'README must link the saved benchmark');
for (const choice of ['Purifai', 'html-to-text', 'striptags', 'DOMPurify', 'sanitize-html']) {
  assert.match(readme, new RegExp(`Choose [^\\n]*${choice.replace('-', '\\-')}`, 'i'));
}

for (const forbidden of [
  'Purifai.sanitize',
  'analyze',
  'isDangerous',
  'sanitizeBatch',
  'escapeAttribute',
  'escapeUrl',
  '100% secure',
  'bulletproof',
  'most secure',
]) {
  assert.equal(readme.toLowerCase().includes(forbidden.toLowerCase()), false, `README contains forbidden v2/claim copy: ${forbidden}`);
}

for (const mapping of [
  'Purifai.sanitize / sanitize → toText',
  'escape → escapeHtmlText',
  'analyze → removed; use convert for conversion metadata',
  'sanitizeBatch → removed; map toText explicitly',
  'isDangerous → removed; Purifai does not classify intent',
  'escapeAttribute / escapeUrl → removed; use a context-specific library or platform API',
  'getVersion / getStats → removed; use package metadata and published benchmarks',
  'aggressiveMode / allowedProtocols → removed; fixed policy',
  'maxLength → limits.input; overflow is explicit',
]) {
  assert.ok(migration.includes(mapping), `migration guide is missing: ${mapping}`);
}
assert.match(migration, /no compatibility layer/i);

const markdownFiles = [
  ['README.md', readme],
  ['CONTRIBUTING.md', await read('CONTRIBUTING.md')],
  ['docs/migration-v3.md', migration],
  ['docs/benchmarks/v3.md', await read('docs/benchmarks/v3.md')],
  ['docs/purifai-v3-research.md', await read('docs/purifai-v3-research.md')],
];
for (const [file, source] of markdownFiles) {
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, '');
    if (/^(?:[a-z]+:|#)/i.test(target)) continue;
    const localPath = decodeURIComponent(target.split('#', 1)[0]);
    if (localPath === '') continue;
    await assert.doesNotReject(
      access(resolve(root, dirname(file), localPath)),
      `broken local Markdown link in ${file}: ${target}`,
    );
  }
}

for (const removed of ['Purifai.sanitize', 'analyze(', 'isDangerous(', 'sanitizeBatch(', 'escapeAttribute(', 'escapeUrl(']) {
  for (const [name, source] of [['basic', basic], ['express', express], ['react', react]]) {
    assert.equal(source.includes(removed), false, `${name} example uses removed API: ${removed}`);
  }
}
assert.equal(react.includes('dangerouslySetInnerHTML'), false, 'React example must use text rendering');

const basicModule = await import(pathToFileURL(resolve(root, 'examples/basic-usage.js')));
const preview = basicModule.extractPreview(
  '<script>alert(1)</script><h2>Release</h2><ul><li>Fast</li></ul>',
  1_000,
);
assert.equal(preview.text, 'Release\n\n- Fast');
assert.equal(preview.droppedContainers.script, 1);

const encoder = new TextEncoder();
const response = {
  body: new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('<style>x</style><p>Stream'));
      controller.enqueue(encoder.encode('ed</p>'));
      controller.close();
    },
  }),
};
const streamed = basicModule.streamHtmlResponse(response);
let streamedText = '';
for await (const chunk of streamed.readable) streamedText += chunk;
assert.equal(streamedText, 'Streamed');
assert.equal((await streamed.result).scanComplete, true);

const expressModule = await import(pathToFileURL(resolve(root, 'examples/express-middleware.js')));
const middleware = expressModule.readableTextBody({ maxInput: 32, maxOutput: 64 });
const request = { body: { html: '<p>Hello</p>' } };
let nextCalls = 0;
await middleware(request, {}, () => { nextCalls += 1; });
assert.equal(request.body.text, 'Hello');
assert.equal(nextCalls, 1);

let statusCode = 0;
let payload;
await middleware(
  { body: { html: 'x'.repeat(33) } },
  {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
  },
  () => { throw new Error('limit response must not call next'); },
);
assert.equal(statusCode, 413);
assert.deepEqual(payload, { error: 'HTML_INPUT_LIMIT', limit: 32, observed: 33 });

console.log('Documentation PASS: positioning, links, migration, examples, and sinks');
