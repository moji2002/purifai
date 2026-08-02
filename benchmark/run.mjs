import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { arch, cpus, platform, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import stripTags from 'striptags';
import { convert as htmlToText } from 'html-to-text';
import { toText } from '../dist/index.js';
import { READABILITY_FIXTURES } from '../test/v3/fixtures/readability.js';
import { CORPORA, PURIFAI_BENCH_OPTIONS } from './corpus.mjs';
import { writeBenchmarkReports } from './report.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resultPath = resolve(root, 'benchmark/results/v3.json');
const packageNames = ['purifai', 'html-to-text', 'striptags'];
const memoryModes = ['purifai-stream', 'purifai-one-shot', 'html-to-text'];
const WARMUPS = 10;
const SAMPLES = 40;
const MEMORY_SAMPLES = 7;

const BODY_FIXTURES = Object.freeze([
  { name: 'script', html: '<p>Before</p><script>calibration()</script><p>After</p>', expected: 'Before\n\nAfter' },
  { name: 'style', html: '<p>Before</p><style>body{color:red}</style><p>After</p>', expected: 'Before\n\nAfter' },
  { name: 'iframe', html: '<p>Before</p><iframe>embedded reader leak</iframe><p>After</p>', expected: 'Before\n\nAfter' },
  { name: 'template', html: '<p>Before</p><template>template reader leak</template><p>After</p>', expected: 'Before\n\nAfter' },
  { name: 'svg', html: '<p>Before</p><svg><text>foreign reader leak</text></svg><p>After</p>', expected: 'Before\n\nAfter' },
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function nearestRank(values, quantile) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * quantile) - 1)];
}

function aggregate(measurement) {
  const perOperation = measurement.samplesNanoseconds.map(
    (sample, index) => sample / measurement.sampleIterations[index],
  );
  return {
    ...measurement,
    medianNanosecondsPerOperation: nearestRank(perOperation, 0.5),
    p95NanosecondsPerOperation: nearestRank(perOperation, 0.95),
  };
}

function aggregateMemory(measurements) {
  const first = measurements[0];
  if (first === undefined) throw new Error('Missing memory measurements');
  for (const measurement of measurements) {
    if (
      measurement.mode !== first.mode
      || measurement.corpus !== first.corpus
      || measurement.checksum !== first.checksum
      || measurement.outputCodeUnits !== first.outputCodeUnits
    ) throw new Error(`Inconsistent memory sample for ${first.mode}/${first.corpus}`);
  }
  return {
    ...first,
    startHeapBytes: nearestRank(measurements.map((sample) => sample.startHeapBytes), 0.5),
    endHeapBytes: nearestRank(measurements.map((sample) => sample.endHeapBytes), 0.5),
    retainedHeapBytes: nearestRank(measurements.map((sample) => sample.retainedHeapBytes), 0.5),
    maxRssBytes: nearestRank(measurements.map((sample) => sample.maxRssBytes), 0.5),
    rawSamples: measurements.map((sample) => ({
      startHeapBytes: sample.startHeapBytes,
      endHeapBytes: sample.endHeapBytes,
      retainedHeapBytes: sample.retainedHeapBytes,
      maxRssBytes: sample.maxRssBytes,
    })),
  };
}

