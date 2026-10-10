// The only module that touches CodeMirror. esbuild bundles it to dist/editor-cm.js (see scripts/build-editor.mjs).
// It exposes one global, CodEditor, so the rest of the renderer stays plain JS.
import { EditorState, RangeSetBuilder } from '@codemirror/state';
import { lockExtension, lockEffect, withLocked } from './editor-lock.mjs';
import { EditorView, Decoration, ViewPlugin, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxTree, ensureSyntaxTree, indentUnit, bracketMatching } from '@codemirror/language';
import { highlightTree, tagHighlighter, tags as t } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { go } from '@codemirror/lang-go';
import { rust } from '@codemirror/lang-rust';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';

// Zed 1.23.2 One Dark values (tests/fixtures/zed-themes/one.json).
const colors = {
  background: '#282c33',
  foreground: '#acb2be',
  lineNumber: '#4e5a5f',
  activeLineNumber: '#d0d4da',
  activeLine: '#2f343ebf',
  cursor: '#74ade8',
  selection: '#74ade83d',
};

const languages = {
  ts: () => javascript({ typescript: true }),
  mts: () => javascript({ typescript: true }),
  cts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  js: () => javascript(),
  mjs: () => javascript(),
  cjs: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  py: () => python(),
  go: () => go(),
  rs: () => rust(),
  md: () => markdown(),
  markdown: () => markdown(),
  json: () => json(),
};

function languageFor(file) {
  const dot = file.lastIndexOf('.');
  const make = dot < 0 ? null : languages[file.slice(dot + 1).toLowerCase()];
  return make ? [make()] : [];
}

// Lezer tags to the syntax categories of Zed's One Dark theme.
// Child tags (controlKeyword, lineComment, ...) fall back to these parents.
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
  { tag: t.heading, class: 'title' },
  { tag: t.strong, class: 'emphasis.strong' },
  { tag: t.emphasis, class: 'emphasis' },
  { tag: t.link, class: 'link_text' },
  { tag: t.url, class: 'link_uri' },
  { tag: t.list, class: 'punctuation.list_marker' },
  { tag: t.quote, class: 'string' },
  { tag: t.monospace, class: 'text.literal' },
  { tag: [t.contentSeparator, t.processingInstruction], class: 'punctuation.markup' },
]);

// Marks every highlighted run with its One Dark category. The colors live in editor.css.
function tokenDecorations(view) {
  const builder = new RangeSetBuilder();
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    highlightTree(tree, highlighter, (start, end, cls) => {
      const category = cls.split(' ')[0];
      if (!category || !view.state.sliceDoc(start, end).trim()) return;
      builder.add(start, end, Decoration.mark({ attributes: { 'data-testid': 'editor-syntax-token', 'data-syntax-token': category } }));
    }, from, to);
  }
  return builder.finish();
}

const highlighting = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = tokenDecorations(view); }
  update(update) {
    if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
      this.decorations = tokenDecorations(update.view);
    }
  }
}, { decorations: plugin => plugin.decorations });

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: colors.background, color: colors.foreground },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.618', overflow: 'auto' },
  '.cm-content': { fontFamily: 'Lilex, ui-monospace, Menlo, monospace', fontSize: '15px', color: colors.foreground, caretColor: colors.cursor, padding: '0' },
  '.cm-line': { padding: '0 0 0 6px' },
  '.cm-gutters': { backgroundColor: colors.background, color: colors.lineNumber, border: 'none', fontFamily: 'Lilex, ui-monospace, Menlo, monospace', fontSize: '15px' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px' },
  '.cm-activeLine': { backgroundColor: colors.activeLine },
  '.cm-activeLineGutter': { backgroundColor: colors.activeLine, color: colors.activeLineNumber },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: colors.cursor, borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: colors.selection },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: '#74ade81a', outline: 'none' },
}, { dark: true });

// The page's CSP allows <style> elements with this nonce, which is how CodeMirror injects its own styles.
const nonce = EditorView.cspNonce.of('cod-editor');

// editFilter is a transaction filter that drops edits while a close or quit is under way.
function create({ parent, onChange, editFilter }) {
  // locked: build the state already read-only, for buffers opened while a close or quit is under way.
  const view = new EditorView({ parent, state: EditorState.create({ doc: '', extensions: [nonce] }) });
  return {
    // A fresh buffer for one file. Each tab keeps its own state, so undo history survives tab switches.
    stateFor(file, text, locked = false) {
      // The main process hands over text with "\n" line breaks and restores the file's own on save.
      const state = EditorState.create({
        doc: text,
        extensions: [
          EditorState.tabSize.of(4),
          indentUnit.of('    '),
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          bracketMatching(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          languageFor(file),
          highlighting,
          theme,
          nonce,
          EditorState.transactionFilter.of(editFilter),
          lockExtension(locked),
          EditorView.contentAttributes.of({ 'data-testid': 'editor-content', 'aria-label': 'Editor', spellcheck: 'false' }),
          EditorView.updateListener.of(update => { if (update.docChanged) onChange(update.state); }),
        ],
      });
      // Parse everything up front so the first paint is fully highlighted.
      if (state.doc.length < 1_000_000) ensureSyntaxTree(state, state.doc.length, 500);
      return state;
    },
    setState(state) { view.setState(state); },
    // Switches the shown buffer between editable and read-only, and returns its new state.
    lockView(locked) { view.dispatch({ effects: lockEffect(locked) }); return view.state; },
    // The same for a buffer that is not shown.
    lockState(state, locked) { return withLocked(state, locked); },
    getState() { return view.state; },
    focus() { view.focus(); },
    hasFocus() { return view.hasFocus; },
  };
}

// The document text, with "\n" line breaks.
function textOf(state) {
  return state.sliceDoc(0, state.doc.length);
}

globalThis.CodEditor = { create, textOf };
