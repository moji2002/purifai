#!/usr/bin/env node
/**
 * Performance + critical-attack verification against the built bundle.
 *
 * Previously this file `require()`d a nonexistent `./index-compressed.js` from
 * a `"type": "module"` package, so it could never run. It now measures the
 * actual published artifact in dist/.
 */

import fs from 'fs';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import path from 'path';
import { Purifai } from '../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const esmBundle = path.join(here, '..', 'dist', 'index.js');

// Test inputs
const testInputs = [
    'Simple text with no HTML',
    '<p>Simple paragraph with <b>bold</b> text</p>',
    '<script>alert("xss")</script><p>Mixed content</p>',
    'jaVasCript:/*-/*`/*\\`/*\'/*"/**/(/* */oNcliCk=alert() )//',
    'A'.repeat(1000),
    '<iframe src="javascript:alert(1)"><script>alert(2)</script><img src=x onerror=alert(3)>'
];

console.log('🔬 Purifai Performance Verification\n');

// Warm up
for (let i = 0; i < 1000; i++) {
    Purifai.sanitize(testInputs[i % testInputs.length]);
}

// Performance test
const iterations = 10000;
const start = process.hrtime.bigint();

for (let i = 0; i < iterations; i++) {
    Purifai.sanitize(testInputs[i % testInputs.length]);
}

const end = process.hrtime.bigint();
const totalTime = Number(end - start) / 1000000; // Convert to milliseconds
const avgTime = totalTime / iterations;
const opsPerSecond = Math.round(1000 / avgTime);

console.log(`Performance Results:`);
console.log(`Total time: ${totalTime.toFixed(2)}ms`);
console.log(`Average time per operation: ${avgTime.toFixed(4)}ms`);
console.log(`Operations per second: ${opsPerSecond.toLocaleString()}`);

// Verify specific polyglot attacks
console.log('\n🛡️  Security Verification:');

const criticalAttacks = [
    {
        name: 'Universal XSS Polyglot',
        payload: 'jaVasCript:/*-/*`/*\\`/*\'/*"/**/(/* */oNcliCk=alert() )//%0D%0A%0d%0a//</stYle/</titLe/</teXtarEa/</scRipt/--!>\\x3csVg/<sVg/oNloAd=alert()///>\\x3e'
    },
    {
        name: 'Ultimate XSS Polyglot',
        payload: 'javascript:/*--></title></style></textarea></script></xmp><svg/onload=\'+/"/+/onmouseover=1/+/[*/[]/+alert(1)//\'>'
    },
    {
        name: 'Namespace Confusion Attack',
        payload: '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>'
    }
];

let blockedCount = 0;
for (const attack of criticalAttacks) {
    const result = Purifai.sanitize(attack.payload);
    const blocked = !/[<>]/.test(result);
    console.log(`${blocked ? '✅' : '❌'} ${attack.name}: ${blocked ? 'no raw markup' : 'raw markup remained'}`);
    if (blocked) blockedCount++;
}

console.log(`\n📊 Critical Attack Results: ${blockedCount}/${criticalAttacks.length} produced plain text`);

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

function measureAdversarial(input) {
    const iterations = Math.max(16, Math.floor((2 * 1024 * 1024) / input.length));
    let checksum = 0;
    for (let i = 0; i < Math.min(iterations, 64); i++) checksum += Purifai.sanitize(input).length;

    const samples = [];
    for (let sample = 0; sample < 5; sample++) {
        const started = process.hrtime.bigint();
        for (let i = 0; i < iterations; i++) checksum += Purifai.sanitize(input).length;
        const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
        samples.push(elapsed / iterations);
    }
    if (checksum < 0) throw new Error('unreachable checksum');
    return median(samples);
}

console.log('\n📈 Adversarial scanner scaling (median after warm-up):');
const adversarialSizes = [2, 4, 8, 16, 32, 64, 128].map((kib) => kib * 1024);
function measureShape(label, makeInput) {
  console.log(`\n${label}:`);
  return adversarialSizes.map((size) => {
    const input = makeInput(size);
    const medianMs = measureAdversarial(input);
    console.log(`${String(size / 1024).padStart(3)} KiB  ${medianMs.toFixed(4)} ms  ${(medianMs * 1e6 / size).toFixed(2)} ns/char`);
    return { size, medianMs };
  });
}

const topLevelScaling = measureShape('top-level incomplete tag candidates', (size) => {
    const unit = '<script ';
    return unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
});
const nestedScaling = measureShape('incomplete tag candidates inside <script>', (size) => {
    const prefix = '<script>';
    const unit = '<a ';
    return prefix + unit.repeat(Math.ceil((size - prefix.length) / unit.length)).slice(0, size - prefix.length);
});

function growthOf(series) {
    const first = series[0];
    const last = series[series.length - 1];
    const sizeGrowth = last.size / first.size;
    const timeGrowth = last.medianMs / Math.max(first.medianMs, Number.EPSILON);
    const normalizedGrowth = (last.medianMs / last.size) / Math.max(first.medianMs / first.size, Number.EPSILON);
    return { sizeGrowth, timeGrowth, normalizedGrowth };
}

const growth = [topLevelScaling, nestedScaling].map(growthOf);
const boundedScaling = growth.every(({ sizeGrowth, timeGrowth, normalizedGrowth }) =>
    timeGrowth <= sizeGrowth * 3 && normalizedGrowth <= 3
);
for (const [index, result] of growth.entries()) {
    console.log(`Shape ${index + 1}: ${result.timeGrowth.toFixed(2)}× time for ${result.sizeGrowth}× input; normalized ${result.normalizedGrowth.toFixed(2)}×`);
}
console.log(`${boundedScaling ? '✅' : '❌'} bounded near-linear scaling`);

// Bundle size
const stats = fs.statSync(esmBundle);
console.log(`\n📦 Bundle Size: ${stats.size} bytes (${(stats.size / 1024).toFixed(1)}KB)`);

// Gzip in-process: no shell, no dependency on a `gzip` binary.
try {
    const gzippedSize = zlib.gzipSync(fs.readFileSync(esmBundle)).length;
    console.log(`📦 Gzipped Size: ${gzippedSize} bytes (${(gzippedSize / 1024).toFixed(1)}KB)`);
} catch {
    console.log('📦 Gzipped Size: Could not calculate');
}

console.log('\n✅ Verification complete!');

if (blockedCount !== criticalAttacks.length || !boundedScaling) {
    process.exit(1);
}