function worker(args, exposeGc = false) {
  const nodeArgs = exposeGc ? ['--expose-gc'] : [];
  const result = spawnSync(
    process.execPath,
    [...nodeArgs, resolve(root, 'benchmark/worker.mjs'), ...args],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Benchmark worker failed (${args.join(' ')}):\n${result.stdout}${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

async function versions() {
  const names = ['striptags', 'html-to-text'];
  const manifests = await Promise.all(names.map(async (name) => JSON.parse(
    await readFile(resolve(root, `node_modules/${name}/package.json`), 'utf8'),
  )));
  const purifai = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  return {
    purifai: purifai.version,
    striptags: manifests[0].version,
    'html-to-text': manifests[1].version,
  };
}

function correctness() {
  const readability = READABILITY_FIXTURES.map((fixture) => ({
    name: fixture.name,
    purifai: toText(fixture.html) === fixture.readable,
    striptags: stripTags(fixture.html) === fixture.readable,
  }));
  const bodyRemoval = BODY_FIXTURES.map((fixture) => ({
    name: fixture.name,
    purifai: toText(fixture.html) === fixture.expected,
    striptagsLeaked: stripTags(fixture.html).includes('leak')
      || stripTags(fixture.html).includes('calibration'),
  }));
  for (const corpus of CORPORA) {
    const outputDigest = sha256(toText(corpus.materialize(), PURIFAI_BENCH_OPTIONS));
    if (outputDigest !== corpus.expectedPurifaiDigest) {
      throw new Error(`Reviewed Purifai digest changed for ${corpus.name}`);
    }
  }
  return { readability, bodyRemoval };
}

function corpusSha256() {
  const hash = createHash('sha256');
  for (const corpus of CORPORA) {
    hash.update(corpus.name).update('\0');
    hash.update(corpus.category).update('\0');
    hash.update(corpus.unit).update('\0');
    hash.update(String(corpus.repetitions)).update('\0');
  }
  return hash.digest('hex');
}

function validateTemporary(directory) {
  const value = resolve(directory);
  if (!value.startsWith(`${resolve(tmpdir())}${sep}`) || !value.split(sep).at(-1).startsWith('purifai-bench-pack-')) {
    throw new Error(`Unexpected benchmark pack directory: ${value}`);
  }
  return value;
}

async function packageTarballBytes() {
  const temporary = validateTemporary(await mkdtemp(join(tmpdir(), 'purifai-bench-pack-')));
  try {
    const result = spawnSync('npm', [
      'pack', '--ignore-scripts', '--pack-destination', temporary,
      '--cache', join(temporary, 'npm-cache'), '--silent',
    ], { cwd: root, encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`npm pack failed:\n${result.stdout}${result.stderr}`);
    const tarballs = (await readdir(temporary)).filter((entry) => entry.endsWith('.tgz'));
    if (tarballs.length !== 1) throw new Error(`Expected one tarball, found ${tarballs.length}`);
    return (await stat(resolve(temporary, tarballs[0]))).size;
  } finally {
    validateTemporary(temporary);
    await rm(temporary, { recursive: true, force: true });
  }
}

function findThroughput(result, packageName, corpus) {
  return result.throughput.find(
    (measurement) => measurement.package === packageName && measurement.corpus === corpus,
  );
}

function findMemory(result, mode, corpus) {
  return result.memory.find(
    (measurement) => measurement.mode === mode && measurement.corpus === corpus,
  );
}

function calculateGates(result) {
  const gates = [];
  const readablePasses = result.correctness.readability.filter((row) => row.purifai).length;
  const stripReadablePasses = result.correctness.readability.filter((row) => row.striptags).length;
  gates.push({
    name: 'reviewed readability fixtures',
    pass: readablePasses === result.correctness.readability.length
      && stripReadablePasses < readablePasses,
    detail: `Purifai ${readablePasses}/${result.correctness.readability.length}; striptags ${stripReadablePasses}/${result.correctness.readability.length}`,
  });
  const bodyPasses = result.correctness.bodyRemoval.filter((row) => row.purifai).length;
  const calibrationLeaked = result.correctness.bodyRemoval.find((row) => row.name === 'script')?.striptagsLeaked === true;
  gates.push({
    name: 'non-reader body removal',
    pass: bodyPasses === result.correctness.bodyRemoval.length && calibrationLeaked,
    detail: `Purifai ${bodyPasses}/${result.correctness.bodyRemoval.length}; striptags script calibration leak ${calibrationLeaked ? 'observed' : 'missing'}`,
  });
  for (const corpus of CORPORA.filter((entry) => entry.category === 'hostile')) {
    const purifai = findThroughput(result, 'purifai', corpus.name);
    const rival = findThroughput(result, 'html-to-text', corpus.name);
    gates.push({
      name: `${corpus.name} hostile p95`,
      pass: Boolean(purifai && rival && purifai.p95NanosecondsPerOperation < rival.p95NanosecondsPerOperation),
      detail: purifai && rival
        ? `Purifai ${(purifai.p95NanosecondsPerOperation / 1e6).toFixed(3)} ms; html-to-text ${(rival.p95NanosecondsPerOperation / 1e6).toFixed(3)} ms`
        : 'measurement missing',
    });
  }
  for (const corpus of CORPORA.filter((entry) => entry.name !== 'readable-small')) {
    const stream = findMemory(result, 'purifai-stream', corpus.name);
    const rival = findMemory(result, 'html-to-text', corpus.name);
    gates.push({
      name: `${corpus.name} streaming RSS`,
      pass: Boolean(stream && rival && stream.maxRssBytes < rival.maxRssBytes),
      detail: stream && rival
        ? `Purifai ${(stream.maxRssBytes / 1048576).toFixed(2)} MiB; html-to-text ${(rival.maxRssBytes / 1048576).toFixed(2)} MiB`
        : 'measurement missing',
    });
  }
  return gates;
}

function validateSchema(result) {
  if (result.schemaVersion !== 1) throw new Error('Unsupported benchmark result schema');
  if (result.methodology.warmups !== WARMUPS || result.methodology.samples !== SAMPLES) {
    throw new Error('Benchmark methodology was weakened');
  }
  for (const measurement of result.throughput) {
    if (
      measurement.samplesNanoseconds.length !== SAMPLES
      || measurement.sampleIterations.length !== SAMPLES
      || measurement.samplesNanoseconds.some((sample) => sample < 100_000_000)
    ) {
      throw new Error(`Missing raw samples for ${measurement.package}/${measurement.corpus}`);
    }
  }
  for (const measurement of result.memory) {
    if (measurement.rawSamples.length !== MEMORY_SAMPLES) {
      throw new Error(`Missing raw memory samples for ${measurement.mode}/${measurement.corpus}`);
    }
  }
  const gates = calculateGates(result);
  const failures = gates.filter((gate) => !gate.pass);
  return { gates, failures };
}

if (process.argv.includes('--check')) {
  const saved = JSON.parse(await readFile(resultPath, 'utf8'));
  const currentVersions = await versions();
  if (JSON.stringify(saved.packages) !== JSON.stringify(currentVersions)) {
    throw new Error('Saved benchmark package versions do not match installed versions');
  }
  if (saved.corpusSha256 !== corpusSha256()) throw new Error('Saved benchmark corpus is stale');
  const { failures } = validateSchema(saved);
  if (failures.length > 0) throw new Error(`Saved benchmark gates fail:\n${failures.map((gate) => gate.detail).join('\n')}`);
  console.log(`Benchmark report check PASS (${saved.gates.length} gates)`);
} else {
  const installedVersions = await versions();
  if (installedVersions.striptags !== '3.2.0' || installedVersions['html-to-text'] !== '10.0.0') {
    throw new Error('Benchmark rival versions must remain exactly pinned');
  }
  const checked = correctness();
  const throughput = [];
  for (const corpus of CORPORA) {
    for (const packageName of packageNames) {
      const measurement = aggregate(worker(['throughput', packageName, corpus.name]));
      throughput.push(measurement);
      console.log(`throughput ${corpus.name} ${packageName}: p95 ${(measurement.p95NanosecondsPerOperation / 1e6).toFixed(3)} ms`);
    }
  }
  const memory = [];
  for (const corpus of CORPORA.filter((entry) => entry.name !== 'readable-small')) {
    for (const mode of memoryModes) {
      const measurement = aggregateMemory(
        Array.from({ length: MEMORY_SAMPLES }, () => worker(['memory', mode, corpus.name], true)),
      );
      memory.push(measurement);
      console.log(`memory ${corpus.name} ${mode}: ${(measurement.maxRssBytes / 1048576).toFixed(2)} MiB max RSS`);
    }
  }
  const esm = await readFile(resolve(root, 'dist/index.js'));
  const cpu = cpus();
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: platform(),
      arch: arch(),
      cpuModel: cpu[0]?.model ?? 'unknown',
      cpuCount: cpu.length,
      totalMemoryBytes: totalmem(),
    },
    packages: installedVersions,
    corpusSha256: corpusSha256(),
    methodology: {
      warmups: WARMUPS,
      samples: SAMPLES,
      minimumBatchMilliseconds: 100,
      streamingChunkCodeUnits: 16_384,
      memorySamples: MEMORY_SAMPLES,
      percentile: 'nearest-rank',
    },
    artifact: {
      esmGzipLevel9Bytes: gzipSync(esm, { level: 9 }).length,
      packageTarballBytes: 0,
    },
    correctness: checked,
    throughput,
    memory,
    gates: [],
    pass: false,
  };
  const evaluated = validateSchema(result);
  result.gates = evaluated.gates;
  result.pass = evaluated.failures.length === 0;
  await writeBenchmarkReports(result);
  result.artifact.packageTarballBytes = await packageTarballBytes();
  await writeBenchmarkReports(result);
  for (const gate of result.gates) console.log(`${gate.pass ? 'PASS' : 'FAIL'} ${gate.name}: ${gate.detail}`);
  if (!result.pass) {
    throw new Error(`Benchmark release gates failed: ${evaluated.failures.map((gate) => gate.name).join(', ')}`);
  }
  console.log(`Benchmark PASS (${result.gates.length} gates)`);
}
