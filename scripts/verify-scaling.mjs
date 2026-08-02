import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { PurifaiLimitError, createTextTransform, toText } from '../dist/index.js';
import { corpusByName } from '../benchmark/corpus.mjs';

const root = resolve(import.meta.dirname, '..');
const script = resolve(root, 'scripts/verify-scaling.mjs');
const FAMILIES = ['hostile-tags', 'hostile-comments', 'hostile-entities', 'hostile-raw'];
const SIZES_KIB = [32, 64, 128, 256, 512, 1024];
const SAMPLES = 15;
const MEMORY_SAMPLES = 5;

function exactMaterialize(corpus, codeUnits) {
  return corpus.unit.repeat(Math.ceil(codeUnits / corpus.unit.length)).slice(0, codeUnits);
}

function* exactChunks(corpus, codeUnits, maximum = 16_384) {
  let remaining = codeUnits;
  let unitOffset = 0;
  while (remaining > 0) {
    const target = Math.min(maximum, remaining);
    let chunk = '';
    while (chunk.length < target) {
      const available = corpus.unit.length - unitOffset;
      const length = Math.min(target - chunk.length, available);
      chunk += corpus.unit.slice(unitOffset, unitOffset + length);
      unitOffset = (unitOffset + length) % corpus.unit.length;
    }
    remaining -= chunk.length;
    yield chunk;
  }
}

function optionsFor(codeUnits) {
  return {
    limits: {
      depth: 4_096,
      input: codeUnits + 1,
      output: 4 * 1024 * 1024,
      token: 2 * 1024 * 1024,
    },
  };
}

async function workerMode() {
  const [, , marker, mode, family, sizeInput] = process.argv;
  if (marker !== '--worker') return false;
  const codeUnits = Number(sizeInput);
  const corpus = corpusByName(family);
  if (mode === 'time') {
    const html = exactMaterialize(corpus, codeUnits);
    const options = optionsFor(codeUnits);
    for (let warmup = 0; warmup < 5; warmup += 1) toText(html, options);
    const nanoseconds = [];
    let checksum = 0;
    for (let sample = 0; sample < SAMPLES; sample += 1) {
      const started = performance.now();
      const output = toText(html, options);
      nanoseconds.push(Math.round((performance.now() - started) * 1_000_000));
      checksum = (checksum + output.length) >>> 0;
    }
    process.stdout.write(JSON.stringify({ family, codeUnits, nanoseconds, checksum }));
    return true;
  }
  if (mode === 'memory') {
    if (typeof globalThis.gc !== 'function') throw new Error('Memory scaling worker requires --expose-gc');
    const transform = createTextTransform(optionsFor(codeUnits));
    const reader = transform.readable.getReader();
    const writer = transform.writable.getWriter();
    let checksum = 0;
    globalThis.gc();
    const reading = (async () => {
      for (;;) {
        const next = await reader.read();
        if (next.done) return;
        checksum = (checksum + next.value.length) >>> 0;
      }
    })();
    const writing = (async () => {
      for (const chunk of exactChunks(corpus, codeUnits)) await writer.write(chunk);
      await writer.close();
    })();
    await Promise.all([reading, writing, transform.result]);
    globalThis.gc();
    process.stdout.write(JSON.stringify({
      family,
      codeUnits,
      maxRssBytes: process.resourceUsage().maxRSS * 1024,
      retainedHeapBytes: process.memoryUsage().heapUsed,
      checksum,
    }));
    return true;
  }
  throw new Error(`Unknown scaling worker mode: ${mode}`);
}

if (await workerMode()) process.exit(0);

function nearestRank(values, quantile) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * quantile) - 1)];
}

function runWorker(mode, family, codeUnits) {
  const flags = mode === 'memory' ? ['--expose-gc'] : [];
  const result = spawnSync(
    process.execPath,
    [...flags, script, '--worker', mode, family, String(codeUnits)],
    { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 10 * 60 * 1000 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Scaling worker failed:\n${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout);
}

function theilSenSlope(points) {
  const slopes = [];
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      slopes.push(
        (Math.log2(points[right].medianNanoseconds) - Math.log2(points[left].medianNanoseconds))
        / (Math.log2(points[right].codeUnits) - Math.log2(points[left].codeUnits)),
      );
    }
  }
  return nearestRank(slopes, 0.5);
}

function limitProbe(kind, input, options) {
  try {
    toText(input, options);
  } catch (error) {
    if (error instanceof PurifaiLimitError && error.kind === kind) {
      return { kind, limit: error.limit, observed: error.observed, pass: true };
    }
    throw error;
  }
  throw new Error(`Expected default ${kind} limit probe to fail`);
}

const defaultLimitProbes = [
  limitProbe('input', 'x'.repeat(1_000_001), { limits: { output: 1_000_001 } }),
  limitProbe('output', 'x'.repeat(250_001)),
  limitProbe('depth', '<div>'.repeat(65)),
  limitProbe('token', `<a href="${'x'.repeat(65_537)}">`),
];

const time = [];
for (const family of FAMILIES) {
  const points = [];
  for (const sizeKib of SIZES_KIB) {
    const measurement = runWorker('time', family, sizeKib * 1024);
    const medianNanoseconds = nearestRank(measurement.nanoseconds, 0.5);
    points.push({ ...measurement, sizeKib, medianNanoseconds });
  }
  time.push({ family, slope: theilSenSlope(points), points });
}

const memory = [];
for (const family of FAMILIES) {
  const sizes = [];
  for (const sizeKib of [256, 1024]) {
    const samples = Array.from(
      { length: MEMORY_SAMPLES },
      () => runWorker('memory', family, sizeKib * 1024),
    );
    sizes.push({
      sizeKib,
      maxRssBytes: nearestRank(samples.map((sample) => sample.maxRssBytes), 0.5),
      rawSamples: samples,
    });
  }
  memory.push({
    family,
    sizes,
    rssGrowthBytes: sizes[1].maxRssBytes - sizes[0].maxRssBytes,
  });
}

const maxTimeSlope = Math.max(...time.map((measurement) => measurement.slope));
const maxStreamingRssGrowthBytes = Math.max(...memory.map((measurement) => measurement.rssGrowthBytes));
if (maxTimeSlope > 1.15) throw new Error(`Scaling slope exceeded 1.15: ${maxTimeSlope}`);
if (maxStreamingRssGrowthBytes > 8 * 1024 * 1024) {
  throw new Error(`Streaming RSS growth exceeded 8 MiB: ${maxStreamingRssGrowthBytes}`);
}
const measurements = {
  schemaVersion: 1,
  node: process.version,
  samplesPerSize: SAMPLES,
  memorySamplesPerSize: MEMORY_SAMPLES,
  defaultLimitProbes,
  time,
  memory,
  maxTimeSlope,
  maxStreamingRssGrowthBytes,
  pass: true,
};
process.stderr.write(
  `Scaling PASS: max slope ${maxTimeSlope.toFixed(3)}; `
  + `max streaming RSS growth ${(maxStreamingRssGrowthBytes / 1048576).toFixed(2)} MiB\n`,
);
process.stdout.write(`${JSON.stringify(measurements)}\n`);
