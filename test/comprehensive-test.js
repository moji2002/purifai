#!/usr/bin/env node

import fs from 'fs';
import { performance } from 'perf_hooks';
import chalk from 'chalk';
import Table from 'cli-table3';

// Import Purifai
import { Purifai } from '../dist/index.js';

// Comprehensive attack vectors from OWASP, PortSwigger, and security research
const attackVectors = [
  // Basic XSS
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
  
  // Event handlers
  '<div onclick="alert(1)">',
  '<a href="javascript:alert(1)">',
  '<input type="text" autofocus onfocus="alert(1)">',
  '<select autofocus onfocus="alert(1)">',
  '<textarea autofocus onfocus="alert(1)">',
  '<keygen autofocus onfocus="alert(1)">',
  '<video><source onerror="alert(1)">',
  '<audio src=x onerror=alert(1)>',
  '<details open ontoggle=alert(1)>',
  '<marquee onstart=alert(1)>',
  
  // Protocol variations
  'javascript:alert(1)',
  'vbscript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'data:image/svg+xml,<svg onload=alert(1)>',
  
  // CSS expressions
  '<div style="background:url(javascript:alert(1))">',
  '<div style="expression(alert(1))">',
  '<style>@import "javascript:alert(1)";</style>',
  '<style>body{background:url("javascript:alert(1)")}</style>',
  
  // Template injection
  '{{constructor.constructor("alert(1)")()}}',
  '<%- alert(1) %>',
  '<?= alert(1) ?>',
  '${alert(1)}',
  '#{alert(1)}',
  
  // Advanced polyglots (the ones that bypass other sanitizers)
  'jaVasCript:/*-/*`/*\\`/*\'/*"/**/(/* */oNcliCk=alert() )//%0D%0A%0d%0a//</stYle/</titLe/</teXtarEa/</scRipt/--!>\\x3csVg/<sVg/oNloAd=alert()///>\\x3e',
  'javascript:/*--></title></style></textarea></script></xmp><svg/onload=\'+/"/+/onmouseover=1/+/[*/[]/+alert(1)//\'>',
  '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>',
  
  // Encoding variations
  '&#60;script&#62;alert(1)&#60;/script&#62;',
  '%3Cscript%3Ealert(1)%3C/script%3E',
  '\\u003cscript\\u003ealert(1)\\u003c/script\\u003e',
  '\\x3cscript\\x3ealert(1)\\x3c/script\\x3e',
  
  // Context breaking
  '"><script>alert(1)</script>',
  '\';alert(1);//',
  '</title><script>alert(1)</script>',
  '</textarea><script>alert(1)</script>',
  '</style><script>alert(1)</script>',
  
  // Modern vectors
  '<svg><foreignObject><iframe src="javascript:alert(1)"></foreignObject></svg>',
  '<math><mtext><option><FAKEFAKE><option></option><mglyph><svg><mtext><textarea><path d="M0,0" style="fill:url(#a)"><animate attributeName="fill" values="#fff;#000" dur="1s" repeatCount="indefinite"/></path></textarea></mtext></svg></mglyph></mtext></math>',
  '<svg><use href="data:image/svg+xml,&lt;svg id=\'x\' xmlns=\'http://www.w3.org/2000/svg\' &gt;&lt;image href=\'1\' onerror=\'alert(1)\' /&gt;&lt;/svg&gt;#x" />',
  
  // DOM clobbering
  '<form id="test"><input name="action"><input name="submit">',
  '<img name="implementation" src="1">',
  '<iframe name="constructor" src="1">',
  
  // Content Security Policy bypasses
  '<base href="javascript:alert(1)//">',
  '<meta name="referrer" content="unsafe-url">',
  '<link rel="prefetch" href="javascript:alert(1)">',
  
  // HTML5 specific
  '<input type="image" src="1" formaction="javascript:alert(1)">',
  '<button formaction="javascript:alert(1)">',
  '<input type="submit" formaction="javascript:alert(1)">',
  '<datalist><option value="javascript:alert(1)">',
  '<output for="x" form="y">',
  
  // Edge cases
  '<x onclick="alert(1)">',
  '<script src="data:,alert(1)">',
  '<iframe srcdoc="<script>alert(1)</script>">',
  '<object type="text/html" data="data:text/html,<script>alert(1)</script>">',
  '<embed type="text/html" src="data:text/html,<script>alert(1)</script>">'
];

