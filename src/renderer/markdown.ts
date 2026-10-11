// Draws markdown text as DOM nodes. The text comes from a model, so it is never parsed as HTML:
// every node here is created with createElement and createTextNode, and raw HTML in the
// markdown stays visible as text. The parser is @lezer/markdown with the GitHub extensions.
import { parser, GFM } from '@lezer/markdown';
import { highlightRuns, languageName, decodeEntity, safeLink } from './markdown-code.ts';

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

function link(src: string, node: SyntaxNode): Node[] {
  const kids = children(node);
  const marks = kids.filter(kid => kid.name === 'LinkMark');
  const url = kids.find(kid => kid.name === 'URL');
  const href = url ? safeLink(src.slice(url.from, url.to)) : null;
  if (marks.length < 2 || !url) return text(src, node);
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

function fenced(src: string, node: SyntaxNode): Node[] {
  const kids = children(node);
  const info = kids.find(kid => kid.name === 'CodeInfo');
  const body = kids.find(kid => kid.name === 'CodeText');
  const code = body ? src.slice(body.from, body.to) : '';
  return [codeBlock(info ? languageName(src.slice(info.from, info.to)) : '', code ? `${code}\n` : '')];
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

// The nodes for a whole reply. The same text always gives the same nodes, which is what makes
// the last streamed render equal the render of the complete text.
export function renderMarkdown(source: string): Node[] {
  return blocks(source, gfm.parse(source).topNode);
}
