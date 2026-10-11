// Syntax highlighting for code blocks in chat replies. No DOM here, so it is easy to test.
// It returns runs with the same category names as the editor, whose colors live in editor.css.
import { highlightTree, tagHighlighter, tags as t } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { go } from '@codemirror/lang-go';
import { rust } from '@codemirror/lang-rust';
import { json } from '@codemirror/lang-json';

type Parser = ReturnType<typeof json>['language']['parser'];

export interface CodeRun {
  from: number;
  to: number;
  category: string;
}

// The same Lezer tag to One Dark category table as the editor (editor-cm.ts), for code languages only.
const highlighter = tagHighlighter([
  { tag: t.keyword, class: 'keyword' },
  { tag: t.self, class: 'variable.special' },
  { tag: t.operator, class: 'operator' },
  { tag: t.string, class: 'string' },
  { tag: t.docString, class: 'comment.doc' },
  { tag: t.character, class: 'string' },
  { tag: t.escape, class: 'string.escape' },
  { tag: t.regexp, class: 'string.regex' },
  { tag: t.special(t.string), class: 'string.special' },
  { tag: t.number, class: 'number' },
  { tag: t.bool, class: 'boolean' },
  { tag: t.null, class: 'constant' },
  { tag: t.atom, class: 'constant' },
  { tag: t.comment, class: 'comment' },
  { tag: t.docComment, class: 'comment.doc' },
  { tag: t.variableName, class: 'variable' },
  { tag: t.function(t.variableName), class: 'function' },
  { tag: t.function(t.propertyName), class: 'function' },
  { tag: t.propertyName, class: 'property' },
  { tag: t.typeName, class: 'type' },
  { tag: t.className, class: 'type' },
  { tag: t.namespace, class: 'namespace' },
  { tag: t.macroName, class: 'function' },
  { tag: t.labelName, class: 'label' },
  { tag: t.tagName, class: 'tag' },
  { tag: t.attributeName, class: 'attribute' },
  { tag: t.attributeValue, class: 'string' },
  { tag: t.annotation, class: 'attribute' },
  { tag: t.meta, class: 'preproc' },
  { tag: [t.angleBracket, t.bracket, t.squareBracket, t.paren, t.brace], class: 'punctuation.bracket' },
  { tag: [t.separator, t.punctuation], class: 'punctuation.delimiter' },
]);

const parsers: Record<string, () => Parser> = {
  ts: () => javascript({ typescript: true }).language.parser,
  tsx: () => javascript({ typescript: true, jsx: true }).language.parser,
  js: () => javascript().language.parser,
  jsx: () => javascript({ jsx: true }).language.parser,
  json: () => json().language.parser,
  py: () => python().language.parser,
  go: () => go().language.parser,
  rust: () => rust().language.parser,
};

const aliases: Record<string, string> = {
  typescript: 'ts', mts: 'ts', cts: 'ts',
  javascript: 'js', mjs: 'js', cjs: 'js', node: 'js',
  jsonc: 'json', json5: 'json',
  python: 'py', python3: 'py',
  golang: 'go',
  rs: 'rust',
  bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh',
};

// The language name from a fence info string such as "ts" or "rust title=x". Empty when none.
export function languageName(info: string): string {
  const word = (info.trim().split(/\s+/)[0] || '').replace(/^\{?\.?/, '').toLowerCase();
  return Object.hasOwn(aliases, word) ? aliases[word] : word;
}

const shellKeywords = new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'in', 'function', 'select', 'time', 'return', 'exit', 'export', 'local', 'readonly', 'unset', 'set', 'source']);

// A small tokenizer for shell: comments, quoted strings, variables, numbers and keywords.
export function shellRuns(code: string): CodeRun[] {
  const runs: CodeRun[] = [];
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    const atWordStart = i === 0 || /[\s;|&(]/.test(code[i - 1]);
    if (ch === '#' && atWordStart) {
      let end = code.indexOf('\n', i);
      if (end < 0) end = code.length;
      runs.push({ from: i, to: end, category: 'comment' });
      i = end;
    } else if (ch === '"' || ch === "'") {
      let end = i + 1;
      while (end < code.length && code[end] !== ch) end += code[end] === '\\' && ch === '"' ? 2 : 1;
      end = Math.min(end + 1, code.length);
      runs.push({ from: i, to: end, category: 'string' });
      i = end;
    } else if (ch === '$') {
      const match = /^\$(?:\{[^}\n]*\}|[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/.exec(code.slice(i));
      const length = match ? match[0].length : 1;
      if (match) runs.push({ from: i, to: i + length, category: 'variable.special' });
      i += length;
    } else if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(code.slice(i));
      const word = match ? match[0] : ch;
      if (shellKeywords.has(word)) runs.push({ from: i, to: i + word.length, category: 'keyword' });
      i += word.length;
    } else if (/[0-9]/.test(ch) && atWordStart) {
      const match = /^[0-9]+(?![A-Za-z_])/.exec(code.slice(i));
      if (match) runs.push({ from: i, to: i + match[0].length, category: 'number' });
      i += match ? match[0].length : 1;
    } else {
      i++;
    }
  }
  return runs;
}

// Highlighted runs for a code block, in order and without overlap. Unknown languages have none.
export function highlightRuns(language: string, code: string): CodeRun[] {
  const name = Object.hasOwn(aliases, language) ? aliases[language] : language;
  if (name === 'sh') return shellRuns(code);
  if (!Object.hasOwn(parsers, name)) return [];
  const tree = parsers[name]().parse(code);
  const runs: CodeRun[] = [];
  highlightTree(tree, highlighter, (from, to, classes) => {
    const category = classes.split(' ')[0];
    if (category && code.slice(from, to).trim()) runs.push({ from, to, category });
  });
  return runs;
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// Decodes one HTML entity such as "&amp;" or "&#65;" to text. Unknown ones stay as written.
export function decodeEntity(entity: string): string {
  const match = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z]+));$/.exec(entity);
  if (!match) return entity;
  if (match[3]) return Object.hasOwn(entities, match[3]) ? entities[match[3]] : entity;
  const code = match[1] ? Number(match[1]) : parseInt(match[2], 16);
  return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
}

// A fence inside a list or quote comes as one text segment per line, without the container prefixes.
export function joinCodeSegments(segments: string[]): string {
  return segments.map(segment => segment.replace(/\n$/, '')).join('\n');
}

// A link destination as written: entities and backslash escapes become the characters they stand for.
export function linkDestination(raw: string): string {
  return raw.replace(/\\([!-/:-@[-`{-~])|&(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z]+);/g, (match, escaped: string | undefined) => escaped ?? decodeEntity(match));
}

// Only these links are handed to the system browser. Anything else shows as plain text.
export function safeLink(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? url.trim() : null;
  } catch {
    return null;
  }
}
