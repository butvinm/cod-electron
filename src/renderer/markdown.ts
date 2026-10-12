// Draws markdown text as DOM nodes. The text comes from a model, so it is never parsed as HTML:
// every node here is created with createElement and createTextNode, and raw HTML in the
// markdown stays visible as text. The parser is @lezer/markdown with the GitHub extensions.
import { parser, GFM } from '@lezer/markdown';
import { highlightRuns, languageName, decodeEntity, safeLink, joinCodeSegments, linkDestination } from './markdown-code.ts';

import { findFileRefs, wholeFileRef, type FileRef } from './file-refs.ts';

const gfm = parser.configure(GFM);
type SyntaxNode = ReturnType<typeof gfm.parse>['topNode'];

// Syntax characters that are never drawn: the node around them says what they mean.
const MARKS = new Set(['HeaderMark', 'QuoteMark', 'ListMark', 'CodeMark', 'LinkMark', 'EmphasisMark', 'StrikethroughMark', 'TableDelimiter', 'CodeInfo']);

// Raw HTML and similar blocks: shown as the text that was written.
const RAW_BLOCKS = new Set(['HTMLBlock', 'CommentBlock', 'ProcessingInstructionBlock', 'LinkReference']);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.append(...kids);
  return element;
}

function children(parent: SyntaxNode): SyntaxNode[] {
  const list: SyntaxNode[] = [];
  for (let child = parent.firstChild; child; child = child.nextSibling) list.push(child);
  return list;
}

// The inline content of a node between from and to: text, with the inline nodes drawn as elements.
function inline(src: string, parent: SyntaxNode, from = parent.from, to = parent.to): Node[] {
  const out: Node[] = [];
  let pos = from;
  const textUntil = (end: number): void => {
    if (end > pos) out.push(document.createTextNode(src.slice(pos, end)));
  };
  for (const child of children(parent)) {
    if (child.to <= from || child.from >= to) continue;
    textUntil(Math.max(child.from, from));
    pos = Math.max(pos, child.from);
    out.push(...inlineNode(src, child));
    pos = Math.min(Math.max(pos, child.to), to);
  }
  textUntil(to);
  return out;
}

function text(src: string, node: SyntaxNode): Node[] {
  return [document.createTextNode(src.slice(node.from, node.to))];
}

const labelKey = (label: string): string => label.trim().replace(/\s+/g, ' ').toLowerCase();

function destination(src: string, node: SyntaxNode): string {
  const raw = src.slice(node.from, node.to);
  return linkDestination(raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw);
}

// The link definitions ("[label]: url") of a document, by normalized label.
export function referenceTargets(source: string): Map<string, string> {
  const found = new Map<string, string>();
  gfm.parse(source).iterate({
    enter: entered => {
      if (entered.name !== 'LinkReference') return;
      const kids = children(entered.node);
      const label = kids.find(kid => kid.name === 'LinkLabel');
      const url = kids.find(kid => kid.name === 'URL');
      const key = label ? labelKey(source.slice(label.from + 1, label.to - 1)) : '';
      if (key && url && !found.has(key)) found.set(key, destination(source, url));
    },
  });
  return found;
}

// The definitions of the reply being drawn. Set by renderMarkdown before anything is drawn.
let references = new Map<string, string>();

function link(src: string, node: SyntaxNode): Node[] {
  const kids = children(node);
  const marks = kids.filter(kid => kid.name === 'LinkMark');
  if (marks.length < 2) return text(src, node);
  const url = kids.find(kid => kid.name === 'URL');
  let target: string | undefined;
  if (url) target = destination(src, url);
  else {
    const reference = kids.find(kid => kid.name === 'LinkLabel');
    const inner = reference ? src.slice(reference.from + 1, reference.to - 1) : '';
    target = references.get(labelKey(inner || src.slice(marks[0].to, marks[1].from)));
  }
  if (target === undefined) return text(src, node);
  const href = safeLink(target);
  const label = inline(src, node, marks[0].to, marks[1].from);
  if (!href) return label.length ? label : text(src, node);
  const anchor = el('a', ...(label.length ? label : [href]));
  anchor.setAttribute('href', href);
  return [anchor];
}

