// The read-only switch of one buffer. While a close or quit is under way every edit is refused,
// and so are Undo and Redo, because the history commands check state.readOnly.
import { Compartment, EditorState, type Extension, type StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export const lockCompartment = new Compartment();

const configFor = (locked: boolean): Extension => (locked ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []);

export const lockExtension = (locked: boolean): Extension => lockCompartment.of(configFor(locked));

// The effect that switches an existing state or view.
export const lockEffect = (locked: boolean): StateEffect<unknown> => lockCompartment.reconfigure(configFor(locked));

// A copy of the state with the lock on or off. It does not change the document.
export const withLocked = (state: EditorState, locked: boolean): EditorState => state.update({ effects: lockEffect(locked) }).state;