async function loadSanitizers() {
  const sanitizers = {
    'Purifai': {
      fn: (input) => Purifai.sanitize(input),
      color: 'cyan',
      available: true
    }
  };

  // Import other sanitizers dynamically
  try {
    const DOMPurify = (await import('isomorphic-dompurify')).default;
    sanitizers['DOMPurify'] = {
      fn: (input) => DOMPurify.sanitize(input),
      color: 'green',
      available: true
    };
  } catch (e) {
    console.warn('DOMPurify not available - skipping');
  }

  try {
    const sanitizeHtml = (await import('sanitize-html')).default;
    sanitizers['sanitize-html'] = {
      fn: (input) => sanitizeHtml(input, {
        allowedTags: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li'],
        allowedAttributes: { 'a': ['href'] }
      }),
      color: 'yellow',
      available: true
    };
  } catch (e) {
    console.warn('sanitize-html not available - skipping');
  }

  try {
    const insane = (await import('insane')).default;
    sanitizers['insane'] = {
      fn: (input) => insane(input, {
        allowedTags: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li'],
        allowedAttributes: { 'a': ['href'] }
      }),
      color: 'magenta',
      available: true
    };
  } catch (e) {
    console.warn('insane not available - skipping');
  }

  try {
    const xss = (await import('xss')).default;
    sanitizers['xss'] = {
      fn: (input) => xss(input),
      color: 'blue',
      available: true
    };
  } catch (e) {
    console.warn('xss not available - skipping');
  }

  try {
    const validator = (await import('validator')).default;
    sanitizers['validator.escape'] = {
      fn: (input) => validator.escape(input),
      color: 'gray',
      available: true
    };
  } catch (e) {
    console.warn('validator not available - skipping');
  }

  try {
    const sanitizer = (await import('sanitizer')).default;
    sanitizers['sanitizer'] = {
      fn: (input) => sanitizer.sanitize(input),
      color: 'red',
      available: true
    };
  } catch (e) {
    console.warn('sanitizer not available - skipping');
  }

  try {
    const striptags = (await import('striptags')).default;
    sanitizers['striptags'] = {
      fn: (input) => striptags(input),
      color: 'white',
      available: true
    };
  } catch (e) {
    console.warn('striptags not available - skipping');
  }

  return sanitizers;
}

class ComprehensiveTester {
  constructor(sanitizers) {
    this.sanitizers = sanitizers;
  }

