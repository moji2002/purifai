import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
import { withPackedPackage } from '../../scripts/with-packed-package.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const browserRoot = resolve(root, 'test/browser');
const traceRoot = resolve(root, 'test-results');
const exactCorpus = new Map([
  ['/corpus/readability.js', resolve(root, 'test/v3/fixtures/readability.js')],
  ['/corpus/security-vectors.js', resolve(root, 'test/v3/fixtures/security-vectors.js')],
]);
const engines = { chromium, firefox, webkit };
const columns = [
  ['artifactImport', 'artifact import'],
  ['corpus', 'corpus'],
  ['chunkInvariance', 'chunk invariance'],
  ['textContent', 'textContent'],
  ['escapedInnerHTML', 'escaped innerHTML'],
  ['positiveControl', 'positive control'],
];

function contained(rootDirectory, relativePath) {
  const target = resolve(rootDirectory, relativePath);
  if (target !== rootDirectory && !target.startsWith(`${rootDirectory}${sep}`)) {
    throw new Error('path traversal rejected');
  }
  return target;
}

function contentType(file) {
  switch (extname(file)) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

async function sendFile(response, file) {
  const details = await stat(file);
  if (!details.isFile()) throw new Error('not a file');
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Length': details.size,
    'Content-Type': contentType(file),
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(file).pipe(response);
}

function createFixtureServer(packageRoot) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname);
      if (request.method !== 'GET') {
        response.writeHead(405, { Allow: 'GET' }).end();
        return;
      }
      if (pathname === '/') {
        const template = await readFile(resolve(browserRoot, 'harness.html'), 'utf8');
        const html = template.replace('__PURIFAI_MODULE__', JSON.stringify('/package/dist/index.js'));
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Length': Buffer.byteLength(html),
          'Content-Type': 'text/html; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        }).end(html);
        return;
      }
      if (pathname === '/fixture/harness.js') {
        await sendFile(response, contained(browserRoot, 'harness.js'));
        return;
      }
      const corpusFile = exactCorpus.get(pathname);
      if (corpusFile) {
        await sendFile(response, corpusFile);
        return;
      }
      if (pathname.startsWith('/package/')) {
        await sendFile(response, contained(packageRoot, pathname.slice('/package/'.length)));
        return;
      }
      response.writeHead(404, { 'Cache-Control': 'no-store' }).end('not found');
    } catch (error) {
      const status = error?.code === 'ENOENT' ? 404 : 400;
      response.writeHead(status, { 'Cache-Control': 'no-store' }).end('request rejected');
    }
  });
}

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolveListen();
    });
  });
}

function close(server) {
  return new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

function pass(value) {
  return value ? 'PASS' : 'FAIL';
}

await withPackedPackage(async ({ packageRoot }) => {
  const server = createFixtureServer(packageRoot);
  await listen(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing fixture server address');
  const fixtureUrl = `http://127.0.0.1:${address.port}/`;
  let failed = false;
  console.log(['engine', ...columns.map(([, label]) => label)].join(' | '));
  try {
    for (const [engineName, engine] of Object.entries(engines)) {
      let browser;
      let context;
      let engineFailed = false;
      const pageErrors = [];
      try {
        browser = await engine.launch({ headless: true });
        context = await browser.newContext();
        await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        const page = await context.newPage();
        page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
        await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.waitForFunction(
          () => globalThis.__purifaiBrowserResults !== undefined,
          undefined,
          { timeout: 60_000 },
        );
        const result = await page.evaluate(() => Promise.race([
          globalThis.__purifaiBrowserResults,
          new Promise((_, reject) => setTimeout(
            () => reject(new Error('browser qualification exceeded 60 seconds')),
            60_000,
          )),
        ]));
        const row = [engineName, ...columns.map(([key]) => pass(result[key]))];
        console.log(row.join(' | '));
        if (pageErrors.length > 0 || result.failures.length > 0 || columns.some(([key]) => !result[key])) {
          failed = true;
          engineFailed = true;
          for (const detail of [...pageErrors, ...result.failures]) {
            console.error(`${engineName}: ${detail}`);
          }
        }
      } catch (error) {
        failed = true;
        engineFailed = true;
        console.log([engineName, ...columns.map(() => 'FAIL')].join(' | '));
        console.error(`${engineName}: ${error?.stack ?? error}`);
      } finally {
        if (context) {
          if (engineFailed) {
            await mkdir(traceRoot, { recursive: true });
            await context.tracing.stop({ path: resolve(traceRoot, `${engineName}-trace.zip`) });
          } else {
            await context.tracing.stop();
          }
          await context.close();
        }
        await browser?.close();
      }
    }
  } finally {
    await close(server);
  }
  if (failed) process.exitCode = 1;
});
