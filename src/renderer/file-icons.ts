// The bundled project panel icons, as SVG markup. Origin and notice: icons/README.md and icons/LICENSES.
import typescript from './icons/typescript.svg';
import javascript from './icons/javascript.svg';
import react from './icons/react.svg';
import code from './icons/code.svg';
import book from './icons/book.svg';
import rust from './icons/rust.svg';
import python from './icons/python.svg';
import css from './icons/css.svg';
import html from './icons/html.svg';
import toml from './icons/toml.svg';
import yaml from './icons/yaml.svg';
import lock from './icons/lock.svg';
import terminal from './icons/terminal.svg';
import settings from './icons/settings.svg';
import image from './icons/image.svg';
import file from './icons/file.svg';
import folder from './icons/folder.svg';
import folderOpen from './icons/folder_open.svg';

const markup: Record<string, string> = {
  typescript, javascript, react, code, book, rust, python, css, html, toml, yaml, lock, terminal, settings, image, file, folder, folder_open: folderOpen,
};

// A span holding the icon's inline SVG.
export function fileIcon(name: string): HTMLElement {
  const node = document.createElement('span');
  node.className = 'project-entry-icon';
  node.dataset.testid = 'project-entry-icon';
  node.innerHTML = markup[name] || markup.file as string;
  return node;
}
