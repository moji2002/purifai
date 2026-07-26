#!/usr/bin/env node
/**
 * Regression suite for defects found in v1.0.0.
 *
 * Every case here failed against the published 1.0.0 build. Keep them.
 */

import {
  Purifai,
  sanitize,
  analyze,
  isDangerous,
  sanitizeBatch,
  escape,
  escapeAttribute,
  escapeUrl,
} from '../dist/index.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (!ok) {
    console.log(`   Expected: ${JSON.stringify(expected)}`);
    console.log(`   Got:      ${JSON.stringify(actual)}`);
    failed++;
  } else {
    passed++;
  }
}

function assert(name, condition, detail = '') {
  console.log(`${condition ? '✅' : '❌'} ${name}${condition ? '' : ` — ${detail}`}`);
  if (condition) passed++; else failed++;
}

console.log('🔁 Purifai Regression Suite\n');

// ---------------------------------------------------------------------------
// 1. Detached named exports must not depend on a call-site receiver.
//    v1.0.0: threw in ESM; in CJS `this` became module.exports so sanitization
//    silently ran with NO default options.
// ---------------------------------------------------------------------------
console.log('📦 Named exports (this-binding):');
check('named sanitize() matches static', sanitize('<script>alert(1)</script>Hello'), 'Hello');
check('static sanitize()', Purifai.sanitize('<script>alert(1)</script>Hello'), 'Hello');
check('named sanitizeBatch()', sanitizeBatch(['<script>alert(1)</script>Hello', 'Safe text']), ['Hello', 'Safe text']);
check('named analyze().threatLevel', analyze('<script>x</script>').threatLevel, 'critical');
assert('named isDangerous() works detached', isDangerous('<script>alert(1)</script>') === true);

// Destructured out of the CJS build too — this is the path that silently
// degraded rather than throwing.
const cjs = require('../dist/index.cjs');
const { sanitize: cjsSanitize } = cjs;
check('CJS destructured sanitize()', cjsSanitize('<script>alert(1)</script>Hello'), 'Hello');

// ---------------------------------------------------------------------------
// 2. Detection must be stateless.
//    v1.0.0: isDangerous() used .test() on /g regexes, so lastIndex advanced
//    and repeated calls alternated true,false,true,false...
// ---------------------------------------------------------------------------
console.log('\n♻️  Stateless detection:');
const repeated = Array.from({ length: 10 }, () => isDangerous('<script>alert(1)</script>'));
assert('isDangerous() stable across 10 calls', repeated.every(Boolean), `got ${repeated.join(',')}`);

const repeatedSafe = Array.from({ length: 10 }, () => isDangerous('perfectly safe text'));
assert('isDangerous() stable for safe input', repeatedSafe.every((v) => v === false), `got ${repeatedSafe.join(',')}`);

// Sanitizing the same input repeatedly must be deterministic.
const repeatedSanitize = Array.from({ length: 10 }, () => sanitize('<img src=x onerror=alert(1)>World'));
assert('sanitize() deterministic across 10 calls', new Set(repeatedSanitize).size === 1, `got ${[...new Set(repeatedSanitize)].join(' | ')}`);

// ---------------------------------------------------------------------------
// 3. Dangerous tags must be removed WITH their content.
//    v1.0.0: generic tag stripping ran first and orphaned the tag body, so
//    '<script>alert(1)</script>Hello' sanitized to '1)Hello'.
// ---------------------------------------------------------------------------
console.log('\n🏷️  Tag + content removal:');
check('script body does not leak', sanitize('<script>alert(1)</script>Hello'), 'Hello');
check('script body with quotes', sanitize('<script>alert("test")</script>Hello World'), 'Hello World');
check('style body does not leak', sanitize('<style>body{color:red}</style>Text'), 'Text');
check('iframe body does not leak', sanitize('<iframe>inner</iframe>After'), 'After');

// ---------------------------------------------------------------------------
// 4. Idempotence — sanitizing twice must equal sanitizing once.
// ---------------------------------------------------------------------------
console.log('\n🔂 Idempotence:');
const idempotenceCases = [
  '<script>alert(1)</script>Hello',
  '<img src=x onerror=alert(1)>World',
  'Safe text',
  '<svg/onload=alert(1)>',
];
for (const input of idempotenceCases) {
  const once = sanitize(input);
  const twice = sanitize(once);
  assert(`idempotent: ${JSON.stringify(input.slice(0, 34))}`, once === twice, `${JSON.stringify(once)} -> ${JSON.stringify(twice)}`);
}

// ---------------------------------------------------------------------------
// 5. Benign content must survive untouched.
// ---------------------------------------------------------------------------
console.log('\n🌱 Benign input preserved:');
check('plain text', sanitize('Plain text, no markup.'), 'Plain text, no markup.');
check('percent sign does not break decoding', sanitize('Price is 100% of $5'), 'Price is 100% of $5');
check('url with // survives', sanitize('Visit https://example.com/a?b=1'), 'Visit https://example.com/a?b=1');
check('email survives', sanitize('Email me at a@b.com'), 'Email me at a@b.com');

