# Story #29 developer contract

Story: Start screen with Zed-like quick actions in an empty workspace.
Requirements: WS2, D12, D13, O1.1, O2.1.
Branch: tests/29-start-screen.
QA owns tests/e2e/ws2-start-screen.spec.ts, this contract and tests/fixtures/zed-welcome/.
The developer owns application implementation under src/ and must preserve test assertions.

## Acceptance criteria and coverage

| AC | Required behavior and test coverage |
| --- | --- |
| AC1 | Empty workspace has Get Started with exactly Open Folder, Open Recent and New Claude Chat, visible bindings and Recent; clean profile starts with zero recents; six UI additions produce five most recent entries in a new empty workspace |
| AC2 | Keyboard and click Open Folder each add the selected folder to the same empty workspace, opening the project panel without an extra workspace |
| AC3 | Six folders added through the UI survive a real app restart in the same isolated profile; workspaces start empty; picker orders all six most recent first, typing quarry filters to one, Enter adds it to the active workspace; shortcuts 1 through 5 each open the displayed entry in a new empty workspace |
| AC4 | Keyboard and click New Claude Chat replace the start screen with the existing chat view in the active workspace and focus Message Claude |
| AC5 | Add Folder button is absent even in an empty open project panel; Add Folder to Project shortcut adds a second root to the same populated workspace |
| AC6 | Open Folder in a populated workspace adds a new selected workspace tab, containing only the selected folder; switching back retains the original folder; one Electron window remains |

## Keys

Use the pinned default keymaps, not a guessed Ctrl-O on Linux.
macOS: Cmd-O, Alt-Cmd-O, Cmd-N, Cmd-Shift-A, Cmd-1 through Cmd-5.
Linux: Ctrl-K Ctrl-O (two strokes), Alt-Ctrl-O, Ctrl-N, Ctrl-Shift-A, Ctrl-1 through Ctrl-5.
The Linux workspace::Open chord is in the global and Workspace contexts.
New Claude Chat is the story's intentional replacement for Welcome's workspace::NewFile action.
The existing new-workspace and next/previous/close shortcuts remain unchanged.

## UI contract

Reuse workspace-area, workspace-tab (role tab and aria-selected), data-workspace-id, project-panel, project-root with data-path, and claude-chat with data-workspace-id.
All paths are absolute canonical paths, as used by the existing project panel tests.
Add start-screen inside the visible workspace-area.
Get Started and Recent each have role list and their exact accessible names; their children have role listitem.
Each Get Started action is a button with the exact accessible name Open Folder, Open Recent or New Claude Chat.
Keep the displayed shortcut inside that button with data-testid=start-action-keybinding, and set aria-label to the action name so shortcut text does not change its accessible name.
Tests expect ASCII labels Cmd-O, Alt-Cmd-O, Cmd-N on macOS and Ctrl-K Ctrl-O, Alt-Ctrl-O, Ctrl-N on Linux.
Recent entries use data-testid=recent-folder and data-path, and show the folder basename.
Recent stays visible as an empty list in a clean profile.
The recent picker has role dialog with accessible name Open Recent, a focused textbox named Search recent folders, and role option rows with data-path in visible order.
The chat reuses the textbox named Message Claude.
Remove project-add-folder and every visible Add Folder button from the project panel.
No app-internal state injection or recent-file schema is needed by these tests.

## Native dialog and persistence boundary

Reuse COD_TEST_PICK_FOLDERS for Open Folder and Add Folder to Project.
It is a queue of arrays, one consumed per native folder dialog invocation.
Keep this override at the native dialog boundary; all production dispatch, folder state, persistence and rendering still run.
AC3 relaunches real Electron against the same COD_USER_DATA_DIR and never writes the recent store itself.
The profile and real git fixture repos are isolated per test and deleted after teardown.
Use the existing fake Claude binary; no live agent calls are needed.

## Zed look check and scope

The byte-for-byte reference is tests/fixtures/zed-welcome/welcome.rs at Zed v1.23.2 commit c0199504b9cce79bc27524950022ed701bc3ebd5, with attribution in its README.
Follow centered section lists, quiet labels and adjacent keybindings on the editor background.
AC1 captures a Cod screenshot for the early look check, but that alone does not establish visual parity.
Provide the Cod screen next to stock Zed 1.23.2 with default settings before building the rest of the feature.
No stock Zed or Electron launch was performed by QA in the sandbox.
Configure, Clone Repository, New File, command palette and workspace persistence are out of scope.
The unanswered product default is that the start screen fills an empty main area again after the chat closes; a chat-close command is not specified here and no invented command is imposed by the tests.

## Existing suite migration

Existing chat tests explicitly open an empty workspace's chat with Cmd-N or Ctrl-N before exercising chat behavior.
Existing project, editor and finder tests use Add Folder to Project instead of the removed Add Folder button.
Finder focus restoration uses the project panel as the previous focus target.
Workspace identity tests open the chat before checking its workspace identity, preserving that assertion.
Behavioral assertions for streaming, permissions, editor buffers, root isolation and focus restoration remain in place.
Shared helpers and fake Claude files need no changes.

## Validation and hand-back

No Electron or browser tests ran during authoring.
Expected missing-feature failures are hypotheses from source inspection, not observed assertion output.
AC1, AC2, AC3, AC4 and AC6 first require the missing start screen.
AC5 first checks removal of the existing Add Folder button.
A launch, fixture or selector failure is not the correct red baseline and must be repaired by QA.
The developer must return the implementation commit/PR, unchanged acceptance tests, measured per-criterion results, Linux CI evidence and the early look comparison.
QA will judge the actual red output before implementation starts.

Run outside the sandbox on macOS from this worktree root:

```sh
mkdir -p artifacts/29
caffeinate -dimsu npm run test:e2e -- tests/e2e/ws2-start-screen.spec.ts --reporter=list > artifacts/29/run.txt 2>&1
```

npm run test:e2e includes the build through pretest:e2e.
Return artifacts/29/run.txt to QA for the measured verdict.
After implementation, run the full suite outside the sandbox:

```sh
caffeinate -dimsu npm run test:e2e -- --reporter=list > artifacts/29/full-suite.txt 2>&1
```

## Authoring checks and commit limitation

npm run typecheck passed after all tests and entry-step migrations were written.
Playwright --list collected exactly six story #29 tests without launching Electron.
git diff --check passed.
The sandbox denied creation of /Users/butvinm/Dev/cod/.git/worktrees/tests-29/index.lock during git add, so no commit was created and nothing was pushed.
Commit outside this sandbox with these specific paths:

```sh
git add tests/e2e/ws2-start-screen.spec.ts tests/e2e/contracts/29-start-screen.md tests/fixtures/zed-welcome/welcome.rs tests/fixtures/zed-welcome/README.md tests/e2e/a1-claude-chat.spec.ts tests/e2e/a4-permissions.spec.ts tests/e2e/c1-close-dirty.spec.ts tests/e2e/c1-editor.spec.ts tests/e2e/c1-file-finder.spec.ts tests/e2e/ws1-workspace-tabs.spec.ts tests/e2e/ws2-project-panel.spec.ts
git commit -m 'Add acceptance tests for #29 start screen and migrate entry steps'
```
