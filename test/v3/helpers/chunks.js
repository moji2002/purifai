export function oneUnitChunks(value) {
  return Array.from({ length: value.length }, (_, index) => value.slice(index, index + 1));
}

export function everyTwoWaySplit(value) {
  return Array.from({ length: value.length + 1 }, (_, index) => [
    value.slice(0, index),
    value.slice(index),
  ]);
}

export function fixedChunks(value, size) {
  const chunks = [];
  for (let index = 0; index < value.length; index += size) chunks.push(value.slice(index, index + size));
  return chunks.length === 0 ? [''] : chunks;
}

export function seededChunks(value, seed) {
  const chunks = [];
  let state = seed >>> 0;
  let index = 0;
  while (index < value.length) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const size = 1 + (state % 11);
    chunks.push(value.slice(index, index + size));
    index += size;
  }
  return chunks.length === 0 ? [''] : chunks;
}
