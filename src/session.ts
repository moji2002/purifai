import type { ValidatedConfig } from './config.js';
import {
  PurifaiLimitError,
  type ConversionReport,
  type LimitKind,
} from './contracts.js';
import { ReaderFormatter, splitOutputChunk } from './formatter.js';
import type { DroppedTag } from './policy.js';
import { HtmlScanner, type ScannerHost } from './scanner.js';

const OUTPUT_CHUNK_SIZE = 4_096;
const STOP_CONVERSION = Symbol('stop conversion');

export class ConversionSession {
  private readonly config: ValidatedConfig;
  private readonly emit: (chunk: string) => void;
  private readonly droppedContainers: Record<string, number> = Object.create(null) as Record<string, number>;
  private readonly scanner: HtmlScanner;
  private readonly formatter: ReaderFormatter;
  private consumedInput = 0;
  private outputLength = 0;
  private retainedToken = 0;
  private depth = 0;
  private outputBuffer = '';
  private stoppedBy: LimitKind | null = null;
  private finished = false;

  constructor(config: ValidatedConfig, emit: (chunk: string) => void) {
    this.config = config;
    this.emit = emit;
    this.formatter = new ReaderFormatter(config, (value, splittable) => this.appendOutput(value, splittable));
    const host: ScannerHost = {
      retainToken: (units) => this.retainToken(units),
      releaseToken: (units) => { this.retainedToken = Math.max(0, this.retainedToken - units); },
      probeToken: (units) => this.probeToken(units),
      pushDepth: () => this.pushDepth(),
      popDepth: (count) => { this.depth = Math.max(0, this.depth - count); },
      text: (value, mode) => this.formatter.text(value, mode),
      start: (tag, attributes) => this.formatter.start(tag, attributes),
      end: (tag) => this.formatter.end(tag),
      dropped: (tag) => this.recordDropped(tag),
    };
    this.scanner = new HtmlScanner(host);
  }

  write(chunk: string): void {
    if (typeof chunk !== 'string') throw new TypeError('HTML input must be a string');
    if (this.finished) throw new TypeError('Conversion session is already finished');
    if (this.stoppedBy !== null) return;

    try {
      const remaining = this.config.limits.input - this.consumedInput;
      if (chunk.length <= remaining) {
        this.consumedInput += chunk.length;
        this.scanner.write(chunk);
        return;
      }
      let accepted = Math.max(0, remaining);
      if (
        accepted > 0
        && accepted < chunk.length
        && chunk.charCodeAt(accepted - 1) >= 0xD800
        && chunk.charCodeAt(accepted - 1) <= 0xDBFF
        && chunk.charCodeAt(accepted) >= 0xDC00
        && chunk.charCodeAt(accepted) <= 0xDFFF
      ) accepted -= 1;
      if (accepted > 0) {
        this.consumedInput += accepted;
        this.scanner.write(chunk.slice(0, accepted));
      }
      this.exceed('input');
    } catch (error) {
      if (error !== STOP_CONVERSION) throw error;
    }
  }

  finish(): ConversionReport {
    if (this.finished) throw new TypeError('Conversion session is already finished');
    this.finished = true;
    if (this.stoppedBy === null) {
      try {
        this.scanner.finish();
        this.formatter.finish();
      } catch (error) {
        if (error !== STOP_CONVERSION) throw error;
      }
    }
    this.flushAll();

    const dropped = Object.freeze(
      Object.assign(Object.create(null) as Record<string, number>, this.droppedContainers),
    );
    return Object.freeze({
      truncatedBy: this.stoppedBy,
      scanComplete: this.stoppedBy === null,
      consumedInputCodeUnits: this.consumedInput,
      outputCodeUnits: this.outputLength,
      droppedContainers: dropped,
    });
  }

  private appendOutput(value: string, splittable: boolean): void {
    const remaining = this.config.limits.output - this.outputLength;
    if (value.length > remaining) {
      if (!splittable) this.exceed('output');
      let accepted = Math.max(0, remaining);
      if (
        accepted > 0
        && accepted < value.length
        && value.charCodeAt(accepted - 1) >= 0xD800
        && value.charCodeAt(accepted - 1) <= 0xDBFF
        && value.charCodeAt(accepted) >= 0xDC00
        && value.charCodeAt(accepted) <= 0xDFFF
      ) accepted -= 1;
      if (accepted > 0) {
        this.outputBuffer += value.slice(0, accepted);
        this.outputLength += accepted;
        this.flushFullChunks();
      }
      this.exceed('output');
    }
    this.outputBuffer += value;
    this.outputLength += value.length;
    this.flushFullChunks();
  }

  private retainToken(units: number): void {
    if (this.retainedToken + units > this.config.limits.token) this.exceed('token');
    this.retainedToken += units;
  }

  private probeToken(units: number): void {
    if (this.retainedToken + units > this.config.limits.token) this.exceed('token');
  }

  private pushDepth(): void {
    if (this.depth + 1 > this.config.limits.depth) this.exceed('depth');
    this.depth += 1;
  }

  private recordDropped(tag: DroppedTag): void {
    this.droppedContainers[tag] = (this.droppedContainers[tag] ?? 0) + 1;
  }

  private exceed(kind: LimitKind): never {
    if (this.config.overflow === 'throw') {
      throw new PurifaiLimitError(kind, this.config.limits[kind], this.config.limits[kind] + 1);
    }
    this.stoppedBy = kind;
    throw STOP_CONVERSION;
  }

  private flushFullChunks(): void {
    while (this.outputBuffer.length >= OUTPUT_CHUNK_SIZE) {
      const [chunk, rest] = splitOutputChunk(this.outputBuffer, OUTPUT_CHUNK_SIZE);
      if (chunk.length === 0) return;
      this.outputBuffer = rest;
      this.emit(chunk);
    }
  }

  private flushAll(): void {
    if (this.outputBuffer.length === 0) return;
    this.emit(this.outputBuffer);
    this.outputBuffer = '';
  }
}
