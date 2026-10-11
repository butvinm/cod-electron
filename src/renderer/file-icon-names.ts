// Which icon a file gets. Pure data and a lookup, no DOM. Follows the file kinds of Zed's default icon theme (v1.23.2), drawn with Lucide icons.
const code = 'file-code';
const byExtension: Record<string, string> = {
  ts: code, mts: code, cts: code, js: code, mjs: code, cjs: code, tsx: code, jsx: code,
  rs: code, py: code, css: code, html: code, htm: code, toml: code, yaml: code, yml: code,
  sh: code, zsh: code,
  json: 'file-braces', jsonc: 'file-braces',
  md: 'book-open', markdown: 'book-open',
  lock: 'file-lock',
  png: 'file-image', jpg: 'file-image', jpeg: 'file-image', gif: 'file-image', svg: 'file-image', webp: 'file-image', ico: 'file-image',
};

export function iconNameFor(name: string, isDirectory: boolean, expanded: boolean): string {
  if (isDirectory) return expanded ? 'folder-open' : 'folder';
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'file';
  return byExtension[name.slice(dot + 1).toLowerCase()] || 'file';
}