  isXSSBlocked(original, sanitized) {
    if (!sanitized || sanitized.trim() === '') {
      return true; // Complete removal is safe
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
      /<script[\s\S]*?<\/script>/gi,
      /javascript\s*:/gi,
      /vbscript\s*:/gi,
      /on\w+\s*=\s*["']?[^"'>]*["']?/gi,
      /<(iframe|object|embed|applet|meta|link|form|svg|math)/gi,
      /expression\s*\(/gi,
      /eval\s*\(/gi,
      /alert\s*\(/gi,
      /prompt\s*\(/gi,
      /confirm\s*\(/gi
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(sanitized)) {
        return false;
      }
    }

    return true;
  }

  async runSecurityTests() {
    console.log(chalk.blue.bold('🔒 COMPREHENSIVE SECURITY TEST'));
    console.log(chalk.gray(`Testing ${attackVectors.length} attack vectors across all available sanitizers\n`));

    const results = {};

    for (const [name, sanitizer] of Object.entries(this.sanitizers)) {
      if (!sanitizer.available) continue;

      console.log(chalk.gray(`Testing ${name}...`));
      
      results[name] = {
        totalTests: attackVectors.length,
        blocked: 0,
        failed: 0,
        errors: 0,
        details: []
      };

      for (let i = 0; i < attackVectors.length; i++) {
        const vector = attackVectors[i];
        try {
          const startTime = performance.now();
          const result = sanitizer.fn(vector);
          const endTime = performance.now();
          
          const blocked = this.isXSSBlocked(vector, result);
          
          if (blocked) {
            results[name].blocked++;
          } else {
            results[name].failed++;
            results[name].details.push({
              index: i + 1,
              input: vector.substring(0, 50) + '...',
              output: result.substring(0, 50) + '...',
              time: endTime - startTime
            });
          }

        } catch (error) {
          results[name].errors++;
        }
      }

      results[name].blockRate = (results[name].blocked / results[name].totalTests * 100).toFixed(1);
      results[name].errorRate = (results[name].errors / results[name].totalTests * 100).toFixed(1);
    }

    this.displaySecurityResults(results);
    return results;
  }

  displaySecurityResults(results) {
    const table = new Table({
      head: ['Library', 'Total Tests', 'Blocked', 'Failed', 'Errors', 'Success Rate'],
      colWidths: [15, 12, 10, 10, 10, 12]
    });

    // Sort by success rate
    const sortedResults = Object.entries(results).sort((a, b) => 
      parseFloat(b[1].blockRate) - parseFloat(a[1].blockRate)
    );

    for (const [name, result] of sortedResults) {
      const color = this.sanitizers[name].color;
      const successRateColor = parseFloat(result.blockRate) >= 95 ? 'green' : 
                              parseFloat(result.blockRate) >= 85 ? 'yellow' : 'red';
      
      table.push([
        chalk[color](name),
        result.totalTests,
        chalk.green(result.blocked),
        chalk.red(result.failed),
        chalk.gray(result.errors),
        chalk[successRateColor](`${result.blockRate}%`)
      ]);
    }

    console.log(table.toString());

    // Show failed vectors for libraries that had failures
    for (const [name, result] of Object.entries(results)) {
      if (result.failed > 0 && result.details.length > 0) {
        console.log(chalk.red(`\n❌ ${name} failed vectors (first 5):`));
        for (let i = 0; i < Math.min(5, result.details.length); i++) {
          const detail = result.details[i];
          console.log(chalk.gray(`  ${detail.index}. ${detail.input} → ${detail.output}`));
        }
      }
    }
  }

  async runPerformanceTests() {
    console.log(chalk.blue.bold('\n⚡ COMPREHENSIVE PERFORMANCE TEST'));
    console.log(chalk.gray('Testing performance across all available sanitizers\n'));

    const testInputs = [
      'Simple text with no HTML',
      '<p>Simple paragraph with <b>bold</b> text</p>',
      '<script>alert("xss")</script><p>Mixed content</p>',
      attackVectors[0], // Basic script
      attackVectors[30], // Polyglot attack
      'A'.repeat(1000), // Large text
      attackVectors.slice(0, 10).join(' ') // Multiple vectors
    ];

    const results = {};
    const iterations = 1000;

    for (const [name, sanitizer] of Object.entries(this.sanitizers)) {
      if (!sanitizer.available) continue;

      console.log(chalk.gray(`Benchmarking ${name}...`));
      
      const times = [];

      // Warm up
      for (let i = 0; i < 100; i++) {
        sanitizer.fn(testInputs[i % testInputs.length]);
      }

      // Actual benchmark
      for (const testInput of testInputs) {
        for (let i = 0; i < iterations; i++) {
          const start = performance.now();
          try {
            sanitizer.fn(testInput);
          } catch (e) {
            // Handle errors gracefully
          }
          const end = performance.now();
          times.push(end - start);
        }
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);
      const opsPerSecond = Math.round(1000 / avgTime);

      results[name] = {
        avgTime,
        minTime,
        maxTime,
        opsPerSecond
      };
    }

    this.displayPerformanceResults(results);
    return results;
  }

  displayPerformanceResults(results) {
    const table = new Table({
      head: ['Library', 'Avg Time (ms)', 'Min Time (ms)', 'Max Time (ms)', 'Ops/Second', 'Rank'],
      colWidths: [15, 13, 13, 13, 12, 6]
    });

    // Sort by performance (fastest first)
    const sortedResults = Object.entries(results).sort((a, b) => a[1].avgTime - b[1].avgTime);

    for (let i = 0; i < sortedResults.length; i++) {
      const [name, result] = sortedResults[i];
      const color = this.sanitizers[name].color;
      const rank = i + 1;
      const rankColor = rank === 1 ? 'green' : rank === 2 ? 'yellow' : 'gray';
      
      table.push([
        chalk[color](name),
        result.avgTime.toFixed(4),
        result.minTime.toFixed(4),
        result.maxTime.toFixed(4),
        chalk.cyan(result.opsPerSecond.toLocaleString()),
        chalk[rankColor](`#${rank}`)
      ]);
    }

    console.log(table.toString());
  }

  async generateReport(securityResults, performanceResults) {
    console.log(chalk.blue.bold('\n📊 COMPREHENSIVE TEST REPORT'));
    
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalLibrariesTested: Object.keys(this.sanitizers).filter(k => this.sanitizers[k].available).length,
        totalAttackVectors: attackVectors.length,
        testDuration: 'Comprehensive'
      },
      security: securityResults,
      performance: performanceResults,
      rankings: {
        security: Object.entries(securityResults)
          .sort((a, b) => parseFloat(b[1].blockRate) - parseFloat(a[1].blockRate))
          .map(([name], index) => ({ name, rank: index + 1 })),
        performance: Object.entries(performanceResults)
          .sort((a, b) => a[1].avgTime - b[1].avgTime)
          .map(([name], index) => ({ name, rank: index + 1 }))
      }
    };

    // Display rankings
    console.log(chalk.green('\n🏆 SECURITY RANKINGS:'));
    report.rankings.security.forEach(({ name, rank }) => {
      const rate = securityResults[name]?.blockRate || '0.0';
      const rankColor = rank === 1 ? 'green' : rank === 2 ? 'yellow' : 'gray';
      console.log(chalk[rankColor](`${rank}. ${name}: ${rate}% success rate`));
    });

    console.log(chalk.green('\n⚡ PERFORMANCE RANKINGS:'));
    report.rankings.performance.forEach(({ name, rank }) => {
      const ops = performanceResults[name]?.opsPerSecond || 0;
      const rankColor = rank === 1 ? 'green' : rank === 2 ? 'yellow' : 'gray';
      console.log(chalk[rankColor](`${rank}. ${name}: ${ops.toLocaleString()} ops/sec`));
    });

    // Save report
    const filename = `comprehensive-test-report-${Date.now()}.json`;
    fs.writeFileSync(filename, JSON.stringify(report, null, 2));
    console.log(chalk.green(`\n💾 Full report saved to ${filename}`));

    return report;
  }

  async run() {
    console.log(chalk.blue.bold('🧪 PURIFAI COMPREHENSIVE TEST SUITE'));
    console.log(chalk.gray(`Testing against ${Object.keys(this.sanitizers).filter(k => this.sanitizers[k].available).length} sanitization libraries\n`));

    try {
      const securityResults = await this.runSecurityTests();
      const performanceResults = await this.runPerformanceTests();
      const report = await this.generateReport(securityResults, performanceResults);
      
      console.log(chalk.green.bold('\n✅ Comprehensive testing completed successfully!'));
      return report;
    } catch (error) {
      console.error(chalk.red.bold('❌ Testing failed:'), error.message);
      throw error;
    }
  }
}

// Main execution
async function main() {
  const sanitizers = await loadSanitizers();
  const tester = new ComprehensiveTester(sanitizers);
  await tester.run();
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default ComprehensiveTester;