// A stray '%' used to throw inside decodeURIComponent and skip every
// subsequent decoder; decoding steps are now independently guarded.
check('stray % still decodes entities', sanitize('50% &#72;i'), '50% Hi');

// ---------------------------------------------------------------------------
// 6. Modern attack classes (mXSS, namespace confusion, rawtext breakout).
//    Sources: cure53/DOMPurify attack-class wiki, PortSwigger mXSS research.
//    Criterion: a string sanitizer's output is only unambiguously safe for HTML
//    insertion when it carries no markup delimiters and no handlers at all.
// ---------------------------------------------------------------------------
console.log('\n🧬 Modern attack classes:');
const MODERN = [
  ['mXSS style/attr breakout',   '<svg></p><style><a id="</style><img src=x onerror=alert(1)>"></svg>'],
  ['namespace math/mglyph',      '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>'],
  ['namespace svg/p/style',      '<svg><p><style><img src=x onerror=alert(1)></style></p></svg>'],
  ['rawtext noscript breakout',  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">'],
  ['nesting form/math/table',    '<form><math><mtext><table><mglyph><style><img src=x onerror=alert(1)>'],
  ['DOM clobbering nodeName',    '<form><input name=nodeName></form>'],
  ['template reassembly',        '<div>{<foo></foo>{constructor.constructor("alert(1)")()}<foo></foo>}</div>'],
  ['PortSwigger Chrome mXSS',    '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">'],
  ['PortSwigger Firefox mXSS',   '<math><mtext><table><mglyph><style><![CDATA[</style><img title="]]&gt;&lt;/mglyph&gt;&lt;img&Tab;src=1&Tab;onerror=alert(1)&gt;">'],
  ['depth flattening (600)',     '<div>'.repeat(600) + '<style><img src=x onerror=alert(1)>'],
  ['comment breakout',           '<!--><script>alert(1)</script>-->'],
  ['CDATA breakout',             '<![CDATA[<script>alert(1)</script>]]>'],
  ['entity-encoded handler',     '<img src=x onerror=&#97;lert(1)>'],
  ['tab-split attribute',        '<img\tsrc=x\tonerror=alert(1)>'],
  ['newline-split handler',      '<img src=x on\nerror=alert(1)>'],
  ['null byte in tag',           '<scri\x00pt>alert(1)</scri\x00pt>'],
  ['unclosed attr quote',        '<img src="x onerror=alert(1)>'],
  ['backtick attribute',         '<img src=`x`onerror=alert(1)>'],
  ['svg animate onbegin',        '<svg><animate onbegin=alert(1) attributeName=x dur=1s>'],
  ['svg set href js:',           '<svg><set attributeName=href to="javascript:alert(1)">'],
  ['iframe srcdoc entity',       '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;">'],
  ['base tag hijack',            '<base href="javascript:alert(1)//">'],
  ['meta refresh',               '<meta http-equiv=refresh content="0;url=javascript:alert(1)">'],
  ['style expression',           '<div style="width:expression(alert(1))">'],
  ['@import in style',           '<style>@import "javascript:alert(1)";</style>'],
];

for (const [name, payload] of MODERN) {
  let out;
  try {
    out = sanitize(payload);
  } catch (e) {
    assert(`${name}`, false, `threw ${e.message}`);
    continue;
  }
  const clean = !/[<>]/.test(out) && !/on[a-z]+\s*=/i.test(out) && !/javascript\s*:|vbscript\s*:/i.test(out);
  assert(`${name}`, clean, `residue: ${JSON.stringify(out.slice(0, 70))}`);
}

// ---------------------------------------------------------------------------
// 7. Non-string and hostile input types must not throw.
// ---------------------------------------------------------------------------
console.log('\n🧱 Input robustness:');
const hostile = [
  null, undefined, 0, 1, true, false, NaN, Infinity, -0,
  [], {}, [1, 2, 3], { a: 1 }, Symbol.iterator, () => {}, new Date(0),
];
let threw = null;
for (const input of hostile) {
  try {
    const out = sanitize(input);
    if (typeof out !== 'string') { threw = `non-string output for ${String(input)}`; break; }
  } catch (e) {
    threw = `${String(input)} threw ${e.message}`;
    break;
  }
}
assert('never throws / always returns string', threw === null, threw ?? '');

// Circular objects must not blow up JSON.stringify.
const circular = { name: 'x' };
circular.self = circular;
let circularOk = true;
try { sanitize(circular); } catch { circularOk = false; }
assert('circular object handled', circularOk);

// Very large input must respect maxLength without pathological slowdown.
const big = '<script>alert(1)</script>'.repeat(20000);
const t0 = performance.now();
sanitize(big);
const elapsed = performance.now() - t0;
assert(`large input (${big.length} chars) under 3s`, elapsed < 3000, `took ${elapsed.toFixed(0)}ms`);

// ---------------------------------------------------------------------------
// 8. Stray angle brackets in benign prose must be escaped, not deleted.
//    v1.0.0: sanitize('5 < 6 and 7 > 3') returned '5 3'.
// ---------------------------------------------------------------------------
console.log('\n🔤 Angle brackets in benign text:');
check('comparison operators preserved', sanitize('5 < 6 and 7 > 3'), '5 &lt; 6 and 7 &gt; 3');
check('real markup still stripped', sanitize('<p>Hello <b>world</b></p>'), 'Hello world');
check('lone less-than preserved', sanitize('a < b'), 'a &lt; b');

// ---------------------------------------------------------------------------
// 9. Bare script protocols must be detected without an attribute prefix.
//    Previously isDangerous('vbscript:alert(1)') was false, so the payload
//    took the benign path and 'vbscript:' survived into the output.
// ---------------------------------------------------------------------------
console.log('\n🔗 Bare protocol detection:');
assert('vbscript: flagged', isDangerous('vbscript:alert(1)') === true);
assert('javascript: flagged', isDangerous('javascript:alert(1)') === true);
assert('mixed-case flagged', isDangerous('JaVaScRiPt:alert(1)') === true);
assert('https: NOT flagged', isDangerous('https://example.com') === false);
assert('no vbscript: in output', !/vbscript\s*:/i.test(sanitize('vbscript:alert(1)')));
assert('no javascript: in output', !/javascript\s*:/i.test(sanitize('javascript:alert(1)')));

// ---------------------------------------------------------------------------
// 10. Contextual escaping APIs.
// ---------------------------------------------------------------------------
console.log('\n🧷 Contextual escaping:');
check('escape() is lossless for code', escape('if (a<b && c>d) return;'), 'if (a&lt;b &amp;&amp; c&gt;d) return;');
check('escape() handles quotes', escape(`O'Reilly "x"`), 'O&#39;Reilly &quot;x&quot;');
check('escape() null/undefined', [escape(null), escape(undefined)], ['', '']);
assert('escape() neutralises script tags', !/[<>]/.test(escape('<script>alert(1)</script>')));

assert('escapeAttribute() encodes space', escapeAttribute('x onerror=alert(1)').includes('&#x20;'));
assert('escapeAttribute() encodes =', !escapeAttribute('a=b').includes('='));
assert('escapeAttribute() encodes backtick', !escapeAttribute('a`b').includes('`'));
assert('escapeAttribute() keeps alphanumerics', escapeAttribute('abc123') === 'abc123');

check('escapeUrl() blocks javascript:', escapeUrl('javascript:alert(1)'), '');
check('escapeUrl() blocks mixed case', escapeUrl('JaVaScRiPt:alert(1)'), '');
check('escapeUrl() blocks tab-split', escapeUrl('java\tscript:alert(1)'), '');
check('escapeUrl() blocks data:', escapeUrl('data:text/html,<script>'), '');
assert('escapeUrl() allows https', escapeUrl('https://example.com').length > 0);
assert('escapeUrl() allows mailto', escapeUrl('mailto:a@b.com').length > 0);
assert('escapeUrl() allows relative', escapeUrl('/relative/path').length > 0);
assert('escapeUrl() honours allowedProtocols', escapeUrl('mailto:a@b.com', { allowedProtocols: ['https'] }) === '');

// Escaped output must be inert: no markup delimiters survive any escaper.
for (const [name, fn] of [['escape', escape], ['escapeAttribute', escapeAttribute]]) {
  const out = fn('<img src=x onerror=alert(1)>');
  assert(`${name}() output carries no < or >`, !/[<>]/.test(out), JSON.stringify(out));
}

// ---------------------------------------------------------------------------
// 11. No configuration may emit a raw markup delimiter.
//     With aggressiveMode:false nothing used to neutralise fragments the tag
//     patterns cannot match: '<!-->' left '-->' and an attribute breakout
//     left '">'.
// ---------------------------------------------------------------------------
console.log('\n🚧 No raw delimiters in any config:');
const delimiterCases = [
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  '<!--><script>alert(1)</script>-->',
  '<svg></p><style><a id="</style><img src=x onerror=alert(1)>"></svg>',
];
for (const opts of [undefined, { aggressiveMode: false }, { aggressiveMode: true }]) {
  const label = opts === undefined ? 'default' : `aggressiveMode:${opts.aggressiveMode}`;
  const offenders = delimiterCases.filter((c) => /[<>]/.test(sanitize(c, opts)));
  assert(`${label} emits no raw < or >`, offenders.length === 0, offenders.map((c) => JSON.stringify(sanitize(c, opts))).join(' '));
}

// ---------------------------------------------------------------------------
// 12. getVersion() must not drift from package.json.
// ---------------------------------------------------------------------------
console.log('\n🏷️  Version consistency:');
const pkg = require('../package.json');
check('getVersion() matches package.json', Purifai.getVersion(), pkg.version);
check('getStats().version matches', Purifai.getStats().version, pkg.version);

// ---------------------------------------------------------------------------
console.log(`\n📈 Regression Results:`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📊 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

if (failed === 0) {
  console.log('\n🎉 All regression tests passed.');
  process.exit(0);
} else {
  console.log('\n⚠️  Regressions detected.');
  process.exit(1);
}
