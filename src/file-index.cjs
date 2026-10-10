const fs = require('node:fs');
const path = require('node:path');
const ignore = require('ignore');
const { EXCLUDED } = require('./project-fs.cjs');
const { search } = require('./fuzzy.cjs');
const { realOrNull, isInside } = require('./folders.cjs');

// Rules run from the outermost .gitignore to the innermost, so a deeper explicit unignore
// beats an outer ignore, as in Git. "No match" leaves the earlier verdict alone.
function isIgnored(rules, abs, isDirectory) {
  let ignored = false;
  for (const { base, matcher } of rules) {
    const relative = path.relative(base, abs).split(path.sep).join('/');
    const verdict = matcher.test(isDirectory ? `${relative}/` : relative);
    if (verdict.ignored) ignored = true;
    else if (verdict.unignored) ignored = false;
  }
  return ignored;
}

// Lists every file under root that Git would not ignore, as { root, rel, abs, lower }.
// Nested .gitignore files apply to their own folder. Symlinked folders are not followed.
// A symlink whose real path leaves the root is skipped, for files and .gitignore alike.
async function walk(root) {
  const realRoot = realOrNull(root);
  if (realRoot === null) return [];
  const inside = target => {
    const real = realOrNull(target);
    return real !== null && isInside(realRoot, real);
  };
  const entries = [];
  const pending = [{ dir: root, rules: [] }];
  while (pending.length) {
    const { dir, rules } = pending.pop();
    let dirents;
    try { dirents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    let here = rules;
    if (dirents.some(d => d.name === '.gitignore')) {
      const file = path.join(dir, '.gitignore');
      try {
        if (inside(file)) here = [...rules, { base: dir, matcher: ignore().add(await fs.promises.readFile(file, 'utf8')) }];
      } catch { /* unreadable .gitignore is treated as absent */ }
    }
    for (const dirent of dirents) {
      if (EXCLUDED.has(dirent.name)) continue;
      const abs = path.join(dir, dirent.name);
      const isDirectory = dirent.isDirectory();
      let isFile = dirent.isFile();
      if (dirent.isSymbolicLink()) {
        try { isFile = inside(abs) && (await fs.promises.stat(abs)).isFile(); } catch { isFile = false; }
      }
      if (!isDirectory && !isFile) continue;
      if (isIgnored(here, abs, isDirectory)) continue;
      if (isDirectory) { pending.push({ dir: abs, rules: here }); continue; }
      const rel = path.relative(root, abs).split(path.sep).join('/');
      entries.push({ root, rel, abs, lower: rel.toLowerCase() });
    }
  }
  return entries;
}

// One file list per workspace, built in the main process and searched there.
// The renderer only receives the top results.
class FileIndex {
  // onRebuilt(workspaceId) fires when a build finishes, so the finder can re-run its query.
  constructor(rootsOf, onRebuilt = () => {}) {
    this.rootsOf = rootsOf;
    this.onRebuilt = onRebuilt;
    this.byWorkspace = new Map(); // id -> { entries, building, stale }
  }

  // Drops the list and starts again. Used when the roots change.
  reset(workspaceId) {
    this.byWorkspace.delete(workspaceId);
    if (this.rootsOf(workspaceId).length) this.build(workspaceId);
  }

  // The list may be out of date (files changed on disk). Rebuilt on the next prepare().
  markAllStale() {
    for (const state of this.byWorkspace.values()) state.stale = true;
  }

  forget(workspaceId) { this.byWorkspace.delete(workspaceId); }

  build(workspaceId) {
    const state = this.byWorkspace.get(workspaceId) || { entries: null, building: null, stale: false };
    this.byWorkspace.set(workspaceId, state);
    if (state.building) return state.building;
    state.stale = false;
    const roots = this.rootsOf(workspaceId);
    state.building = Promise.all(roots.map(walk)).then(lists => {
      if (this.byWorkspace.get(workspaceId) !== state) return;
      state.entries = lists.flat();
      this.onRebuilt(workspaceId);
    }).finally(() => { state.building = null; });
    return state.building;
  }

  // Called when the finder opens: build if missing, refresh if stale.
  prepare(workspaceId) {
    const state = this.byWorkspace.get(workspaceId);
    if (!state || state.stale) this.build(workspaceId);
  }

  // Answers from the current list at once, so typing stays fast during a refresh.
  // Waits only when there is no list yet. onRebuilt tells the finder to ask again after a refresh.
  async query(workspaceId, text, limit = 50) {
    if (!this.byWorkspace.has(workspaceId)) this.build(workspaceId);
    let state = this.byWorkspace.get(workspaceId);
    if (!state.entries && state.building) await state.building;
    state = this.byWorkspace.get(workspaceId);
    if (!state || !state.entries) return [];
    return search(state.entries, text, limit).map(({ entry, positions }) => ({
      path: entry.abs,
      root: entry.root,
      rel: entry.rel,
      positions,
    }));
  }
}

module.exports = { FileIndex, walk };
