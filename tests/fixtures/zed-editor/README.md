# Story #5 offline Zed reference

Reference version: stock Zed v1.23.2, default settings and keymap.
Reference facts below use the local researcher handoff in artifacts/5/zed-answers.md and the pinned files.
No new network research was performed during this update.

## Pinned sources

| Source | Local pin | Source URL | Git blob SHA |
| --- | --- | --- | --- |
| macOS keymap | ../zed-keymaps/default-macos.json | https://raw.githubusercontent.com/zed-industries/zed/v1.23.2/assets/keymaps/default-macos.json | 38ce1ab5aad9ae99a24cf22f1b13f7ad174cdc86 |
| Linux keymap | ../zed-keymaps/default-linux.json | https://raw.githubusercontent.com/zed-industries/zed/v1.23.2/assets/keymaps/default-linux.json | 8f05d55e2ac8569e95bfaddd02147ad590254540 |
| One Dark theme | ../zed-themes/one.json | https://raw.githubusercontent.com/zed-industries/zed/v1.23.2/assets/themes/one/one.json | 698b8febceaf53daa45fb98eda61b1c35a8d59c6 |

The full settings file is pinned byte-for-byte as [default-settings.json](default-settings.json).
Source URL: https://raw.githubusercontent.com/zed-industries/zed/v1.23.2/assets/settings/default.json.
Source commit SHA: c0199504b9cce79bc27524950022ed701bc3ebd5 (tag v1.23.2).
This upstream file contains comments and trailing commas, so it is JSONC despite its .json extension.
Do not parse it with JSON.parse or reformat it.

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
Mouse word-selection behavior is confirmed in crates/editor/src/selection.rs lines 1248-1256: two clicks select the surrounding word.

## Resolved reference facts and PM decisions

All source links in this section use tag v1.23.2 at commit c0199504b9cce79bc27524950022ed701bc3ebd5.

- AC1: settings lines 29-41 define buffer_font_family as .ZedMono, documented as an alias for Lilex, and buffer_font_size as 15.
  Linux and macOS override blocks are empty (lines 2885-2887), so these values apply on both platforms.
  PM decision: assert computed font-family contains Lilex and font-size is 15px.
  Source: https://github.com/zed-industries/zed/blob/v1.23.2/assets/settings/default.json#L29.
- AC3: dirty tabs use Indicator::dot with Color::Accent; clean tabs have no indicator.
  Dot dimensions are 0.375rem, or 6px at 16px rem, with fully rounded corners and a filled background.
  Color::Accent maps to theme.colors().text_accent, represented by text.accent in the pinned One Dark theme, not the theme's modified token.
  The indicator occupies the tab start slot left of the label with the default close_position right; the close button occupies the end slot.
  AC3 asserts visible presence, 6px geometry, circular corners, accent fill, placement left of the label, and absence after saving to disk.
  Sources: https://github.com/zed-industries/zed/blob/v1.23.2/crates/workspace/src/pane.rs#L5043, https://github.com/zed-industries/zed/blob/v1.23.2/crates/ui/src/components/indicator.rs#L73, https://github.com/zed-industries/zed/blob/v1.23.2/crates/ui/src/styles/color.rs#L105, https://github.com/zed-industries/zed/blob/v1.23.2/crates/workspace/src/pane.rs#L2999 and https://github.com/zed-industries/zed/blob/v1.23.2/crates/ui/src/components/tab.rs#L127.
- AC4: closing a dirty file prompts with "<path> contains unsaved edits. Do you want to save it?" using the project-relative path.
  Zed's custom prompt renders the path as markdown inline code, so the visible text has no literal backticks.
  Buttons are Save, Don't Save, Cancel, vertically stacked in that order.
  Save is highlighted initially; Enter confirms the highlighted choice, Escape cancels, Up/Down and Tab/Shift+Tab move the highlight and wrap.
  The active button is Tinted(Accent), and the others are Outlined.
  AC4 checks visible background differentiation as well as the highlighted state, all three Enter outcomes, Escape from Don't Save, and keyboard navigation including wrapping.
  PM exception: use this in-window prompt on both platforms, even though stock Zed normally uses a native macOS prompt when use_system_prompts is true.
  Sources: https://github.com/zed-industries/zed/blob/v1.23.2/crates/workspace/src/pane.rs#L2390, https://github.com/zed-industries/zed/blob/v1.23.2/crates/workspace/src/pane.rs#L5020 and https://github.com/zed-industries/zed/blob/v1.23.2/crates/ui_prompt/src/ui_prompt.rs#L20 (default choice at L46, actions at L66-108, layout at L141-155).
- AC4: reopening an existing file activates its existing tab without creating a duplicate.
  Default activate_on_close is history, which selects the most recently active remaining tab.
  AC4 opens three clean tabs, revisits the first then the third, closes the third, and requires the first to become active, rather than the adjacent second.
  PM exception: preview tabs are out of scope for #5; project-panel opens produce normal tabs without needing an edit to make them permanent.
  The existing #4 Enter-to-open exception remains in the project-panel helper.
  Stock Zed uses preview opens for project-panel single click/Space and Enter for rename.
  Sources: https://github.com/zed-industries/zed/blob/v1.23.2/assets/settings/default.json#L1469, https://github.com/zed-industries/zed/blob/v1.23.2/crates/workspace/src/pane.rs#L1083, https://github.com/zed-industries/zed/blob/v1.23.2/crates/workspace/src/pane.rs#L2150 and https://github.com/zed-industries/zed/blob/v1.23.2/crates/project_panel/src/project_panel.rs#L6416.
- AC2: double click selects the surrounding word; Alt+Up/Down move lines on both platforms; Cmd+/ on macOS and Ctrl+/ on Linux toggle comments with advance_downwards=false and comment_empty_lines=true.
  Sources: https://github.com/zed-industries/zed/blob/v1.23.2/crates/editor/src/selection.rs#L1248, https://github.com/zed-industries/zed/blob/v1.23.2/assets/keymaps/default-linux.json#L544 and https://github.com/zed-industries/zed/blob/v1.23.2/assets/keymaps/default-macos.json#L580.

## Test-visible UI contract

The existing editor test IDs and data-path attributes remain required.
The in-window editor-save-prompt contains role=button elements with accessible names Save, Don't Save, Cancel.
Expose data-highlighted="true" on the current choice only (others may omit it or set it to false).
This is a read-only rendering-state attribute for QA, not a way to choose a prompt result.
The test also checks that the highlighted choice has a different computed background from the other choices.
All prompt actions are driven through the real keyboard.

## Remaining unverified comparisons

1. Exact grammar scope assignment for individual lexemes in all seven languages still needs a stock Zed comparison; the automated checks verify rendered syntax categories against the pinned theme and require multiple colors.
2. The complete TypeScript screen look still needs comparison with stock Zed at the same window size; AC1 attaches a screenshot for that check.
3. Exact line-move and comment-toggle output on the invented AC2 samples has not been compared with stock Zed; the bindings and parameters are verified, and the existing output assertions remain.

The researcher's native macOS NSAlert visual order, literal backticks and automatic Cmd-D questions do not apply to #5's in-window prompt exception and are not blocking questions for this story.
Do not infer full visual or grammar parity from a green automated run alone.

Zed license: https://github.com/zed-industries/zed/blob/v1.23.2/LICENSE-GPL.
