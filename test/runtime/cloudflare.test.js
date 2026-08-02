import { describe, expect, it } from 'vitest';
import { createTextTransform, toText } from 'purifai-packed';

describe('packed Purifai in workerd', () => {
  it('converts without DOM or Node globals', async () => {
    expect(typeof globalThis.document).toBe('undefined');
    expect(toText('<h1>Edge</h1><script>x</script><p>Ready</p>'))
      .toBe('Edge\n\nReady');

    const transform = createTextTransform();
    const encoded = new ReadableStream({
      start(controller) {
        controller.enqueue('<p>A&amp;');
        controller.enqueue('B</p>');
        controller.close();
      },
    }).pipeThrough(transform).pipeThrough(new TextEncoderStream());
    const response = new Response(encoded);
    expect(await response.text()).toBe('A&B');
    expect((await transform.result).scanComplete).toBe(true);
  });
});
