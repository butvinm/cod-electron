// Pure project tree logic. No DOM and no file system here, so it is easy to test.
// A classic script like workspaces.js.
(function (root) {
  // Flattens roots into the visible rows.
  // roots: absolute paths. expanded: Set of paths. children: path -> [{ name, path, isDirectory }].
  function visibleRows(roots, expanded, children) {
    const rows = [];
    function walk(entry, depth, parent, rootPath) {
      const open = entry.isDirectory && expanded.has(entry.path);
      rows.push({ path: entry.path, name: entry.name, isDirectory: entry.isDirectory, depth, parent, rootPath, expanded: open });
      if (open) for (const child of children[entry.path] || []) walk(child, depth + 1, entry.path, rootPath);
    }
    for (const rootPath of roots) {
      const name = rootPath.split(/[\\/]/).filter(Boolean).pop() || rootPath;
      walk({ name, path: rootPath, isDirectory: true }, 0, null, rootPath);
    }
    return rows;
  }

  // Maps a key to what the panel should do. Returns null when the key means nothing here.
  // Result: { select: path } | { expand: path } | { collapse: path } | { open: path }.
  function navigate(rows, selected, key) {
    if (rows.length === 0) return null;
    const index = rows.findIndex(r => r.path === selected);
    const row = rows[index];
    switch (key) {
      case 'ArrowDown':
        return { select: rows[index < 0 ? 0 : Math.min(index + 1, rows.length - 1)].path };
      case 'ArrowUp':
        return { select: rows[index < 0 ? rows.length - 1 : Math.max(index - 1, 0)].path };
      case 'Home':
        return { select: rows[0].path };
      case 'End':
        return { select: rows[rows.length - 1].path };
      case 'ArrowRight':
        if (!row || !row.isDirectory) return null;
        if (!row.expanded) return { expand: row.path };
        return rows[index + 1] && rows[index + 1].parent === row.path ? { select: rows[index + 1].path } : null;
      case 'ArrowLeft':
        if (!row) return null;
        if (row.isDirectory && row.expanded) return { collapse: row.path };
        return row.parent ? { select: row.parent } : null;
      case 'Enter':
      case ' ':
        return row && !row.isDirectory ? { open: row.path } : null;
      default:
        return null;
    }
  }

  // Panel state of one workspace: whether it is open, which folders are expanded, what is selected.
  function createPanelState() {
    return { open: false, expanded: new Set(), selected: null };
  }

  const api = { visibleRows, navigate, createPanelState };
  if (typeof module !== 'undefined') module.exports = api;
  else root.ProjectTree = api;
})(globalThis);
