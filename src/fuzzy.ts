// Fuzzy path matching for the file finder.
// A query matches a path when its characters appear in order, ignoring case.
// Spaces in the query are ignored.

const SEPARATORS = new Set(['/', '-', '_', '.', ' ']);

export interface FuzzyEntry {
  rel: string;
  lower: string;
}

export interface FuzzyMatch<T extends FuzzyEntry> {
  entry: T;
  positions: number[];
  score: number;
}

// Strictly increasing positions of the query inside lower, or null.
// Matches from the end, so the file name is preferred over the folders before it.
export function matchPositions(lower: string, query: string): number[] | null {
  const positions = new Array<number>(query.length);
  let at = lower.length;
  for (let i = query.length - 1; i >= 0; i--) {
    // Nothing is left before position 0, and lastIndexOf with a negative start would wrap around.
    if (at === 0) return null;
    at = lower.lastIndexOf(query[i], at - 1);
    if (at < 0) return null;
    positions[i] = at;
  }
  return positions;
}

function score(path: string, positions: number[]): number {
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

// Positive when a ranks before b.
function better(a: FuzzyMatch<FuzzyEntry>, b: FuzzyMatch<FuzzyEntry>): number {
  return a.score - b.score || (a.entry.rel < b.entry.rel ? 1 : a.entry.rel > b.entry.rel ? -1 : 0);
}

// Returns the best `limit` entries with their match positions, best first.
// Only a bounded list is kept, so a query that matches everything does not sort everything.
export function search<T extends FuzzyEntry>(entries: T[], rawQuery: string, limit = 50): FuzzyMatch<T>[] {
  const query = rawQuery.toLowerCase().replace(/\s+/g, '');
  if (query === '') return [];
  const top: FuzzyMatch<T>[] = [];
  for (const entry of entries) {
    const positions = matchPositions(entry.lower, query);
    if (!positions) continue;
    const item = { entry, positions, score: score(entry.rel, positions) };
    if (top.length === limit && better(item, top[limit - 1]) <= 0) continue;
    let at = top.length;
    while (at > 0 && better(item, top[at - 1]) > 0) at--;
    top.splice(at, 0, item);
    if (top.length > limit) top.pop();
  }
  return top;
}
