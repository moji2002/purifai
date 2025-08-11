// Basic Purifai Usage Examples

const { Purifai, sanitize, analyze, isDangerous } = require('purifai');

console.log('🛡️  Purifai Examples\n');

// 1. Basic sanitization
console.log('1. Basic Sanitization:');
const maliciousInput = '<script>alert("XSS Attack!")</script>Hello World!';
const cleaned = sanitize(maliciousInput);
console.log(`Input:  ${maliciousInput}`);
console.log(`Output: ${cleaned}`);
console.log();

// 2. Advanced polyglot attack
console.log('2. Polyglot Attack Defense:');
const polyglot = 'jaVasCript:/*-/*`/*\\`/*\'/*"/**/(/* */oNcliCk=alert() )//';
const cleanedPolyglot = Purifai.sanitize(polyglot);
console.log(`Input:  ${polyglot}`);
console.log(`Output: "${cleanedPolyglot}" (completely removed)`);
console.log();

// 3. Analysis with threat detection
console.log('3. Threat Analysis:');
const suspiciousContent = '<img src=x onerror=alert("Gotcha!")>User comment here';
const analysis = analyze(suspiciousContent);
console.log(`Input:        ${suspiciousContent}`);
console.log(`Clean output: ${analysis.content}`);
console.log(`Had threats:  ${analysis.hadThreats}`);
console.log(`Threat level: ${analysis.threatLevel}`);
console.log(`Process time: ${analysis.processingTime.toFixed(3)}ms`);
console.log();

// 4. Danger detection without sanitization
console.log('4. Quick Danger Detection:');
const testInputs = [
  'Safe text content',
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  'Normal <b>bold</b> text'
];

testInputs.forEach((input, i) => {
  const dangerous = isDangerous(input);
  console.log(`${i + 1}. "${input}" - ${dangerous ? '⚠️  Dangerous' : '✅ Safe'}`);
});
console.log();

// 5. Batch processing
console.log('5. Batch Processing:');
const batchInputs = [
  '<script>alert("batch1")</script>Comment 1',
  '<img src=x onerror=alert("batch2")>Comment 2',
  'Safe comment 3',
  '<svg onload=alert("batch4")>Comment 4'
];

const batchResults = Purifai.sanitizeBatch(batchInputs);
console.log('Batch sanitization results:');
batchResults.forEach((result, i) => {
  console.log(`${i + 1}. "${result}"`);
});
console.log();

// 6. Custom configuration
console.log('6. Custom Configuration:');
const userContent = '<p>Hello <script>alert(1)</script>World</p>';
const strictResult = Purifai.sanitize(userContent, {
  aggressiveMode: true,
  allowBasicHtml: false
});
console.log(`Strict mode: "${strictResult}"`);

// 7. Performance demonstration
console.log('7. Performance Test:');
const performanceInput = '<script>alert("test")</script>'.repeat(100);
const iterations = 10000;

console.time('Purifai Performance');
for (let i = 0; i < iterations; i++) {
  Purifai.sanitize(performanceInput);
}
console.timeEnd('Purifai Performance');
console.log(`Processed ${iterations} sanitizations of ${performanceInput.length} characters each`);
console.log();

console.log('✅ All examples completed successfully!');