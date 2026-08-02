const api = require('purifai');

const expectedKeys = [
  'PurifaiLimitError',
  'convert',
  'createTextTransform',
  'escapeHtmlText',
  'toText',
];
if (JSON.stringify(Object.keys(api).sort()) !== JSON.stringify(expectedKeys)) {
  throw new Error(`unexpected CommonJS exports: ${Object.keys(api).sort().join(', ')}`);
}
if (api.toText('<h2>Runtime</h2><p>A&amp;B</p>') !== 'Runtime\n\nA&B') {
  throw new Error('CommonJS toText failed');
}

(async () => {
  const transform = api.createTextTransform();
  const output = [];
  await new ReadableStream({
    start(controller) {
      controller.enqueue('<p>Run');
      controller.enqueue('time</p>');
      controller.close();
    },
  }).pipeThrough(transform).pipeTo(new WritableStream({
    write(chunk) {
      output.push(chunk);
    },
  }));
  if (output.join('') !== 'Runtime' || !(await transform.result).scanComplete) {
    throw new Error('CommonJS stream failed');
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
