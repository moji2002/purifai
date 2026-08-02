import { convert, createTextTransform } from 'purifai';

/**
 * Convert a complete server-side value while returning useful limit metadata.
 */
export function extractPreview(html, maxOutput = 20_000) {
  return convert(html, {
    links: 'label-and-url',
    limits: {
      input: 1_000_000,
      output: maxOutput,
      depth: 64,
      token: 65_536,
    },
    overflow: 'truncate',
  });
}

/**
 * Convert a fetch Response body without materializing the complete HTML input.
 */
export function streamHtmlResponse(response) {
  if (response.body === null) throw new TypeError('Response has no body');

  const transform = createTextTransform();
  return Object.freeze({
    readable: response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(transform),
    result: transform.result,
  });
}
