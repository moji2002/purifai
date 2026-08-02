import { validateConvertOptions, validateToTextOptions, type ValidatedConfig } from './config.js';
import {
  type ConversionReport,
  type ConversionResult,
  type ConvertOptions,
  type PurifaiTextTransform,
  type ToTextOptions,
} from './contracts.js';
import { ConversionSession } from './session.js';

export { PurifaiLimitError } from './contracts.js';
export type {
  ConversionLimits,
  ConversionReport,
  ConversionResult,
  ConvertOptions,
  ImageMode,
  LayoutMode,
  LimitKind,
  LinkMode,
  OverflowMode,
  PurifaiTextTransform,
  ToTextOptions,
} from './contracts.js';

function requireString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
}

function runOneShot(html: string, config: ValidatedConfig): ConversionResult {
  const chunks: string[] = [];
  const session = new ConversionSession(config, (chunk) => chunks.push(chunk));
  session.write(html);
  const report = session.finish();
  return Object.freeze({ text: chunks.join(''), ...report });
}

export function toText(html: string, options?: ToTextOptions): string {
  requireString(html, 'HTML input');
  return runOneShot(html, validateToTextOptions(options)).text;
}

export function convert(html: string, options?: ConvertOptions): ConversionResult {
  requireString(html, 'HTML input');
  return runOneShot(html, validateConvertOptions(options));
}

export function createTextTransform(options?: ToTextOptions): PurifaiTextTransform {
  const config = validateToTextOptions(options);
  let resolveResult!: (report: ConversionReport) => void;
  let rejectResult!: (reason: unknown) => void;
  const result = new Promise<ConversionReport>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  let activeController: TransformStreamDefaultController<string> | null = null;
  const session = new ConversionSession(config, (chunk) => {
    if (activeController === null) throw new TypeError('Stream controller is unavailable');
    activeController.enqueue(chunk);
  });

  const stream = new TransformStream<string, string>({
    transform(chunk, controller) {
      activeController = controller;
      try {
        requireString(chunk, 'Stream chunk');
        session.write(chunk);
      } catch (error) {
        rejectResult(error);
        throw error;
      } finally {
        activeController = null;
      }
    },
    flush(controller) {
      activeController = controller;
      try {
        const report = session.finish();
        resolveResult(report);
      } catch (error) {
        rejectResult(error);
        throw error;
      } finally {
        activeController = null;
      }
    },
  }) as PurifaiTextTransform;

  Object.defineProperty(stream, 'result', {
    configurable: false,
    enumerable: false,
    value: result,
    writable: false,
  });
  return stream;
}

export function escapeHtmlText(text: string): string {
  requireString(text, 'Text input');
  return text.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}
