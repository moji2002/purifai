#!/usr/bin/env node
/**
 * Two-axis sanitizer benchmark.
 *
 * WHY THIS EXISTS
 * ---------------
 * The original comprehensive-test.js scored a vector as "blocked" when the
 * output was empty or matched no dangerous regex. Under that rule a sanitizer
 * implemented as `() => ''` scores a perfect 100%, and a library that correctly
 * preserves `<svg>` from its own allow-list is marked as failing. The number
 * measured deletion, not safety.
 *
 * This benchmark measures two things that only mean something together:
 *
 *   SECURITY  — the sanitized output is inserted into a real DOM (jsdom), then
 *               serialized and re-parsed, because the serialize→reparse round
 *               trip is exactly where mutation XSS lives. A vector counts as
 *               blocked only if neither parse yields a script node, an on*
 *               handler, a dangerous-protocol URL, or a css expression().
 *
 *   FIDELITY  — benign documents are sanitized and checked for how much
 *               reader-visible text and how much safe markup survived.
 *
 * Deleting everything gives perfect security and zero fidelity. Doing nothing
 * gives the reverse. Both extremes appear as calibration rows so the axes can
 * be seen to discriminate.
 */

import { JSDOM, VirtualConsole } from 'jsdom';
import Table from 'cli-table3';
import { ATTACK_VECTORS, MODERN_VECTORS, BENIGN_CORPUS } from './vectors.js';
import { Purifai } from '../dist/index.js';

const ALL_ATTACKS = [...ATTACK_VECTORS, ...MODERN_VECTORS];

const DANGEROUS_URL = /^\s*(?:javascript|vbscript|livescript|mocha|data)\s*:/i;
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster', 'srcdoc']);

/**
 * Collect anything that would execute or navigate if this tree were live.
 *
 * `style="expression(...)"` is reported SEPARATELY, not as a threat: CSS
 * expressions only ever executed in IE <= 10, which no current sanitizer
 * targets. Counting it as a live vector would penalise correct modern
 * behaviour — the same rigging this benchmark exists to replace.
 */
function findThreats(root) {
  const threats = [];
  const legacy = [];
  for (const el of root.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'script') threats.push('script element');
    if (tag === 'iframe' && el.hasAttribute('srcdoc')) threats.push('iframe[srcdoc]');
    if (tag === 'meta' && /refresh/i.test(el.getAttribute('http-equiv') || '')) threats.push('meta refresh');

    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) threats.push(`${tag}[${name}]`);
      if (URL_ATTRS.has(name) && DANGEROUS_URL.test(attr.value)) threats.push(`${tag}[${name}]=${attr.value.slice(0, 24)}`);
      if (name === 'style' && /expression\s*\(/i.test(attr.value)) legacy.push(`${tag}[style expression]`);
    }
  }
  return { threats, legacy };
}

// jsdom logs "Could not parse CSS stylesheet" for the malformed CSS in several
// attack vectors; that is expected input here, not a problem worth printing.
const virtualConsole = new VirtualConsole();
const dom = new JSDOM('<!DOCTYPE html><body><div id="root"></div></body>', { virtualConsole });
const { document } = dom.window;
const root = document.getElementById('root');

/**
 * Insert output into a live DOM, then serialize and re-parse it.
 * Returns every threat seen in either generation, plus whether the markup
 * mutated across the round trip.
 */
function evaluateOutput(html) {
  root.innerHTML = String(html ?? '');
  const firstPass = findThreats(root);
  const serialized = root.innerHTML;

  root.innerHTML = serialized;
  const secondPass = findThreats(root);
  const reserialized = root.innerHTML;

  return {
    threats: [...new Set([...firstPass.threats, ...secondPass.threats])],
    legacy: [...new Set([...firstPass.legacy, ...secondPass.legacy])],
    mutated: serialized !== reserialized,
  };
}

const normalize = (s) => s.replace(/\s+/g, ' ').trim();

/** Fidelity: how much visible text and safe markup survived. */
function evaluateFidelity(sanitizeFn) {
  let textKept = 0;
  let tagsExpected = 0;
  let tagsKept = 0;

  for (const sample of BENIGN_CORPUS) {
    let output;
    try {
      output = String(sanitizeFn(sample.html) ?? '');
    } catch {
      output = '';
    }

    root.innerHTML = output;
    const actualText = normalize(root.textContent || '');
    const expectedText = normalize(sample.text);

    // Entities decode on parse, so comparing textContent is fair to a
    // sanitizer that escapes as well as to one that preserves markup.
    if (expectedText.length === 0 || actualText.includes(expectedText)) textKept++;

    for (const tag of sample.tags) {
      tagsExpected++;
      if (root.querySelector(tag)) tagsKept++;
    }
  }

  return {
    textPct: (textKept / BENIGN_CORPUS.length) * 100,
    markupPct: tagsExpected === 0 ? 0 : (tagsKept / tagsExpected) * 100,
  };
}

