# Story #5 offline Zed reference

Reference version: stock Zed v1.23.2, default settings and keymap.
This handoff has no network access.
Only the already pinned sources below are treated as verified reference data.

## Verified sources reused without changes

| Source | Local pin | Source URL | Git blob SHA |
| --- | --- | --- | --- |
| macOS keymap | ../zed-keymaps/default-macos.json | https://raw.githubusercontent.com/zed-industries/zed/v1.23.2/assets/keymaps/default-macos.json | 38ce1ab5aad9ae99a24cf22f1b13f7ad174cdc86 |
| Linux keymap | ../zed-keymaps/default-linux.json | https://raw.githubusercontent.com/zed-industries/zed/v1.23.2/assets/keymaps/default-linux.json | 8f05d55e2ac8569e95bfaddd02147ad590254540 |
| One Dark theme | ../zed-themes/one.json | https://raw.githubusercontent.com/zed-industries/zed/v1.23.2/assets/themes/one/one.json | 698b8febceaf53daa45fb98eda61b1c35a8d59c6 |

The AC1 test reads editor.background, editor.foreground and syntax.<category>.color directly from the One Dark theme.
It checks real rendered source spans against those colors and requires at least two distinct foreground colors per language.
The theme pins the color vocabulary, not the grammar's assignment of scopes to individual lexemes.
Exact grammar scope parity still needs a stock Zed comparison.

## Verified bindings used by AC2, AC3 and AC4

| Action | macOS pinned stroke | Linux pinned stroke | Action in pinned map |
| --- | --- | --- | --- |
| Undo | cmd-z | ctrl-z | editor::Undo |
| Redo | cmd-shift-z | ctrl-shift-z | editor::Redo |
| Select all | cmd-a | ctrl-a | editor::SelectAll |
| Copy | cmd-c | ctrl-c | editor::Copy |
| Cut | cmd-x | ctrl-x | editor::Cut |
| Paste | cmd-v | ctrl-v | editor::Paste |
| Select left | shift-left | shift-left | editor::SelectLeft |
| Select right | shift-right | shift-right | editor::SelectRight |
| Select up | shift-up | shift-up | editor::SelectUp |
| Select down | shift-down | shift-down | editor::SelectDown |
| Move line up | alt-up | alt-up | editor::MoveLineUp |
| Move line down | alt-down | alt-down | editor::MoveLineDown |
| Toggle comments | cmd-/ | ctrl-/ | editor::ToggleComments |
| Save | cmd-s | ctrl-s | workspace::Save |
| Close active tab | cmd-w | ctrl-w | pane::CloseActiveItem |

ToggleComments has advance_downwards=false and comment_empty_lines=true on both platforms.
CloseActiveItem has close_pinned=false on both platforms.
Editing bindings use Editor contexts; Save and CloseActiveItem also occur in workspace or pane contexts.
Linux additionally provides Ctrl+Y for redo; this test chooses the pinned Ctrl+Shift+Z binding.
Mouse selection is tested by double-clicking a rendered word and replacing the selection.
The keymaps do not verify mouse selection granularity.

## Open questions for the PM

1. AC1: What is the default buffer_font_size in this exact release, including any platform difference? The existing settings pin contains project-panel values only. Candidate source to fetch and pin: https://github.com/zed-industries/zed/blob/v1.23.2/assets/settings/default.json. No size is guessed and no font-size assertion is enabled. AC1 cannot receive a full PASS until the verified value is pinned and asserted.
2. AC3: What is the unsaved tab indicator's shape, color and placement? The theme has a modified token, but this does not prove the tab uses it. Presence before save and absence after save are asserted. The screenshot requires comparison against stock Zed before appearance parity can receive PASS. Candidate source to inspect: https://github.com/zed-industries/zed/tree/v1.23.2/crates/editor/src and https://github.com/zed-industries/zed/tree/v1.23.2/crates/workspace/src.
3. AC4: What are the save prompt's native/custom implementation, labels, default focus, button order and platform keyboard behavior? The pinned maps verify the close action, not the prompt. The proposed DOM contract uses Save, Discard and Cancel from the story and finds each button by keyboard Tab followed by Enter. It does not assert Zed's unverified default ordering or mnemonics. If parity requires a native OS prompt, agree an OS-dialog-result hook and revise the interaction test with QA before implementation. Candidate source to inspect: https://github.com/zed-industries/zed/tree/v1.23.2/crates/workspace/src.
4. AC4: Verify opening an existing tab and the default preview-tab lifecycle. The test first edits and saves a file before asserting that opening another file leaves two durable tabs. It does not specify clean preview-tab replacement, adjacent-tab choice with more than one remaining tab, or pinned-tab behavior. Candidate settings source is the default.json URL above.
5. AC2: Verify stock Zed's mouse word-selection behavior and line-move/comment examples using these invented samples. The pinned maps prove the action assignments, not every action's output.

These URLs are research targets, not claims that their contents were read in this session.
Do not mark the unresolved parts of AC1, AC2, AC3 or AC4 as Zed parity PASS from a green automated run alone.

Zed license: https://github.com/zed-industries/zed/blob/v1.23.2/LICENSE-GPL.
