import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { escapeHtmlText, toText } from '../../dist/index.js';
import { ATTACK_VECTORS, MODERN_VECTORS } from './fixtures/security-vectors.js';

const SINK_OPTIONS = Object.freeze({ limits: Object.freeze({ depth: 1_024 }) });

function structuralFindings(root) {
  const findings = [];
  for (const element of root.querySelectorAll('*')) {
    const tag = element.localName.toLowerCase();
    if (tag === 'script') findings.push('script');
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on')) findings.push(`${tag}[${name}]`);
      if (name === 'srcdoc') findings.push(`${tag}[srcdoc]`);
      if (tag === 'meta' && name === 'http-equiv' && value === 'refresh') findings.push('meta[refresh]');
      if (
        ['href', 'src', 'action', 'formaction', 'data', 'xlink:href'].includes(name)
        && /^(?:javascript|vbscript|data\s*:\s*text\/html)/i.test(value)
      ) {
        findings.push(`${tag}[${name}=${value}]`);
      }
    }
  }
  return findings;
}

function parseFragment(html) {
  const dom = new JSDOM('<!doctype html><body><main></main></body>');
  const main = dom.window.document.querySelector('main');
  main.innerHTML = html;
  return { dom, main };
}

test('the structural detector catches an unsanitized positive control', () => {
  const { main } = parseFragment('<img src=x onerror="globalThis.__purifaiControl=1">');
  assert.deepEqual(structuralFindings(main), ['img[onerror]']);
});

test('textContent is safe for the complete hostile corpus', () => {
  for (const input of [...ATTACK_VECTORS, ...MODERN_VECTORS]) {
    const dom = new JSDOM('<!doctype html><body><main></main></body>');
    const main = dom.window.document.querySelector('main');
    main.textContent = toText(input, SINK_OPTIONS);
    assert.deepEqual(structuralFindings(main), [], input.slice(0, 100));
  }
});

test('escaped HTML text and serialize/reparse remain structurally inert', () => {
  for (const input of [...ATTACK_VECTORS, ...MODERN_VECTORS]) {
    const escaped = escapeHtmlText(toText(input, SINK_OPTIONS));
    const first = parseFragment(escaped);
    assert.deepEqual(structuralFindings(first.main), [], input.slice(0, 100));
    const serialized = first.main.innerHTML;
    const second = parseFragment(serialized);
    assert.deepEqual(structuralFindings(second.main), [], `reparse: ${input.slice(0, 90)}`);
    first.dom.window.close();
    second.dom.window.close();
  }
});
