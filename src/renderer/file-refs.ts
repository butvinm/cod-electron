// File paths written in a reply: `src/a.ts`, `src/a.ts:12`, `src/a.ts:12:5`, `../x.ts`, `/abs/x.ts`.
// This only finds text that looks like a path. Whether the file exists is decided by the main process.

export interface FileRef {
  // The path as written, without the line and column.
  path: string;
  line?: number;
  column?: number;
}

export interface FoundRef {
  from: number;
  to: number;
  ref: FileRef;
}

const SOURCE = String.raw`(?:\/|\.{1,2}\/)?(?:[\w@+.-]+\/)*[\w@+-][\w@+.-]*\.[A-Za-z0-9]+(?::\d+(?::\d+)?)?(?![\w/])`;
const FIND = new RegExp(String.raw`(?<![\w@./:+-])${SOURCE}`, 'g');
const WHOLE = new RegExp(`^${SOURCE}$`);

function refOf(text: string): FileRef {
  const match = /^(.*?)(?::(\d+)(?::(\d+))?)?$/.exec(text) as RegExpExecArray; // always matches
  const ref: FileRef = { path: match[1] };
  if (match[2] !== undefined) ref.line = Number(match[2]);
  if (match[3] !== undefined) ref.column = Number(match[3]);
  return ref;
}

// The path mentions inside a piece of text, in order.
export function findFileRefs(text: string): FoundRef[] {
  return [...text.matchAll(FIND)].map(match => ({ from: match.index, to: match.index + match[0].length, ref: refOf(match[0]) }));
}

// The mention that is the whole text (an inline code span), or null.
export function wholeFileRef(text: string): FileRef | null {
  return WHOLE.test(text) ? refOf(text) : null;
}