function evaluateSecurity(sanitizeFn) {
  let blocked = 0;
  let mutations = 0;
  let legacyOnly = 0;
  const failures = [];

  for (const vector of ALL_ATTACKS) {
    let output;
    try {
      output = sanitizeFn(vector);
    } catch (e) {
      failures.push({ vector, reason: `threw: ${e.message}` });
      continue;
    }
    const { threats, legacy, mutated } = evaluateOutput(output);
    if (mutated) mutations++;
    if (legacy.length) legacyOnly++;
    if (threats.length === 0) {
      blocked++;
    } else {
      failures.push({ vector, reason: threats.slice(0, 2).join(', ') });
    }
  }

  return {
    blocked,
    total: ALL_ATTACKS.length,
    pct: (blocked / ALL_ATTACKS.length) * 100,
    mutations,
    legacyOnly,
    failures,
  };
}

async function loadSanitizers() {
  const list = [
    { name: 'Purifai', fn: (i) => Purifai.sanitize(i), category: 'strip-to-text' },
  ];

  try {
    const DOMPurify = (await import('isomorphic-dompurify')).default;
    list.push({ name: 'DOMPurify', fn: (i) => DOMPurify.sanitize(i), category: 'preserve-html' });
  } catch { console.warn('DOMPurify unavailable — skipping'); }

  try {
    const sanitizeHtml = (await import('sanitize-html')).default;
    list.push({
      name: 'sanitize-html',
      fn: (i) => sanitizeHtml(i, {
        allowedTags: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'blockquote', 'code', 'h2'],
        allowedAttributes: { a: ['href'] },
      }),
      category: 'preserve-html',
    });
  } catch { console.warn('sanitize-html unavailable — skipping'); }

  try {
    const xss = (await import('xss')).default;
    list.push({ name: 'xss', fn: (i) => xss(i), category: 'preserve-html' });
  } catch { console.warn('xss unavailable — skipping'); }

  // Calibration rows — these exist to prove the axes discriminate.
  list.push({ name: '[null] () => ""', fn: () => '', category: 'calibration' });
  list.push({ name: '[identity] v => v', fn: (v) => v, category: 'calibration' });

  return list;
}

const sanitizers = await loadSanitizers();

console.log('\n🔬 FAIR SANITIZER BENCHMARK');
console.log(`   ${ALL_ATTACKS.length} attack vectors · ${BENIGN_CORPUS.length} benign documents`);
console.log('   Security: output parsed + re-parsed in jsdom (catches mutation XSS)');
console.log('   Fidelity: how much benign text and safe markup survived\n');

const table = new Table({
  head: ['Library', 'Category', 'Security', 'Text kept', 'Markup kept', 'Mutations', 'IE-only CSS'],
  colWidths: [19, 16, 10, 11, 13, 11, 13],
});

const results = [];
for (const s of sanitizers) {
  const security = evaluateSecurity(s.fn);
  const fidelity = evaluateFidelity(s.fn);
  results.push({ ...s, security, fidelity });
  table.push([
    s.name,
    s.category,
    `${security.pct.toFixed(1)}%`,
    `${fidelity.textPct.toFixed(1)}%`,
    `${fidelity.markupPct.toFixed(1)}%`,
    String(security.mutations),
    String(security.legacyOnly),
  ]);
}
console.log(table.toString());

console.log('\nHow to read this:');
console.log('  • Security 100% + Markup 0%  = a stripper. Safe, but deletes all formatting.');
console.log('  • Security 100% + Markup high = a preserving sanitizer doing its job well.');
console.log('  • The two calibration rows bracket the scale; any metric that cannot');
console.log('    separate them is measuring deletion rather than safety.\n');

for (const r of results) {
  if (r.category === 'calibration') continue;
  if (r.security.failures.length) {
    console.log(`❌ ${r.name} — ${r.security.failures.length} vector(s) still executable:`);
    for (const f of r.security.failures.slice(0, 5)) {
      console.log(`   • ${f.reason}  ←  ${f.vector.slice(0, 64)}`);
    }
  } else {
    console.log(`✅ ${r.name} — no executable output across ${r.security.total} vectors`);
  }
}

const purifai = results.find((r) => r.name === 'Purifai');
console.log('');
process.exit(purifai && purifai.security.failures.length === 0 ? 0 : 1);
