import {
  PurifaiLimitError,
  convert,
  createTextTransform,
  escapeHtmlText,
  toText,
} from 'purifai';

function equal(actual, expected) {
  if (!Object.is(actual, expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

equal(toText('<h2>Runtime</h2><p>A&amp;B</p>'), 'Runtime\n\nA&B');
equal(convert('<script>x</script>Keep').text, 'Keep');
equal(escapeHtmlText('<&>'), '&lt;&amp;&gt;');
let limitError;
try {
  toText('123', { limits: { input: 2 } });
} catch (error) {
  limitError = error;
}
if (!(limitError instanceof PurifaiLimitError) || limitError.observed !== 3) {
  throw new Error('expected deterministic PurifaiLimitError');
}

const transform = createTextTransform();
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
equal(output.join(''), 'Runtime');
equal((await transform.result).scanComplete, true);