function inlineNode(src: string, node: SyntaxNode): Node[] {
  switch (node.name) {
    case 'Emphasis': return [el('em', ...inline(src, node))];
    case 'StrongEmphasis': return [el('strong', ...inline(src, node))];
    case 'Strikethrough': return [el('del', ...inline(src, node))];
    case 'InlineCode': return [el('code', ...inline(src, node))];
    case 'Link': return link(src, node);
    case 'Autolink': {
      const url = children(node).find(kid => kid.name === 'URL');
      return url ? inlineNode(src, url) : text(src, node);
    }
    case 'URL': {
      const raw = src.slice(node.from, node.to);
      const href = safeLink(raw);
      if (!href) return text(src, node);
      const anchor = el('a', raw);
      anchor.setAttribute('href', href);
      return [anchor];
    }
    case 'Escape': return [document.createTextNode(src.slice(node.from + 1, node.to))];
    case 'Entity': return [document.createTextNode(decodeEntity(src.slice(node.from, node.to)))];
    case 'HardBreak': return [el('br')];
    case 'Task': return inline(src, node);
    case 'TaskMarker': {
      const box = el('input');
      box.type = 'checkbox';
      box.disabled = true;
      box.checked = /x/i.test(src.slice(node.from, node.to));
      return [box, document.createTextNode(' ')];
    }
    case 'Image': return text(src, node);
    default:
      // Marks are dropped. Raw HTML tags, comments and anything unknown stay as written.
      return MARKS.has(node.name) ? [] : text(src, node);
  }
}

function codeBlock(language: string, code: string): HTMLElement {
  const body = el('code');
  const runs = highlightRuns(language, code);
  let pos = 0;
  for (const run of runs) {
    if (run.from < pos) continue;
    if (run.from > pos) body.append(code.slice(pos, run.from));
    const span = el('span', code.slice(run.from, run.to));
    span.dataset.syntaxToken = run.category;
    body.append(span);
    pos = run.to;
  }
  if (pos < code.length) body.append(code.slice(pos));
  const block = el('pre', body);
  block.className = 'chat-code';
  return block;
}

function fencedParts(src: string, node: SyntaxNode): { language: string; code: string } {
  const kids = children(node);
  const info = kids.find(kid => kid.name === 'CodeInfo');
  const code = joinCodeSegments(kids.filter(kid => kid.name === 'CodeText').map(kid => src.slice(kid.from, kid.to)));
  return { language: info ? languageName(src.slice(info.from, info.to)) : '', code: code && code !== '\n' ? `${code}\n` : code };
}

// The language and text of every fenced code block in a document, however deeply nested.
export function fencedCode(source: string): { language: string; code: string }[] {
  const found: { language: string; code: string }[] = [];
  gfm.parse(source).iterate({ enter: node => { if (node.name === 'FencedCode') found.push(fencedParts(source, node.node)); } });
  return found;
}

function fenced(src: string, node: SyntaxNode): Node[] {
  const { language, code } = fencedParts(src, node);
  return [codeBlock(language, code)];
}

function indented(src: string, node: SyntaxNode): Node[] {
  const lines = children(node).filter(kid => kid.name === 'CodeText').map(kid => src.slice(kid.from, kid.to));
  return [codeBlock('', `${lines.join('\n')}\n`)];
}

function tableRow(src: string, row: SyntaxNode, cell: 'th' | 'td'): HTMLElement {
  const tr = el('tr');
  for (const kid of children(row)) {
    if (kid.name !== 'TableCell') continue;
    const item = el(cell, ...inline(src, kid));
    if (cell === 'th') item.setAttribute('scope', 'col');
    tr.append(item);
  }
  return tr;
}

function table(src: string, node: SyntaxNode): Node[] {
  const head = el('thead');
  const body = el('tbody');
  for (const kid of children(node)) {
    if (kid.name === 'TableHeader') head.append(tableRow(src, kid, 'th'));
    else if (kid.name === 'TableRow') body.append(tableRow(src, kid, 'td'));
  }
  const wrap = el('div', el('table', head, body));
  wrap.className = 'chat-table-scroll';
  return [wrap];
}

