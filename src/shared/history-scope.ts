// Cmd-G / Ctrl-G is Zed's ToggleThreadHistory in the threads sidebar only. In an editor it is
// search::SelectNextMatch, so Cod takes the key only when focus is in the chat or in the open session picker.
export function historyKeyApplies(focused: { closest(selector: string): unknown } | null): boolean {
  return focused !== null && focused.closest('.claude-chat, [data-testid="claude-session-picker"]') !== null;
}
