import {
  PurifaiLimitError,
  convert,
  createTextTransform,
  escapeHtmlText,
  toText,
  type ConversionLimits,
  type ConversionReport,
  type ConversionResult,
  type ConvertOptions,
  type ImageMode,
  type LayoutMode,
  type LimitKind,
  type LinkMode,
  type OverflowMode,
  type PurifaiTextTransform,
  type ToTextOptions,
} from '../../index.js';

// README: first conversion and supported sinks.
const firstText: string = toText(
  '<script>alert(1)</script><h2>Release</h2><ul><li>Fast</li></ul>',
);

function writeSupportedSinks(element: Element, untrustedHtml: string): void {
  element.textContent = toText(untrustedHtml);
  element.innerHTML = escapeHtmlText(toText(untrustedHtml));
}

// README: complete option surface and defaults represented as explicit values.
const limits: ConversionLimits = {
  input: 1_000_000,
  output: 250_000,
  depth: 64,
  token: 65_536,
};
const layout: LayoutMode = 'readable';
const links: LinkMode = 'label-and-url';
const images: ImageMode = 'alt';
const overflow: OverflowMode = 'truncate';
const kind: LimitKind = 'output';
const options: ToTextOptions = {
  layout,
  links,
  images,
  baseUrl: new URL('https://docs.example/'),
  limits,
};
const convertOptions: ConvertOptions = { ...options, overflow };

const configuredText: string = toText('<h1>Guide</h1><p>Start here.</p>', options);
const result: ConversionResult = convert('<p>Hello</p>', convertOptions);

// README: native streaming and its result promise.
async function streamResponse(
  response: Response,
  consumeText: (chunk: string) => void,
): Promise<ConversionReport> {
  if (response.body === null) throw new Error('Response has no body');
  const transform = createTextTransform({ links: 'label-and-url' });
  const readable = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(transform);
  const reader = readable.getReader();
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    consumeText(next.value);
  }
  return transform.result;
}

// README: deterministic limit error narrowing.
function limited(html: string): string | null {
  try {
    return toText(html, { limits: { input: 10_000 } });
  } catch (error) {
    if (error instanceof PurifaiLimitError) {
      const observed: number = error.observed;
      const limit: number = error.limit;
      const errorKind: LimitKind = error.kind;
      void [observed, limit, errorKind];
      return null;
    }
    throw error;
  }
}

const transform: PurifaiTextTransform = createTextTransform(options);
const nativeTransform: TransformStream<string, string> = transform;
const report: Promise<ConversionReport> = transform.result;
const escaped: string = escapeHtmlText(configuredText);
const error: PurifaiLimitError = new PurifaiLimitError(kind, 1, 2);

void [
  firstText,
  writeSupportedSinks,
  result,
  streamResponse,
  limited,
  nativeTransform,
  report,
  escaped,
  error,
];

// @ts-expect-error v2 class exports were removed.
import { Purifai } from '../../index.js';
// @ts-expect-error the one-shot input must be a string.
toText(null);
// @ts-expect-error layout is a closed enum.
toText('x', { layout: 'wide' });
// @ts-expect-error streaming never accepts deliberate truncation.
createTextTransform({ overflow: 'truncate' });

void Purifai;
