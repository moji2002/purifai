#!/usr/bin/env node
/**
 * Property-based fuzzing with a real DOM as the oracle.
 *
 * The curated corpora only prove Purifai survives attacks somebody already
 * thought of. This generates payloads from attack grammar fragments and asserts
 * invariants that must hold for EVERY input, checking the result against jsdom
 * rather than against another regex.
 *
 * Invariants:
 *   1. sanitize() never throws, for any input.
 *   2. Output always contains a string, never undefined/null.
 *   3. Parsed output yields no script node, no on* handler, no dangerous URL.
 *   4. Output survives a serialize→reparse round trip unchanged (no mXSS).
 *   5. sanitize(sanitize(x)) === sanitize(x)  (idempotence).
 *   6. escape() output re-parses to exactly the original text (lossless).
 *
 * Deterministic: a seeded PRNG means a failure is always reproducible via
 * PURIFAI_FUZZ_SEED.
 */

import { JSDOM, VirtualConsole } from 'jsdom';
import { Purifai, escape } from '../dist/index.js';

const SEED = Number(process.env.PURIFAI_FUZZ_SEED ?? 20260726);
const ITERATIONS = Number(process.env.PURIFAI_FUZZ_ITERATIONS ?? 4000);

// mulberry32 — small, fast, deterministic.
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// NOTE for security scanners: the strings below are attack-grammar *data*.
// Nothing here is executed — 'eval(1)' is a payload fragment fed to sanitize(),
// and the innerHTML assignments target a sandboxed jsdom tree that exists purely
// to observe what a browser parser would build. Using textContent instead would
// defeat the entire test.
const TAGS = ['script', 'svg', 'math', 'style', 'iframe', 'img', 'form', 'noscript', 'textarea', 'title', 'xmp', 'mglyph', 'mtext', 'table', 'div', 'p', 'b', 'a', 'base', 'meta', 'object', 'embed', 'animate', 'set'];
const HANDLERS = ['onerror', 'onload', 'onclick', 'onbegin', 'ontoggle', 'onfocus', 'onmouseover', 'onstart', 'onanimationend'];
const PROTOS = ['javascript:', 'vbscript:', 'JaVaScRiPt:', 'java\tscript:', 'data:text/html', 'livescript:', 'mocha:'];
const PAYLOADS = ['alert(1)', 'eval(1)', 'confirm(1)', 'prompt(1)', 'constructor.constructor("alert(1)")()'];
const BREAKERS = ['"', "'", '`', '</', '/>', '>', '<', '--!>', '<!--', '-->', '<![CDATA[', ']]>', '\\x3c', '\\u003c', '&#60;', '&#x3c;', '%3c', '\t', '\n', '\r', '\x00', '/*', '*/', '//', '&Tab;', '&NewLine;'];
const TEXT = ['Hello', 'World', 'safe text', '100%', '5 < 6', 'a@b.com', 'https://x.com', 'Résumé 日本語 🎉', ''];

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

function generate(rng) {
  const parts = [];
  const n = 1 + Math.floor(rng() * 8);
  for (let i = 0; i < n; i++) {
    switch (Math.floor(rng() * 7)) {
      case 0: parts.push(`<${pick(rng, TAGS)}>`); break;
      case 1: parts.push(`</${pick(rng, TAGS)}>`); break;
      case 2: parts.push(` ${pick(rng, HANDLERS)}=${pick(rng, PAYLOADS)}`); break;
      case 3: parts.push(`href="${pick(rng, PROTOS)}${pick(rng, PAYLOADS)}"`); break;
      case 4: parts.push(pick(rng, BREAKERS)); break;
      case 5: parts.push(pick(rng, TEXT)); break;
      default: parts.push(`<${pick(rng, TAGS)} ${pick(rng, HANDLERS)}=${pick(rng, PAYLOADS)}>`); break;
    }
  }
  return parts.join('');
}

const DANGEROUS_URL = /^\s*(?:javascript|vbscript|livescript|mocha|data)\s*:/i;
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster', 'srcdoc']);

const virtualConsole = new VirtualConsole();
const dom = new JSDOM('<!DOCTYPE html><body><div id="root"></div></body>', { virtualConsole });
const root = dom.window.document.getElementById('root');

function threatsIn(html) {
  root.innerHTML = html;
  const found = [];
  for (const el of root.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'script') found.push('script node');
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) found.push(`${tag}[${name}]`);
      if (URL_ATTRS.has(name) && DANGEROUS_URL.test(attr.value)) found.push(`${tag}[${name}]`);
    }
  }
  return { threats: found, serialized: root.innerHTML };
}

console.log('🎲 Purifai Fuzz Suite');
console.log(`   seed=${SEED} iterations=${ITERATIONS}\n`);

const rng = makeRng(SEED);
const failures = [];
let checked = 0;

for (let i = 0; i < ITERATIONS; i++) {
  const input = generate(rng);
  const record = (rule, detail) => failures.push({ i, input, rule, detail });

  let out;
  try {
    out = Purifai.sanitize(input);
  } catch (e) {
    record('1: never throws', e.message);
    continue;
  }

  if (typeof out !== 'string') {
    record('2: always a string', typeof out);
    continue;
  }

  const first = threatsIn(out);
  if (first.threats.length) record('3: no executable output', first.threats.join(','));

  const second = threatsIn(first.serialized);
  if (second.threats.length) record('4: safe after reparse', second.threats.join(','));
  if (second.serialized !== first.serialized) record('4: stable round trip', `${first.serialized} -> ${second.serialized}`);

  const twice = Purifai.sanitize(out);
  if (twice !== out) record('5: idempotent', `${JSON.stringify(out)} -> ${JSON.stringify(twice)}`);

  // escape() must be lossless: parsing its output returns the original text.
  // Control characters are excluded — escape() strips them by design, since the
  // HTML parser drops or replaces them and they are a known bypass vector.
  // The HTML parser also normalises CRLF/CR to LF per spec, so the oracle
  // compares against input with that normalisation applied.
  const escaped = escape(input);
  root.innerHTML = escaped;
  const expected = input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
    .replace(/\r\n?/g, '\n');
  if ((root.textContent || '') !== expected) {
    record('6: escape() lossless', `${JSON.stringify(expected)} -> ${JSON.stringify(root.textContent)}`);
  }

  checked++;
}

console.log(`Checked ${checked} generated payloads across 6 invariants.`);

if (failures.length === 0) {
  console.log('\n🎉 No invariant violations.');
  process.exit(0);
}

console.log(`\n❌ ${failures.length} violation(s):`);
const byRule = {};
for (const f of failures) (byRule[f.rule] ??= []).push(f);
for (const [rule, list] of Object.entries(byRule)) {
  console.log(`\n  ${rule} — ${list.length} case(s)`);
  for (const f of list.slice(0, 3)) {
    console.log(`    input : ${JSON.stringify(f.input.slice(0, 100))}`);
    console.log(`    detail: ${f.detail}`);
  }
}
console.log(`\nReproduce with: PURIFAI_FUZZ_SEED=${SEED} pnpm test:fuzz`);
process.exit(1);
