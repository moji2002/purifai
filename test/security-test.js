#!/usr/bin/env node

import { Purifai } from '../dist/index.js';

// Critical attack vectors that bypass other sanitizers
const criticalAttacks = [
  {
    name: 'Universal XSS Polyglot',
    payload: 'jaVasCript:/*-/*`/*\\`/*\'/*"/**/(/* */oNcliCk=alert() )//%0D%0A%0d%0a//</stYle/</titLe/</teXtarEa/</scRipt/--!>\\x3csVg/<sVg/oNloAd=alert()///>\\x3e',
    expectedResult: ''
  },
  {
    name: 'Ultimate XSS Polyglot',
    payload: 'javascript:/*--></title></style></textarea></script></xmp><svg/onload=\'+/"/+/onmouseover=1/+/[*/[]/+alert(1)//\'>',
    expectedResult: ''
  },
  {
    name: 'Namespace Confusion Attack',
    payload: '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>',
    expectedResult: ''
  }
];

// Basic XSS vectors
const basicAttacks = [
  '<script>alert("xss")</script>',
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>',
  '<body onload=alert(1)>',
  '<iframe src="javascript:alert(1)">',
  '<object data="javascript:alert(1)">',
  '<embed src="javascript:alert(1)">',
  '<link href="javascript:alert(1)">',
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<form action="javascript:alert(1)">',
  '<div onclick="alert(1)">',
  '<a href="javascript:alert(1)">',
  '<input type="text" value="" autofocus onfocus="alert(1)">',
  '<select autofocus onfocus="alert(1)">',
  '<textarea autofocus onfocus="alert(1)">',
  '<keygen autofocus onfocus="alert(1)">',
  '<video><source onerror="alert(1)">',
  '<audio src=x onerror=alert(1)>',
  '<details open ontoggle=alert(1)>',
  '<marquee onstart=alert(1)>'
];

console.log('🛡️  Purifai Security Test Suite\n');

let passed = 0;
let failed = 0;

// Test critical attacks
console.log('🔥 Testing Critical Polyglot Attacks:');
for (const attack of criticalAttacks) {
  const result = Purifai.sanitize(attack.payload);
  const success = result === attack.expectedResult;
  
  console.log(`${success ? '✅' : '❌'} ${attack.name}`);
  if (!success) {
    console.log(`   Expected: "${attack.expectedResult}"`);
    console.log(`   Got:      "${result}"`);
    failed++;
  } else {
    passed++;
  }
}

console.log('\n🔒 Testing Basic XSS Vectors:');
for (let i = 0; i < basicAttacks.length; i++) {
  const attack = basicAttacks[i];
  const result = Purifai.sanitize(attack);
  
  // Check if dangerous content was removed
  const safe = !/<script|javascript:|on\w+\s*=|<iframe|<object|<embed|<svg|<form|<meta.*refresh/i.test(result);
  
  console.log(`${safe ? '✅' : '❌'} Vector ${i + 1}: ${safe ? 'Blocked' : 'Failed'}`);
  if (!safe) {
    console.log(`   Input:  ${attack}`);
    console.log(`   Output: ${result}`);
    failed++;
  } else {
    passed++;
  }
}

// Test analysis function
console.log('\n📊 Testing Analysis Function:');
const analysisTest = Purifai.analyze('<script>alert("test")</script>Hello World');
const analysisPass = (
  analysisTest.content === 'Hello World' &&
  analysisTest.hadThreats === true &&
  analysisTest.threatLevel === 'critical' &&
  typeof analysisTest.processingTime === 'number'
);

console.log(`${analysisPass ? '✅' : '❌'} Analysis function: ${analysisPass ? 'Passed' : 'Failed'}`);
if (analysisPass) passed++; else failed++;

// Test batch processing
console.log('\n📦 Testing Batch Processing:');
const batchInput = ['<script>alert(1)</script>Hello', '<img src=x onerror=alert(1)>World', 'Safe text'];
const batchResult = Purifai.sanitizeBatch(batchInput);
const batchPass = (
  batchResult.length === 3 &&
  batchResult[0] === 'Hello' &&
  batchResult[1] === 'World' &&
  batchResult[2] === 'Safe text'
);

console.log(`${batchPass ? '✅' : '❌'} Batch processing: ${batchPass ? 'Passed' : 'Failed'}`);
if (batchPass) passed++; else failed++;

// Summary
console.log(`\n📈 Test Results:`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📊 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

if (failed === 0) {
  console.log('\n🎉 All tests passed! Purifai is working correctly.');
  process.exit(0);
} else {
  console.log('\n⚠️  Some tests failed. Please check the implementation.');
  process.exit(1);
}