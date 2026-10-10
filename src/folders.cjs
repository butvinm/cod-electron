const fs = require('node:fs');
const path = require('node:path');

function realOrNull(target) {
  if (typeof target !== 'string' || !path.isAbsolute(target)) return null;
  try { return fs.realpathSync(target); } catch { return null; }
}

// Exactly ".." or ".." plus a separator escapes; a name like "..cache" does not.
function isInside(root, target) {
  const relative = path.relative(root, target);
  if (relative === '') return true;
  if (path.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`);
}
const { EventEmitter } = require('node:events');

// The one place that knows which folders each workspace holds.
// Anything that changes a workspace's folders (the panel today, codctl later) goes through add().
// Listeners on 'change' get { workspaceId, roots }.
class Folders extends EventEmitter {
  constructor() {
    super();
    this.byWorkspace = new Map();
  }

  list(workspaceId) {
    return [...(this.byWorkspace.get(workspaceId) || [])];
  }

  // Adds absolute folder paths, skipping duplicates. Returns the paths that were new.
  add(workspaceId, folders) {
    const roots = this.byWorkspace.get(workspaceId) || [];
    const added = [];
    for (const folder of folders) {
      if (!path.isAbsolute(folder)) throw new Error(`Folder path must be absolute: ${folder}`);
      const clean = path.resolve(folder);
      if (roots.includes(clean) || added.includes(clean)) continue;
      added.push(clean);
    }
    if (added.length === 0) return added;
    this.byWorkspace.set(workspaceId, [...roots, ...added]);
    this.emit('change', { workspaceId, roots: this.list(workspaceId) });
    return added;
  }

  forget(workspaceId) {
    if (this.byWorkspace.delete(workspaceId)) this.emit('change', { workspaceId, roots: [] });
  }

  // True when target is a root of any workspace, or inside one.
  // Both sides go through realpath, so a symlink that leads out of a root does not count.
  // A path that does not exist is not contained.
  contains(target) {
    const real = realOrNull(target);
    if (real === null) return false;
    for (const roots of this.byWorkspace.values()) {
      for (const root of roots) {
        const realRoot = realOrNull(root);
        if (realRoot !== null && isInside(realRoot, real)) return true;
      }
    }
    return false;
  }

  // True when target is inside a root of this workspace.
  workspaceContains(workspaceId, target) {
    const only = new Folders();
    only.byWorkspace.set(workspaceId, this.list(workspaceId));
    return only.contains(target);
  }
}

module.exports = { Folders };
