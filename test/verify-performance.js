#!/usr/bin/env node

const { Purifai } = require('./index-compressed.js');

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
    const blocked = result === '' || result.trim() === '';
    console.log(`${blocked ? '✅' : '❌'} ${attack.name}: ${blocked ? 'Blocked' : 'Failed'}`);
    if (blocked) blockedCount++;
}

console.log(`\n📊 Critical Attack Results: ${blockedCount}/${criticalAttacks.length} blocked`);

// Bundle size
const fs = require('fs');
const stats = fs.statSync('./index-compressed.js');
console.log(`\n📦 Bundle Size: ${stats.size} bytes (${(stats.size/1024).toFixed(1)}KB)`);

const { execSync } = require('child_process');
try {
    const gzippedSize = execSync('gzip -c index-compressed.js | wc -c', { encoding: 'utf8' }).trim();
    console.log(`📦 Gzipped Size: ${gzippedSize} bytes (${(gzippedSize/1024).toFixed(1)}KB)`);
} catch (e) {
    console.log('📦 Gzipped Size: Could not calculate');
}

console.log('\n✅ Verification complete!');