const fs = require('node:fs');
const { realOrNull } = require('./folders.cjs');

const MAX_BYTES = 10 * 1024 * 1024;

// Reads and writes the text of files for the editor.
// `folders` is the Folders model. Every path is checked with the same realpath containment as project reads,
// and the real path is what gets touched, so a symlink swapped in later cannot lead out of the workspace.
class EditorFiles {
  constructor(folders) {
    this.folders = folders;
  }

  resolve(workspaceId, file) {
    if (typeof file !== 'string' || !this.folders.workspaceContains(workspaceId, file)) throw new Error('Not inside a workspace folder');
    const real = realOrNull(file);
    if (real === null || !fs.statSync(real).isFile()) throw new Error('Not a file');
    return real;
  }

  read(workspaceId, file) {
    const real = this.resolve(workspaceId, file);
    if (fs.statSync(real).size > MAX_BYTES) throw new Error('File is too large to edit');
    const buffer = fs.readFileSync(real);
    if (buffer.includes(0)) throw new Error('Binary files cannot be edited');
    return buffer.toString('utf8');
  }

  // Only existing files are written: the editor never creates files.
  write(workspaceId, file, text) {
    if (typeof text !== 'string') throw new Error('Text must be a string');
    fs.writeFileSync(this.resolve(workspaceId, file), text, 'utf8');
  }
}

module.exports = { EditorFiles };
