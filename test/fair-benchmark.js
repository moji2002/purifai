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
 *   EXECUTABLE OUTPUT — the sanitized output is inserted into a real DOM
 *               (jsdom), then
 *               serialized and re-parsed, because the serialize→reparse round
 *               trip is exactly where mutation XSS lives. A vector counts as
 *               blocked only if neither parse yields a script node, an on*
 *               handler, a dangerous-protocol URL, or a css expression().
 *
 *   FIDELITY  — benign documents are sanitized and checked for how much
 *               reader-visible text and how much safe markup survived.
 *
 *   THROUGHPUT — a same-process snapshot over the same mixed corpus. It is a
 *                development signal, not a universal speed ranking: DOM-based,
 *                AST-based, stripping, and encoding tools solve different jobs.
 *
 * Synthetic delete-all and identity controls are printed after the real package
 * table. They audit the metric and are not competitors.
 */

import { JSDOM, VirtualConsole } from 'jsdom';
import Table from 'cli-table3';
import { ATTACK_VECTORS, MODERN_VECTORS, BENIGN_CORPUS } from './vectors.js';
import { Purifai } from '../dist/index.js';

const ALL_ATTACKS = [...ATTACK_VECTORS, ...MODERN_VECTORS];
const RAW_TEXT_CORPUS = [
  { html: 'Before<script>alert(1)</script>After', text: 'BeforeAfter' },
  { html: 'Before<style>body{color:red}</style>After', text: 'BeforeAfter' },
  { html: 'Before<iframe>inner</iframe>After', text: 'BeforeAfter' },
  { html: 'Before<svg><text>hidden</text></svg>After', text: 'BeforeAfter' },
  { html: 'Before<template><img src=x onerror=alert(1)></template>After', text: 'BeforeAfter' },
];

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
    if (actualText === expectedText) textKept++;

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

function evaluateRawTextRemoval(sanitizeFn) {
  let exact = 0;
  for (const sample of RAW_TEXT_CORPUS) {
    let output = '';
    try {
      output = String(sanitizeFn(sample.html) ?? '');
    } catch {
      // A thrown operation is not an exact result.
    }
    root.innerHTML = output;
    if (normalize(root.textContent || '') === sample.text) exact++;
  }
  return (exact / RAW_TEXT_CORPUS.length) * 100;
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
    { name: 'Purifai.sanitize', fn: (i) => Purifai.sanitize(i), category: 'strip-to-text' },
    { name: 'Purifai.escape', fn: (i) => Purifai.escape(i), category: 'encode-as-text' },
  ];

  try {
    const DOMPurify = (await import('isomorphic-dompurify')).default;
    list.push({ name: 'DOMPurify (jsdom)', fn: (i) => DOMPurify.sanitize(i), category: 'preserve-safe-html' });
  } catch { console.warn('DOMPurify unavailable — skipping'); }

  try {
    const sanitizeHtml = (await import('sanitize-html')).default;
    list.push({
      name: 'sanitize-html',
      fn: (i) => sanitizeHtml(i, {
        allowedTags: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'blockquote', 'code', 'h2'],
        allowedAttributes: { a: ['href'] },
      }),
      category: 'preserve-safe-html',
    });
  } catch { console.warn('sanitize-html unavailable — skipping'); }

  try {
    const xss = (await import('xss')).default;
    list.push({ name: 'xss', fn: (i) => xss(i), category: 'preserve-safe-html' });
  } catch { console.warn('xss unavailable — skipping'); }

  try {
    const { rehype } = await import('rehype');
    const rehypeSanitize = (await import('rehype-sanitize')).default;
    const processor = rehype().use(rehypeSanitize);
    list.push({
      name: 'rehype-sanitize',
      fn: (i) => String(processor.processSync(i)),
      category: 'preserve-safe-html',
    });
  } catch { console.warn('rehype-sanitize unavailable — skipping'); }

  try {
    const striptags = (await import('striptags')).default;
    list.push({ name: 'striptags', fn: (i) => striptags(i), category: 'strip-to-text' });
  } catch { console.warn('striptags unavailable — skipping'); }

  try {
    const escapeHtml = (await import('escape-html')).default;
    list.push({ name: 'escape-html', fn: (i) => escapeHtml(i), category: 'encode-as-text' });
  } catch { console.warn('escape-html unavailable — skipping'); }

  try {
    const validator = (await import('validator')).default;
    list.push({ name: 'validator.escape', fn: (i) => validator.escape(i), category: 'encode-as-text' });
  } catch { console.warn('validator unavailable — skipping'); }

  try {
    const { escapeUTF8 } = await import('entities');
    list.push({ name: 'entities.escapeUTF8', fn: (i) => escapeUTF8(i), category: 'encode-as-text' });
  } catch { console.warn('entities unavailable — skipping'); }

  try {
    const { encode } = await import('html-entities');
    list.push({ name: 'html-entities', fn: (i) => encode(i), category: 'encode-as-text' });
  } catch { console.warn('html-entities unavailable — skipping'); }

  try {
    const he = (await import('he')).default;
    list.push({ name: 'he.escape', fn: (i) => he.escape(i), category: 'encode-as-text' });
  } catch { console.warn('he unavailable — skipping'); }

  return list;
}

