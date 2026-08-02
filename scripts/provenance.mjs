function containsExactSourceDigest(value, expectedSha, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (
      ['gitCommit', 'sha', 'sha1'].includes(key)
      && typeof nested === 'string'
      && nested.toLowerCase() === expectedSha
    ) return true;
    if (key === 'digest' && nested !== null && typeof nested === 'object') {
      if (Object.values(nested).some(
        (digest) => typeof digest === 'string' && digest.toLowerCase() === expectedSha,
      )) return true;
    }
    if (containsExactSourceDigest(nested, expectedSha, seen)) return true;
  }
  return false;
}

export function statementMatches(statement, expected) {
  if (![
    'https://in-toto.io/Statement/v0.1',
    'https://in-toto.io/Statement/v1',
  ].includes(statement?._type)) return false;
  if (typeof statement.predicateType !== 'string' || !statement.predicateType.includes('slsa')) return false;
  const subjectMatches = statement.subject?.some((subject) => (
    typeof subject?.name === 'string'
    && subject.name.includes(`${expected.name}@${expected.version}`)
    && subject.digest?.sha512?.toLowerCase() === expected.tarballSha512Hex
  ));
  return Boolean(subjectMatches && containsExactSourceDigest(statement.predicate, expected.githubSha));
}
