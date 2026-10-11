// The bundled project panel icons (Lucide, ISC), as SVG markup. Origin and notice: icons/README.md and icons/LICENSE.
import folder from './icons/folder.svg';
import folderOpen from './icons/folder-open.svg';
import file from './icons/file.svg';
import fileCode from './icons/file-code.svg';
import fileBraces from './icons/file-braces.svg';
import bookOpen from './icons/book-open.svg';
import fileImage from './icons/file-image.svg';
import fileLock from './icons/file-lock.svg';

const markup: Record<string, string> = {
  folder, 'folder-open': folderOpen, file, 'file-code': fileCode, 'file-braces': fileBraces, 'book-open': bookOpen, 'file-image': fileImage, 'file-lock': fileLock,
};

// A span holding the icon's inline SVG.
export function fileIcon(name: string): HTMLElement {
  const node = document.createElement('span');
  node.className = 'project-entry-icon';
  node.dataset.testid = 'project-entry-icon';
  node.innerHTML = markup[name] || markup.file as string;
  return node;
}
