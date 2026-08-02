const TARGET_256_KIB = 256 * 1024;

export const PURIFAI_BENCH_OPTIONS = Object.freeze({
  limits: Object.freeze({
    depth: 2_048,
    input: 2 * 1024 * 1024,
    output: 1024 * 1024,
    token: 128 * 1024,
  }),
});

const expectedDigests = Object.freeze({
  'readable-small': '8a88dfa3188074941568770d3d7cc7824a2b6dbea7190d37df70277e733c9e36',
  'readable-large': 'da0c89abf67f63177495b249667ad3bbf5ffc13e651dcec685b0eb031a3b9bec',
  'hostile-tags': '6e7cd4e45209aed8b3d738b50e9b9acbb6f75d94b6475300573102456d3e7264',
  'hostile-comments': '7696da7b4f12b5c934702301adb75082b7f52dd6c9eed3b63c302aa21048dfb0',
  'hostile-entities': '3a639c6b24595d6237272ed4c997f740d029209605b24b18560e8f0b066c0bce',
  'hostile-raw': 'f892441dd4b8fb4c2f5468b34b3ddedef15005835a3c10b42ab72b45d0747633',
});

function repetitionsFor(unit, target = TARGET_256_KIB) {
  return Math.ceil(target / unit.length);
}

function record(name, category, unit, repetitions) {
  if (!unit || !Number.isSafeInteger(repetitions) || repetitions < 1) {
    throw new Error(`Invalid corpus definition: ${name}`);
  }
  const codeUnits = unit.length * repetitions;
  return Object.freeze({
    name,
    category,
    unit,
    repetitions,
    codeUnits,
    expectedPurifaiDigest: expectedDigests[name],
    materialize() {
      return unit.repeat(repetitions);
    },
    *chunks(maxCodeUnits) {
      if (!Number.isSafeInteger(maxCodeUnits) || maxCodeUnits < 1) {
        throw new RangeError('maxCodeUnits must be a positive safe integer');
      }
      let pending = '';
      for (let index = 0; index < repetitions; index += 1) {
        pending += unit;
        while (pending.length >= maxCodeUnits) {
          yield pending.slice(0, maxCodeUnits);
          pending = pending.slice(maxCodeUnits);
        }
      }
      if (pending) yield pending;
    },
  });
}

const readableSmall = [
  '<article><h1>Field Notes</h1>',
  '<p>A compact reader should preserve <strong>meaning</strong>, not markup. ',
  '<a href="https://example.test/guide">Read the guide</a>.</p>',
  '<h2>Checklist</h2><ol><li>Bound input</li><li>Stream output<ul><li>Keep chunks stable</li></ul></li></ol>',
  '<blockquote>Small interfaces make strong guarantees easier to audit.</blockquote>',
  '<pre><code>const text = toText(html);</code></pre>',
  '<table><thead><tr><th>Mode</th><th>Use</th></tr></thead>',
  '<tbody><tr><td>readable</td><td>people</td></tr><tr><td>compact</td><td>indexes</td></tr></tbody></table>',
  '</article>',
].join('');

const hostileTags = [
  '<main><div data-long="',
  'x'.repeat(2_048),
  ' > still-quoted <script>calibration</script> "><p>Kept</p>',
  '<div><span><b>mismatch</div></i></unknown><a href="https://example.test/?q=>">link</a>',
  '<broken attr="unterminated > tail',
].join('');

const hostileComments = [
  '<p>Before</p><!--',
  '<!--'.repeat(96),
  '!----!>---><![CDATA[<script>hidden</script>]]><!DOCTYPE ',
  'x'.repeat(512),
  '><p>After</p>',
].join('');

const hostileEntities = [
  '<p>',
  '&CounterClockwiseContourIntegral'.repeat(32),
  '&notit;&notin;&amp;&#x80;&#128;&#1114112;&#xD800;',
  '&#'.repeat(64),
  '&#x'.repeat(64),
  '&ThisEntityNameNeverTerminates'.repeat(32),
  ' reader text</p>',
].join('');

const hostileRaw = [
  '<p>Before</p><script>',
  '</scrip'.repeat(128),
  '<!--<script>nested</script>-->',
  '"</scriptx>"<\/script>',
  '</script><style>',
  '</styl'.repeat(128),
  'body{background:url(javascript:alert(1))}</style>',
  '<template><iframe srcdoc="<script>x</script>">hidden</iframe></template>',
  '<p>After</p>',
].join('');

export const CORPORA = Object.freeze([
  record('readable-small', 'readable', readableSmall, 1),
  record('readable-large', 'readable', readableSmall, repetitionsFor(readableSmall)),
  record('hostile-tags', 'hostile', hostileTags, repetitionsFor(hostileTags)),
  record('hostile-comments', 'hostile', hostileComments, repetitionsFor(hostileComments)),
  record('hostile-entities', 'hostile', hostileEntities, repetitionsFor(hostileEntities)),
  record('hostile-raw', 'hostile', hostileRaw, repetitionsFor(hostileRaw)),
]);

export function corpusByName(name) {
  const corpus = CORPORA.find((candidate) => candidate.name === name);
  if (!corpus) throw new Error(`Unknown corpus: ${name}`);
  return corpus;
}