function heading(src: string, node: SyntaxNode, level: number): Node[] {
  const underline = node.name.startsWith('Setext') ? children(node).find(kid => kid.name === 'HeaderMark') : undefined;
  const tag = (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const)[Math.min(Math.max(level, 1), 6) - 1];
  return [el(tag, ...inline(src, node, node.from, underline ? underline.from : node.to))];
}

function blocks(src: string, parent: SyntaxNode): Node[] {
  return children(parent).flatMap(child => blockNode(src, child));
}

function blockNode(src: string, node: SyntaxNode): Node[] {
  const level = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
  if (level) return heading(src, node, Number(level[1]));
  switch (node.name) {
    case 'Paragraph': return [el('p', ...inline(src, node))];
    case 'FencedCode': return fenced(src, node);
    case 'CodeBlock': return indented(src, node);
    case 'Blockquote': return [el('blockquote', ...blocks(src, node))];
    case 'BulletList': return [el('ul', ...blocks(src, node))];
    case 'OrderedList': return [el('ol', ...blocks(src, node))];
    case 'ListItem': return [el('li', ...blocks(src, node))];
    case 'HorizontalRule': return [el('hr')];
    case 'Table': return table(src, node);
    default: {
      if (RAW_BLOCKS.has(node.name)) {
        const raw = el('p', src.slice(node.from, node.to));
        raw.className = 'chat-raw';
        return [raw];
      }
      return MARKS.has(node.name) ? [] : text(src, node);
    }
  }
}

// File mentions in a drawn reply: plain text and inline code, but not code blocks and not existing links.
function mentionSpots(root: ParentNode, visit: (spot: Text | HTMLElement) => void): void {
  const walk = (parent: ParentNode): void => {
    for (const child of [...parent.childNodes]) {
      if (child instanceof Text) visit(child);
      else if (child instanceof HTMLElement && !['A', 'PRE', 'INPUT'].includes(child.tagName)) {
        if (child.tagName === 'CODE') visit(child); else walk(child);
      }
    }
  };
  walk(root);
}

// The paths of the mentions in a drawn reply, without duplicates.
export function mentionPaths(root: ParentNode): string[] {
  const found = new Set<string>();
  mentionSpots(root, spot => {
    const text = spot.textContent || '';
    if (spot instanceof Text) findFileRefs(text).forEach(entry => found.add(entry.ref.path));
    else {
      const ref = wholeFileRef(text);
      if (ref) found.add(ref.path);
    }
  });
  return [...found];
}

// A focusable link to a file. The page opens it; the href is only there so that the browser treats it as a link.
export function fileLink(file: string, ref: FileRef, ...kids: (Node | string)[]): HTMLAnchorElement {
  const anchor = el('a', ...kids);
  anchor.className = 'chat-file-link';
  anchor.setAttribute('href', '#');
  anchor.dataset.file = file;
  if (ref.line !== undefined) anchor.dataset.line = String(ref.line);
  if (ref.column !== undefined) anchor.dataset.column = String(ref.column);
  return anchor;
}

// Turns the mentions whose path was found (path -> absolute file) into links. The rest stays text.
export function linkMentions(root: ParentNode, resolved: Map<string, string | null>): void {
  mentionSpots(root, spot => {
    const text = spot.textContent || '';
    if (spot instanceof Text) {
      const pieces: Node[] = [];
      let pos = 0;
      for (const entry of findFileRefs(text)) {
        const file = resolved.get(entry.ref.path);
        if (!file) continue;
        if (entry.from > pos) pieces.push(document.createTextNode(text.slice(pos, entry.from)));
        pieces.push(fileLink(file, entry.ref, text.slice(entry.from, entry.to)));
        pos = entry.to;
      }
      if (pieces.length === 0) return;
      if (pos < text.length) pieces.push(document.createTextNode(text.slice(pos)));
      spot.replaceWith(...pieces);
    } else {
      const ref = wholeFileRef(text);
      const file = ref ? resolved.get(ref.path) : null;
      if (!ref || !file) return;
      spot.replaceWith(fileLink(file, ref, spot.cloneNode(true)));
    }
  });
}

// The nodes for a whole reply. The same text always gives the same nodes, which is what makes
// the last streamed render equal the render of the complete text.
export function renderMarkdown(source: string): Node[] {
  references = referenceTargets(source);
  return blocks(source, gfm.parse(source).topNode);
}
