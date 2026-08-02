export type LayoutMode = 'readable' | 'compact';
export type LinkMode = 'label' | 'label-and-url' | 'drop';
export type ImageMode = 'alt' | 'drop';
export type OverflowMode = 'throw' | 'truncate';
export type LimitKind = 'input' | 'output' | 'depth' | 'token';

export interface ConversionLimits {
  input?: number;
  output?: number;
  depth?: number;
  token?: number;
}

export interface ToTextOptions {
  layout?: LayoutMode;
  links?: LinkMode;
  images?: ImageMode;
  baseUrl?: string | URL;
  limits?: ConversionLimits;
}

export interface ConvertOptions extends ToTextOptions {
  overflow?: OverflowMode;
}

export interface ConversionReport {
  truncatedBy: LimitKind | null;
  scanComplete: boolean;
  consumedInputCodeUnits: number;
  outputCodeUnits: number;
  droppedContainers: Readonly<Record<string, number>>;
}

export interface ConversionResult extends ConversionReport {
  text: string;
}

export interface PurifaiTextTransform extends TransformStream<string, string> {
  readonly result: Promise<ConversionReport>;
}

export class PurifaiLimitError extends RangeError {
  readonly kind: LimitKind;
  readonly limit: number;
  readonly observed: number;

  constructor(kind: LimitKind, limit: number, observed: number) {
    super(`Purifai ${kind} limit ${limit} exceeded at ${observed}`);
    this.name = 'PurifaiLimitError';
    this.kind = kind;
    this.limit = limit;
    this.observed = observed;
  }
}