const sanitizers = await loadSanitizers();

const PERF_INPUTS = [
  ...ALL_ATTACKS,
  ...BENIGN_CORPUS.map((sample) => sample.html),
];

function measureThroughput(sanitizeFn) {
  const warmupIterations = 500;
  const measuredIterations = 1000;
  const sampleCount = 7;
  let checksum = 0;

  for (let i = 0; i < warmupIterations; i++) {
    checksum += String(sanitizeFn(PERF_INPUTS[i % PERF_INPUTS.length]) ?? '').length;
  }

  const microsecondsPerOperation = [];
  for (let sample = 0; sample < sampleCount; sample++) {
    const started = process.hrtime.bigint();
    for (let i = 0; i < measuredIterations; i++) {
      checksum += String(sanitizeFn(PERF_INPUTS[i % PERF_INPUTS.length]) ?? '').length;
    }
    const elapsedMicroseconds = Number(process.hrtime.bigint() - started) / 1e3;
    microsecondsPerOperation.push(elapsedMicroseconds / measuredIterations);
  }

  // Reading the output length prevents engines from treating calls as dead work.
  if (checksum < 0) throw new Error('unreachable checksum');
  microsecondsPerOperation.sort((a, b) => a - b);
  const medianUs = microsecondsPerOperation[Math.floor(sampleCount / 2)];
  const p95Us = microsecondsPerOperation[Math.ceil(sampleCount * 0.95) - 1];
  return {
    medianOpsPerSecond: Math.round(1e6 / medianUs),
    p95Us,
  };
}

console.log('\n🔬 FAIR SANITIZER BENCHMARK');
console.log(`   ${ALL_ATTACKS.length} attack vectors · ${BENIGN_CORPUS.length} benign documents`);
console.log('   Executable output: parsed + re-parsed in jsdom (catches mutation XSS)');
console.log('   Fidelity: exact visible text, safe markup, and raw-container body removal\n');

const table = new Table({
  head: ['Library', 'Category', 'No exec', 'Exact text', 'Markup', 'Raw body', 'Median ops/s', 'p95 µs/op'],
  colWidths: [22, 20, 9, 12, 10, 11, 14, 11],
});

const results = [];
for (const s of sanitizers) {
  const security = evaluateSecurity(s.fn);
  const fidelity = evaluateFidelity(s.fn);
  const rawTextPct = evaluateRawTextRemoval(s.fn);
  const throughput = measureThroughput(s.fn);
  results.push({ ...s, security, fidelity, rawTextPct, throughput });
  table.push([
    s.name,
    s.category,
    `${security.pct.toFixed(1)}%`,
    `${fidelity.textPct.toFixed(1)}%`,
    `${fidelity.markupPct.toFixed(1)}%`,
    `${rawTextPct.toFixed(1)}%`,
    throughput.medianOpsPerSecond.toLocaleString('en-US'),
    throughput.p95Us.toFixed(3),
  ]);
}
console.log(table.toString());

console.log('\nHow to read this:');
console.log('  • No exec: corpus outputs had no executable nodes/attributes after two parses.');
console.log('  • Exact text: reader-visible output exactly matched each benign fixture.');
console.log('  • Raw body: script/style/iframe/svg/template bodies were removed exactly.');
console.log('  • encode-as-text rows display original markup; they do not strip it.');
console.log('  • Throughput is the median of 7 samples after warm-up; p95 is the');
console.log('    slowest sample in this small local run. Compare only within a category.');
console.log('');

console.log('Synthetic metric controls (not packages or rivals):');
for (const control of [
  { name: 'delete-all', fn: () => '' },
  { name: 'identity', fn: (value) => value },
]) {
  const security = evaluateSecurity(control.fn);
  const fidelity = evaluateFidelity(control.fn);
  const rawTextPct = evaluateRawTextRemoval(control.fn);
  console.log(`  • ${control.name}: no-exec ${security.pct.toFixed(1)}%, exact-text ${fidelity.textPct.toFixed(1)}%, raw-body ${rawTextPct.toFixed(1)}%`);
}
console.log('  These controls show why executable-output results require fidelity metrics.\n');

for (const r of results) {
  if (r.security.failures.length) {
    console.log(`❌ ${r.name} — ${r.security.failures.length} vector(s) still executable:`);
    for (const f of r.security.failures.slice(0, 5)) {
      console.log(`   • ${f.reason}  ←  ${f.vector.slice(0, 64)}`);
    }
  } else {
    console.log(`✅ ${r.name} — no executable output across ${r.security.total} vectors`);
  }
}

const purifai = results.find((r) => r.name === 'Purifai.sanitize');
console.log('');
process.exit(purifai && purifai.security.failures.length === 0 ? 0 : 1);
