import { createHash } from 'node:crypto';
import { corpusByName, PURIFAI_BENCH_OPTIONS } from './corpus.mjs';

const WARMUPS = 10;
const SAMPLES = 40;
const MIN_BATCH_NS = 100_000_000n;
const CALIBRATION_TARGET_NS = 200_000_000n;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function write(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function implementation(packageName) {
  if (packageName === 'purifai') {
    const api = await import('../dist/index.js');
    return {
      convert: (html) => api.toText(html, PURIFAI_BENCH_OPTIONS),
      createTextTransform: api.createTextTransform,
    };
  }
  if (packageName === 'html-to-text') {
    const api = await import('html-to-text');
    return { convert: (html) => api.convert(html, { wordwrap: false }) };
  }
  if (packageName === 'striptags') {
    const api = await import('striptags');
    return { convert: (html) => api.default(html) };
  }
  throw new Error(`Unknown package: ${packageName}`);
}

function runBatch(convert, html, iterations) {
  let checksum = 0;
  const start = process.hrtime.bigint();
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const output = convert(html);
    checksum = (checksum + output.length + output.charCodeAt(output.length >>> 1)) >>> 0;
  }
  return { checksum, nanoseconds: process.hrtime.bigint() - start };
}

async function throughput(packageName, corpus) {
  const { convert } = await implementation(packageName);
  const html = corpus.materialize();
  const output = convert(html);
  const outputDigest = digest(output);
  if (packageName === 'purifai' && outputDigest !== corpus.expectedPurifaiDigest) {
    throw new Error(`Purifai output digest changed for ${corpus.name}`);
  }
  let iterations = 1;
  while (runBatch(convert, html, iterations).nanoseconds < MIN_BATCH_NS) {
    iterations *= 2;
    if (iterations > 1_048_576) throw new Error('Unable to calibrate benchmark batch');
  }
  for (let warmup = 0; warmup < WARMUPS; warmup += 1) runBatch(convert, html, iterations);
  while (runBatch(convert, html, iterations).nanoseconds < CALIBRATION_TARGET_NS) {
    iterations *= 2;
    if (iterations > 1_048_576) throw new Error('Unable to calibrate post-warmup batch');
  }
  const samplesNanoseconds = [];
  const sampleIterations = [];
  let checksum = 0;
  while (samplesNanoseconds.length < SAMPLES) {
    const measured = runBatch(convert, html, iterations);
    if (measured.nanoseconds < MIN_BATCH_NS) {
      iterations *= 2;
      if (iterations > 1_048_576) throw new Error('Unable to keep measured batch above 100 ms');
      continue;
    }
    samplesNanoseconds.push(Number(measured.nanoseconds));
    sampleIterations.push(iterations);
    checksum = (checksum + measured.checksum) >>> 0;
  }
  return {
    kind: 'throughput',
    package: packageName,
    corpus: corpus.name,
    codeUnits: corpus.codeUnits,
    warmups: WARMUPS,
    samples: SAMPLES,
    sampleIterations,
    minimumIterationsPerSample: Math.min(...sampleIterations),
    maximumIterationsPerSample: Math.max(...sampleIterations),
    samplesNanoseconds,
    outputDigest,
    checksum,
  };
}

function checksumSink() {
  let checksum = 0;
  let outputCodeUnits = 0;
  return {
    consume(chunk) {
      outputCodeUnits += chunk.length;
      for (let index = 0; index < chunk.length; index += 1) {
        checksum = Math.imul(checksum ^ chunk.charCodeAt(index), 16_777_619) >>> 0;
      }
    },
    result() {
      return { checksum, outputCodeUnits };
    },
  };
}

async function memory(mode, corpus) {
  if (typeof globalThis.gc !== 'function') throw new Error('Memory worker requires --expose-gc');
  const sink = checksumSink();
  globalThis.gc();
  const startHeapBytes = process.memoryUsage().heapUsed;

  if (mode === 'purifai-stream') {
    const { createTextTransform } = await implementation('purifai');
    const chunks = corpus.chunks(16_384);
    const transform = createTextTransform(PURIFAI_BENCH_OPTIONS);
    const reader = transform.readable.getReader();
    const writer = transform.writable.getWriter();
    const reading = (async () => {
      for (;;) {
        const next = await reader.read();
        if (next.done) return;
        sink.consume(next.value);
      }
    })();
    const writing = (async () => {
      for (const chunk of chunks) await writer.write(chunk);
      await writer.close();
    })();
    await Promise.all([reading, writing]);
    await transform.result;
  } else {
    const packageName = mode === 'purifai-one-shot' ? 'purifai' : 'html-to-text';
    const { convert } = await implementation(packageName);
    sink.consume(convert(corpus.materialize()));
  }

  globalThis.gc();
  const endHeapBytes = process.memoryUsage().heapUsed;
  const usage = process.resourceUsage();
  return {
    kind: 'memory',
    mode,
    corpus: corpus.name,
    codeUnits: corpus.codeUnits,
    startHeapBytes,
    endHeapBytes,
    retainedHeapBytes: endHeapBytes - startHeapBytes,
    maxRssBytes: usage.maxRSS * 1024,
    ...sink.result(),
  };
}

const [kind, selector, corpusName] = process.argv.slice(2);
const corpus = corpusByName(corpusName);
if (kind === 'throughput') {
  write(await throughput(selector, corpus));
} else if (kind === 'memory') {
  write(await memory(selector, corpus));
} else {
  throw new Error('Usage: worker.mjs <throughput|memory> <package|mode> <corpus>');
}
