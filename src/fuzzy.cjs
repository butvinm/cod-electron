// Fuzzy path matching for the file finder.
// A query matches a path when its characters appear in order, ignoring case.
// Spaces in the query are ignored.

const SEPARATORS = new Set(['/', '-', '_', '.', ' ']);

// Positions of the query inside lower, or null. Matches from the end, so the
// file name is preferred over the folders before it.
function matchPositions(lower, query) {
  const positions = new Array(query.length);
  let at = lower.length;
  for (let i = query.length - 1; i >= 0; i--) {
    at = lower.lastIndexOf(query[i], at - 1);
    if (at < 0) return null;
    positions[i] = at;
  }
  return positions;
}

function score(path, positions) {
  const nameStart = path.lastIndexOf('/') + 1;
  let total = 0;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    total += 1;
    if (i > 0 && positions[i - 1] === p - 1) total += 4;
    if (p === 0 || SEPARATORS.has(path[p - 1])) total += 3;
    if (p >= nameStart) total += 3;
  }
  // Shorter paths first among equals.
  return total - path.length * 0.01;
}

// entries: [{ rel, lower }]. Returns the best `limit` as { entry, positions }.
function search(entries, rawQuery, limit = 50) {
  const query = rawQuery.toLowerCase().replace(/\s+/g, '');
  if (query === '') return [];
  const found = [];
  for (const entry of entries) {
    const positions = matchPositions(entry.lower, query);
    if (positions) found.push({ entry, positions, score: score(entry.rel, positions) });
  }
  found.sort((a, b) => b.score - a.score || (a.entry.rel < b.entry.rel ? -1 : a.entry.rel > b.entry.rel ? 1 : 0));
  return found.slice(0, limit);
}

module.exports = { search, matchPositions };
