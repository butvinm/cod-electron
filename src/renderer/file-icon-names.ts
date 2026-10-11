// Which icon a file gets. Pure data and a lookup, no DOM. Follows the extension table of Zed's default icon theme (v1.23.2).
const byExtension: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  tsx: 'react', jsx: 'react', mtsx: 'react', ctsx: 'react', mjsx: 'react', cjsx: 'react',
  json: 'code', jsonc: 'code',
  md: 'book', markdown: 'book',
  rs: 'rust',
  py: 'python',
  css: 'css', pcss: 'css', postcss: 'css',
  htm: 'html', html: 'html',
  toml: 'toml',
  yaml: 'yaml', yml: 'yaml',
  lock: 'lock',
  sh: 'terminal', zsh: 'terminal', zshrc: 'terminal',
  conf: 'settings', ini: 'settings',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image', ico: 'image',
};

export function iconNameFor(name: string, isDirectory: boolean, expanded: boolean): string {
  if (isDirectory) return expanded ? 'folder_open' : 'folder';
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'file';
  return byExtension[name.slice(dot + 1).toLowerCase()] || 'file';
}
