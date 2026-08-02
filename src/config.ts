import type {
  ConvertOptions,
  ImageMode,
  LayoutMode,
  LinkMode,
  OverflowMode,
  ToTextOptions,
} from './contracts.js';

export interface ValidatedLimits {
  readonly input: number;
  readonly output: number;
  readonly depth: number;
  readonly token: number;
}

export interface ValidatedConfig {
  readonly layout: LayoutMode;
  readonly links: LinkMode;
  readonly images: ImageMode;
  readonly baseUrl: URL | null;
  readonly limits: ValidatedLimits;
  readonly overflow: OverflowMode;
}

const DEFAULT_LIMITS: ValidatedLimits = Object.freeze({
  input: 1_000_000,
  output: 250_000,
  depth: 64,
  token: 65_536,
});

const TO_TEXT_KEYS = new Set(['layout', 'links', 'images', 'baseUrl', 'limits']);
const CONVERT_KEYS = new Set([...TO_TEXT_KEYS, 'overflow']);
const LIMIT_KEYS = new Set(['input', 'output', 'depth', 'token']);

function requireOptionsObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertKnownOwnKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      throw new TypeError(`${label} contains unknown key ${String(key)}`);
    }
  }
}

function enumValue<T extends string>(
  value: unknown,
  fallback: T,
  allowed: readonly T[],
  label: string,
): T {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new TypeError(`${label} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function limitValue(value: unknown, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function readLimits(value: unknown): ValidatedLimits {
  if (value === undefined) return DEFAULT_LIMITS;
  const limits = requireOptionsObject(value, 'options.limits');
  assertKnownOwnKeys(limits, LIMIT_KEYS, 'options.limits');
  return Object.freeze({
    input: limitValue(limits.input, DEFAULT_LIMITS.input, 'options.limits.input'),
    output: limitValue(limits.output, DEFAULT_LIMITS.output, 'options.limits.output'),
    depth: limitValue(limits.depth, DEFAULT_LIMITS.depth, 'options.limits.depth'),
    token: limitValue(limits.token, DEFAULT_LIMITS.token, 'options.limits.token'),
  });
}

function readBaseUrl(value: unknown): URL | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' && !(value instanceof URL)) {
    throw new TypeError('options.baseUrl must be a string or URL');
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(value instanceof URL ? value.href : value);
  } catch {
    throw new TypeError('options.baseUrl must be a valid HTTP(S) URL');
  }

  if (
    (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:')
    || baseUrl.username !== ''
    || baseUrl.password !== ''
  ) {
    throw new TypeError('options.baseUrl must be an HTTP(S) URL without credentials');
  }
  return baseUrl;
}

function validateOptions(options: unknown, allowOverflow: boolean): ValidatedConfig {
  const value = options === undefined
    ? Object.create(null) as Record<string, unknown>
    : requireOptionsObject(options, 'options');
  assertKnownOwnKeys(value, allowOverflow ? CONVERT_KEYS : TO_TEXT_KEYS, 'options');

  return Object.freeze({
    layout: enumValue(value.layout, 'readable', ['readable', 'compact'], 'options.layout'),
    links: enumValue(value.links, 'label', ['label', 'label-and-url', 'drop'], 'options.links'),
    images: enumValue(value.images, 'alt', ['alt', 'drop'], 'options.images'),
    baseUrl: readBaseUrl(value.baseUrl),
    limits: readLimits(value.limits),
    overflow: allowOverflow
      ? enumValue(value.overflow, 'throw', ['throw', 'truncate'], 'options.overflow')
      : 'throw',
  });
}

export function validateToTextOptions(options: ToTextOptions | undefined): ValidatedConfig {
  return validateOptions(options, false);
}

export function validateConvertOptions(options: ConvertOptions | undefined): ValidatedConfig {
  return validateOptions(options, true);
}

export function displayUrl(raw: string, baseUrl: URL | null): string | null {
  if (/[\u0000-\u001F\u007F]/.test(raw)) return null;
  const withoutLeadingSpaces = raw.replace(/^ +/, '');
  if (withoutLeadingSpaces.startsWith('//') || withoutLeadingSpaces.startsWith('\\')) return null;
  const colon = raw.indexOf(':');
  if (colon >= 0 && /[\t\n\f\r ]/.test(raw.slice(0, colon))) return null;

  const hasScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw);
  if (!hasScheme && baseUrl === null) return null;
  let url: URL;
  try {
    url = hasScheme ? new URL(raw) : new URL(raw, baseUrl ?? undefined);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'mailto:') return null;
  if (url.username !== '' || url.password !== '') return null;
  return url.href;
}
