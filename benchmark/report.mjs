import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function milliseconds(nanoseconds) {
  return (nanoseconds / 1_000_000).toFixed(3);
}

function mebibytes(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

function renderMarkdown(result) {
  const throughputRows = result.throughput.map((measurement) => (
    `| ${measurement.corpus} | ${measurement.package} | ${milliseconds(measurement.medianNanosecondsPerOperation)} | ${milliseconds(measurement.p95NanosecondsPerOperation)} | ${measurement.minimumIterationsPerSample}–${measurement.maximumIterationsPerSample} |`
  ));
  const memoryRows = result.memory.map((measurement) => (
    `| ${measurement.corpus} | ${measurement.mode} | ${mebibytes(measurement.maxRssBytes)} | ${mebibytes(measurement.retainedHeapBytes)} |`
  ));
  const gateRows = result.gates.map((gate) => (
    `| ${gate.name} | ${gate.pass ? 'PASS' : 'FAIL'} | ${gate.detail} |`
  ));
  return `# Purifai v3 category benchmark

Purifai is benchmarked for its deliberately narrow category: bounded streaming conversion of untrusted HTML into readable plain text. This report does not claim that Purifai is the fastest HTML tool for every job.

Raw measurements: [benchmark/results/v3.json](../../benchmark/results/v3.json)

## Reproduce

\`\`\`sh
pnpm run bench
pnpm run bench:check
\`\`\`

- Run date: ${result.generatedAt}
- Runtime: ${result.environment.node}
- Platform: ${result.environment.platform} ${result.environment.arch}
- CPU: ${result.environment.cpuModel} (${result.environment.cpuCount} logical cores)
- Memory: ${mebibytes(result.environment.totalMemoryBytes)} MiB
- Packages: purifai ${result.packages.purifai}, striptags ${result.packages.striptags}, html-to-text ${result.packages['html-to-text']}
- Corpus SHA-256: \`${result.corpusSha256}\`

The throughput path uses already-materialized strings for every implementation. Each worker calibrates a batch to at least ${result.methodology.minimumBatchMilliseconds} ms, performs ${result.methodology.warmups} warmup batches, then records ${result.methodology.samples} batches with \`process.hrtime.bigint()\`. Median and p95 are nearest-rank values per conversion. Each package/corpus pair runs in a fresh process.

The memory path is different by design: Purifai streaming receives lazily generated chunks of at most ${result.methodology.streamingChunkCodeUnits.toLocaleString('en-US')} code units, while one-shot tools receive the same logical document after materialization. Each mode runs alone under \`node --expose-gc\` in ${result.methodology.memorySamples} fresh processes. The table gates the nearest-rank median of those process peak-RSS values and retains every raw sample in JSON. Purifai one-shot memory is reported separately and is not presented as streaming memory.

Artifact: ${result.artifact.esmGzipLevel9Bytes.toLocaleString('en-US')} bytes for the complete minified ESM runtime at gzip level 9; ${result.artifact.packageTarballBytes.toLocaleString('en-US')} bytes for the npm tarball.

## Release gates

| Gate | Result | Evidence |
| --- | --- | --- |
${gateRows.join('\n')}

## Throughput

| Corpus | Package | Median ms | p95 ms | Conversions/sample |
| --- | --- | ---: | ---: | ---: |
${throughputRows.join('\n')}

## Peak memory

| Corpus | Mode | Max RSS MiB | Retained heap MiB |
| --- | --- | ---: | ---: |
${memoryRows.join('\n')}

## Interpretation and limits

- \`striptags\` is a minimal tag remover. Its inclusion calibrates readability and dropped-body behavior; it is not the hostile-throughput gate.
- \`html-to-text\` offers a broader formatting feature set. Purifai intentionally does less, which is why hostile one-shot latency and streaming memory are compared directly while advanced table fidelity is not claimed.
- Purifai preserves simple rows and cells, but it does not attempt rowspan/colspan layout, visual CSS reconstruction, or browser-equivalent error recovery.
- Results are machine-, runtime-, and corpus-specific. The checked claim is the set of release gates above, not an uncategorized “fastest” claim.
`;
}

export async function writeBenchmarkReports(result) {
  const jsonPath = resolve(root, 'benchmark/results/v3.json');
  const markdownPath = resolve(root, 'docs/benchmarks/v3.md');
  await mkdir(dirname(jsonPath), { recursive: true });
  await mkdir(dirname(markdownPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, renderMarkdown(result), 'utf8');
}
