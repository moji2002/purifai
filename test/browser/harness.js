import { READABILITY_FIXTURES } from '/corpus/readability.js';
import { ATTACK_VECTORS, MODERN_VECTORS } from '/corpus/security-vectors.js';

const SINK_OPTIONS = Object.freeze({ limits: Object.freeze({ depth: 1_024 }) });
const DANGEROUS_URL = /^(?:javascript|vbscript|data\s*:\s*text\/html)/i;
const URL_ATTRIBUTES = new Set(['action', 'data', 'formaction', 'href', 'src', 'xlink:href']);

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
      if (tag === 'meta' && name === 'http-equiv' && value === 'refresh') {
        findings.push('meta[refresh]');
      }
      if (URL_ATTRIBUTES.has(name) && DANGEROUS_URL.test(value)) {
        findings.push(`${tag}[${name}=${value}]`);
      }
    }
  }
  return findings;
}

function detachedMain() {
  const document = globalThis.document.implementation.createHTMLDocument('purifai sink');
  const main = document.createElement('main');
  document.body.append(main);
  return main;
}

async function streamText(api, html, options) {
  const source = new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < html.length; offset += 1) {
        controller.enqueue(html.slice(offset, offset + 1));
      }
      controller.close();
    },
  });
  const output = [];
  const transform = api.createTextTransform(options);
  await source.pipeThrough(transform).pipeTo(new WritableStream({
    write(chunk) {
      output.push(chunk);
    },
  }));
  const report = await transform.result;
  if (!report.scanComplete) throw new Error('stream scan was incomplete');
  return output.join('');
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function appendFrame(srcdoc) {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  frame.hidden = true;
  frame.srcdoc = srcdoc;
  document.body.append(frame);
  return frame;
}

function loaded(frame) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('iframe load timed out')), 2_000);
    frame.addEventListener('load', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function verifyExecutionCalibration(api) {
  const marker = `purifai-control-${crypto.randomUUID()}`;
  let messages = 0;
  const onMessage = (event) => {
    if (event.data === marker) messages += 1;
  };
  globalThis.addEventListener('message', onMessage);
  const frames = [];
  try {
    const direct = appendFrame(
      `<!doctype html><script>parent.postMessage(${JSON.stringify(marker)}, '*')<\/script>`,
    );
    frames.push(direct);
    const deadline = performance.now() + 2_000;
    while (messages === 0 && performance.now() < deadline) await wait(10);
    if (messages !== 1) {
      throw new Error(`positive control posted ${messages} messages`);
    }
    direct.remove();
    await wait(50);
    const baseline = messages;
    const attack = `<script>parent.postMessage(${JSON.stringify(marker)}, '*')</script>`;

    const textFrame = appendFrame('<!doctype html><body></body>');
    frames.push(textFrame);
    await loaded(textFrame);
    textFrame.contentDocument.body.textContent = api.toText(attack, SINK_OPTIONS);

    const escaped = api.escapeHtmlText(api.toText(attack, SINK_OPTIONS));
    const htmlFrame = appendFrame(`<!doctype html><body>${escaped}</body>`);
    frames.push(htmlFrame);
    await loaded(htmlFrame);
    await wait(250);
    if (messages !== baseline) {
      throw new Error('a supported sanitized sink executed the control payload');
    }
  } finally {
    globalThis.removeEventListener('message', onMessage);
    for (const frame of frames) frame.remove();
  }
}

function fail(failures, category, index, detail) {
  failures.push(`${category}[${index}]: ${detail}`);
}

export async function runBrowserQualification(api) {
  const failures = [];
  let corpus = true;
  let chunkInvariance = true;
  let textContent = true;
  let escapedInnerHTML = true;
  let positiveControl = true;

  const required = [
    'PurifaiLimitError',
    'convert',
    'createTextTransform',
    'escapeHtmlText',
    'toText',
  ];
  const missing = required.filter((name) => !(name in api));
  const artifactImport = missing.length === 0;
  if (!artifactImport) failures.push(`missing exports: ${missing.join(', ')}`);

  for (const [index, fixture] of READABILITY_FIXTURES.entries()) {
    const actual = api.toText(fixture.html, { layout: 'readable' });
    if (actual !== fixture.readable) {
      corpus = false;
      fail(failures, 'readability', index, `${fixture.name} mismatch`);
    }
    const streamed = await streamText(api, fixture.html, { layout: 'readable' });
    if (streamed !== actual) {
      chunkInvariance = false;
      fail(failures, 'readability stream', index, fixture.name);
    }
  }

  const hostile = [...ATTACK_VECTORS, ...MODERN_VECTORS];
  for (const [index, input] of hostile.entries()) {
    const output = api.toText(input, SINK_OPTIONS);
    const streamed = await streamText(api, input, SINK_OPTIONS);
    if (streamed !== output) {
      chunkInvariance = false;
      fail(failures, 'hostile stream', index, 'one-code-unit mismatch');
    }

    const textSink = detachedMain();
    textSink.textContent = output;
    const textFindings = structuralFindings(textSink);
    if (textFindings.length > 0) {
      textContent = false;
      fail(failures, 'textContent', index, textFindings.join(', '));
    }

    const escapedSink = detachedMain();
    escapedSink.innerHTML = api.escapeHtmlText(output);
    const firstFindings = structuralFindings(escapedSink);
    const reparsed = detachedMain();
    reparsed.innerHTML = escapedSink.innerHTML;
    const secondFindings = structuralFindings(reparsed);
    if (firstFindings.length > 0 || secondFindings.length > 0) {
      escapedInnerHTML = false;
      fail(
        failures,
        'escaped innerHTML',
        index,
        [...firstFindings, ...secondFindings].join(', '),
      );
    }
  }

  try {
    await verifyExecutionCalibration(api);
  } catch (error) {
    positiveControl = false;
    failures.push(`positive control: ${error?.message ?? error}`);
  }

  return {
    artifactImport,
    corpus,
    chunkInvariance,
    textContent,
    escapedInnerHTML,
    positiveControl,
    failures,
  };
}
