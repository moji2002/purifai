#!/usr/bin/env node
/**
 * Real-engine verification with Chromium.
 *
 * The jsdom-based fair benchmark is a good proxy, but jsdom's parser is close to
 * — not identical with — a browser's, and mutation XSS lives exactly in those
 * differences. This runs the whole corpus through a genuine engine.
 *
 * Two things are checked that jsdom cannot give us:
 *   STATIC  — the parsed tree after a serialize -> reparse round trip.
 *   DYNAMIC — whether anything actually EXECUTED. `<img src=x onerror=...>` fires
 *             on its own in a real browser; jsdom never runs it.
 *
 * A positive control runs last: an unsanitized payload MUST fire. If it doesn't,
 * the harness is broken and the run is reported as a failure rather than a pass —
 * a green result from a detector that cannot detect anything is worse than a red one.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const PORT = 8917;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = path.join(root, rel);
  // Never serve outside the package root.
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  });
});

await new Promise((resolve) => server.listen(PORT, resolve));

console.log('🌐 Purifai Browser Verification (Chromium)\n');

/**
 * Find a usable engine. Prefers real Google Chrome — the point of this file is
 * to test against a production browser, not a stand-in — then falls back to any
 * Playwright-managed build already on disk, since the bundled-version pin
 * frequently disagrees with what is installed.
 */
function findExecutable() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return { path: c, label: path.basename(c) };
  }

  const cache = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  if (fs.existsSync(cache)) {
    for (const dir of fs.readdirSync(cache).sort().reverse()) {
      for (const rel of [
        'chrome-headless-shell-mac-arm64/chrome-headless-shell',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
      ]) {
        const p = path.join(cache, dir, rel);
        if (fs.existsSync(p)) return { path: p, label: dir };
      }
    }
  }
  return null;
}

let browser;
let exitCode = 0;
try {
  const exe = findExecutable();
  if (!exe) throw new Error('no Chromium/Chrome executable found — run `npx playwright install chromium`');
  console.log(`Engine: ${exe.label}\n`);
  browser = await chromium.launch({ headless: true, executablePath: exe.path });
  const page = await browser.newPage();

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 80)));

  await page.goto(`http://localhost:${PORT}/test/browser-verify.html`);
  await page.waitForFunction('window.__done === true', null, { timeout: 60000 });

  const r = await page.evaluate(() => window.__results);

  console.log(`Vectors run:          ${r.total}`);
  console.log(`Sanitize errors:      ${r.sanitizeErrors.length}`);
  console.log(`Static threats:       ${r.staticFails.length}`);
  console.log(`Actually executed:    ${r.dynamicFails.length}`);
  console.log(`Positive control:     ${r.controlFired ? 'FIRED ✅ (harness works)' : 'DID NOT FIRE ❌'}`);

  if (!r.controlFired) {
    console.log('\n❌ The positive control did not execute — the harness cannot detect');
    console.log('   execution, so a clean result here would be meaningless.');
    exitCode = 1;
  }

  for (const [label, list] of [
    ['Static threats', r.staticFails],
    ['Executed', r.dynamicFails],
    ['Sanitize errors', r.sanitizeErrors],
  ]) {
    if (list.length) {
      exitCode = 1;
      console.log(`\n❌ ${label}:`);
      for (const item of list.slice(0, 5)) console.log('   ' + JSON.stringify(item));
    }
  }

  if (exitCode === 0) {
    console.log('\n🎉 No vector produced executable output in a real browser engine.');
  }

  if (pageErrors.length) {
    console.log(`\n(page errors observed: ${pageErrors.length} — ${pageErrors.slice(0, 2).join(' | ')})`);
  }
} catch (e) {
  console.error('\n❌ Browser verification failed to run:', e.message);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}

process.exit(exitCode);
