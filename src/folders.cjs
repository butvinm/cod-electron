const path = require('node:path');
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
  contains(target) {
    if (!path.isAbsolute(target)) return false;
    const resolved = path.resolve(target);
    for (const roots of this.byWorkspace.values()) {
      for (const root of roots) {
        const relative = path.relative(root, resolved);
        if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return true;
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
