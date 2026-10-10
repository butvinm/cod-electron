# Story #3 developer handoff

Story: https://github.com/butvinm/cod/issues/3 - Cod window with workspace tabs.

QA owns the tests, fixtures and harness on `tests/3-workspace-tabs`. No app code is included.

## App launch contract

`npm start` runs `electron .`. The Electron test helper launches the same repository through `_electron.launch`. The initial `package.json` main entry is `src/main.cjs`. Implement that entry, or update `main` and the start script consistently if the app needs a build step. The test helper reads `main`; any build must finish before the suite starts.

Honor `COD_USER_DATA_DIR` by setting Electron's userData path before readiness or profile access. The harness provides a different temporary directory to every test and also passes `--user-data-dir`. It unsets `ELECTRON_RUN_AS_NODE`. Do not load a real user profile or add a special renderer for tests.

## DOM contract

Use these stable `data-testid` values on the real UI:

| Selector | Required meaning |
| --- | --- |
| cod-window | Visible application shell with the window background color |
| workspace-tab-bar | Workspace tab bar with its own background color |
| workspace-tab | Each tab, with role=tab, aria-selected=true or false and a stable nonempty data-workspace-id |
| workspace-tab-label | Tab name only, inside each workspace-tab |
| workspace-add | The visible plus button in the tab bar, with an accessible name |
| workspace-close | Close button inside each workspace-tab, with an accessible name |
| workspace-area | The single visible active workspace area, with matching data-workspace-id |

A replacement for the last closed workspace must have a new identity. The tests do not prescribe its name, neighbour preference or wraparound switching. Initial workspaces are named Workspace 1, Workspace 2 and Workspace 3. The workspace area has no text or content in this story.

## Chosen keyboard shortcuts

List these in the implementation PR:

| Action | macOS | Linux |
| --- | --- | --- |
| New workspace (AC2 exception for Zed's new-window key) | Cmd+Shift+N | Ctrl+Shift+N |
| Next workspace | Cmd+Alt+Shift+J | Ctrl+Alt+Shift+J |
| Previous workspace | Cmd+Alt+Shift+K | Ctrl+Alt+Shift+K |
| Close workspace | Cmd+Alt+Shift+Q | Ctrl+Alt+Shift+Q |

The next and previous shortcuts have no binding or chord-prefix collision in either pinned Zed keymap. The close shortcut also has no collision. No test-only command API is needed.

## Criteria and evidence

| AC | Automated scenario |
| --- | --- |
| AC1 | Clean isolated launch, one empty workspace within 3000 ms, One Dark computed colors, two-tab screenshot for the PM's look check |
| AC2 | Mouse plus and keyboard add, ordered names, new tab active, one window |
| AC3 | Both Zed maps checked for collisions, mouse switching and next/previous keys, visible area identity follows active tab |
| AC4 | Mouse close in the middle, keyboard close at the end, neighbour selected, both last-tab close paths create a fresh empty workspace |
| AC5 | Real Electron smoke scenario in the same suite; the PR workflow runs all scenarios on ubuntu-latest under Xvfb |

AC5 needs a green Linux workflow run; the smoke scenario alone does not prove it. The visual comparison to stock Zed also needs the PM's review of the screenshot. Playwright writes videos and failure screenshots, and attaches the two-tab screenshot on successful AC1 execution. Video output is local evidence, not a validated stakeholder clip.

Before any app launch, each scenario checks the declared main entry. With the current missing app, the intended assertion message is `Story #3 app is missing: implement package.json main (src/main.cjs) before running acceptance tests`, followed by expected true, received false. This is an expected failure, not a recorded run result.

## Run outside the Codex sandbox

Install dependencies first: `npm install --no-audit --no-fund`.

On macOS, from the repository root:

```sh
mkdir -p artifacts/3
caffeinate -dimsu npx playwright test tests/e2e/ws1-workspace-tabs.spec.ts --reporter=list > artifacts/3/run.txt 2>&1
```

On Linux with the workflow's Electron system libraries installed: `xvfb-run -a npm run test:e2e -- --reporter=list`.

Hand back the run output to QA. QA must report PASS or FAIL per AC with that evidence before implementation begins. The run should collect five tests and fail all five at the missing-app assertion. Dependency installation, test collection and execution have not been validated in this sandbox because the npm registry cannot be resolved. No Electron process has been launched.

Developer ownership: app files under src/, plus package.json or build configuration when needed to implement the launch contract. Acceptance assertions and fixture references remain QA-owned. Expected hand-back: implementation PR with chosen keys, untouched acceptance assertions, test output and the initial look-check screenshot.

## Commit outside this sandbox

The worktree's Git metadata is outside the writable sandbox. The commit attempt failed while creating `/Users/butvinm/Dev/cod/.git/worktrees/tests-3/index.lock`; no files were staged. Run from the repository root:

```sh
git add package.json playwright.config.ts .github/workflows/e2e.yml \
  tests/e2e/README.md tests/e2e/ws1-workspace-tabs.spec.ts \
  tests/e2e/helpers/electron.ts tests/e2e/helpers/zed-keymaps.ts \
  tests/fixtures/zed-keymaps/README.md \
  tests/fixtures/zed-keymaps/default-macos.json tests/fixtures/zed-keymaps/default-linux.json \
  tests/fixtures/zed-themes/README.md tests/fixtures/zed-themes/one.json
git diff --cached --check
git commit -m 'Add workspace tab acceptance tests and Electron harness for #3'
```

# Story #4 developer handoff

Story: https://github.com/butvinm/cod/issues/4 - Project panel with several folder roots.

Branch: tests/4-project-panel, based on the story #3 tests branch. Reuse the launch and profile contract above. Do not change story #3 assertions to make story #4 pass. QA owns ws2-project-panel.spec.ts and the new fixtures. Developer owns app code and the hooks below. Expected hand-back: implementation PR, unchanged acceptance assertions, documented story exceptions, run output and the two-root look-check screenshot.

## Criteria source and Zed exceptions

`gh issue view 4 -R butvinm/cod` failed with `error connecting to api.github.com`. Web access to the issue also failed. These five tests use the local story draft at /private/tmp/cod-stories/2-panel.md as a provisional specification. Confirm it against the issue before implementation. AC1 adds several roots to the active workspace; AC2 toggles a closed-by-default panel; AC3 navigates and emits open requests; AC4 sorts and hides .git; AC5 preserves per-workspace roots, expansion and selection.

Pinned references: [Zed keymaps](../fixtures/zed-keymaps/README.md) and [selected Zed settings](../fixtures/zed-settings/README.md). Both platform maps are already stored locally and reused without edits. Settings values are pinned in project-panel-defaults.json, with a versioned source URL.

The draft requires these explicit exceptions: panel in the left dock and closed at startup (stock Zed starts open on the right); Enter opens a selected file (stock Zed uses Enter for Rename and Space for Open). List them in the implementation PR. Do not claim Enter is a Zed default. Cmd+B / Ctrl+B toggles the left dock; Cmd+Shift+E / Ctrl+Shift+E focuses the panel. AddFolderToProject is bound to Cmd+Shift+A / Ctrl+Shift+A only in RecentProjects in these maps. AC1 uses the panel button rather than adding a supposed workspace-wide Zed binding.

## Test hooks the developer must provide

COD_TEST_PICK_FOLDERS is a JSON array of arrays of absolute paths. Each invocation of the real add-folder action consumes the next array as the native dialog's returned filePaths, with canceled=false. Example: `[["/tmp/orchard"],["/tmp/harbor"],["/tmp/orchard","/tmp/harbor"]]`. Replace only the OS dialog result, then follow the normal add-folder path and workspace association. Do not prepopulate roots on launch. An exhausted queue must raise a clear test error. The hook is inactive when the variable is absent.

COD_TEST_OPEN_REQUEST_LOG_PATH is an absolute path for a passive JSON-lines log. At the real open-file request dispatch boundary, append one line shaped as `{"path":"/absolute/file.txt","workspaceId":"stable-workspace-id"}` for every activation, including repeats. The workspaceId matches the existing tab/area identity. The test reads this log; no renderer command injection or editor implementation is needed. Navigation and folder expansion must not dispatch open requests. The hook is inactive when the variable is absent and adds no visible UI.

The spec's automatic fixture copies invented project folders and runs real git init before the inherited Electron fixture launches. It supplies both variables, restores the previous environment after app closure, and removes the temporary folders. Keep test processes serial as configured by the story #3 harness.

## Additional data-testid selectors

| Selector | Required meaning |
| --- | --- |
| project-panel | The active workspace's focusable project panel; hidden or absent when closed |
| project-add-folder | Visible, keyboard-reachable add-folder button with an accessible name, inside the panel |
| project-entry | Each visible tree row, including roots, with role=treeitem, aria-selected=true or false, and absolute data-path |
| project-root | A wrapper for each root, or an ancestor around its root row, with absolute data-path; contains its project-entry row |
| project-entry-label | Filename or root basename only, inside each project-entry |
| project-entry-toggle | Accessible expand/collapse button inside directory rows; mouse click toggles the directory |

Directory and root rows have aria-expanded=true or false. Exactly one row is selected once navigation begins. Focus may be on the panel or a descendant. Collapsed descendants must be hidden or absent. Selectors are scoped to the active panel, so another workspace's hidden tree cannot satisfy the assertions. Root wrappers must not also carry project-entry when they contain descendant rows; otherwise label queries would count descendants twice.

## Coverage and expected failures

| AC | Scenario |
| --- | --- |
| AC1 | Button invokes scripted picker twice to add two roots; a new workspace starts without them; multi-select adds both to that workspace; one Electron window; screenshot for the PM |
| AC2 | Closed startup, focus key reveals and focuses, dock key closes/reopens, focus key reopens |
| AC3 | Up/Down selection; keyboard and mouse directory expansion/collapse; Enter and mouse file activation; passive log checks path, workspace identity and request count |
| AC4 | Directories first, case-insensitive natural order, visible dotfiles and gitignored file, real .git excluded |
| AC5 | Two different workspace trees, expanded directories and selected files survive previous/next workspace switching |

Every scenario first invokes the project-panel focus key and expects the panel to be visible. With story #3 implemented and story #4 missing, the intended failure is `Story #4 project panel is missing: the focus key must show the real project panel`, followed by the visibility assertion. This is an expected failure description, not a recorded test result. Until story #3 app code is available in this checkout, the inherited harness will fail at its missing-main assertion instead; that is a prerequisite failure and does not establish story #4's expected red baseline.

No Electron process was launched. Dependencies are absent in this checkout, so collection and type checking are pending. No criterion has a measured PASS or expected-FAIL verdict yet. The two-root screenshot still needs comparison with stock Zed by the PM, and is not a validated clip.

## Run story #4 outside the sandbox

Ensure the story #3 implementation and any required build are present first. Install the locked dependencies with `npm ci --no-audit --no-fund`. From this worktree root on macOS:

```sh
mkdir -p artifacts/4
caffeinate -dimsu npx playwright test tests/e2e/ws2-project-panel.spec.ts --reporter=list > artifacts/4/run.txt 2>&1
```

On Linux with Electron system libraries: `xvfb-run -a npx playwright test tests/e2e/ws2-project-panel.spec.ts --reporter=list`.

Return artifacts/4/run.txt to QA to confirm all five fail at the missing-panel assertion. No commit or PR was created. All new files remain uncommitted. The intentionally ignored fixture must be staged separately with `git add -f tests/fixtures/projects/orchard/ignored.txt` when the PM commits outside this sandbox.

# Story #6 developer handoff

Story: #6 - Fuzzy file finder across the workspace. The offline issue source is `artifacts/6/issue.md`. Branch: `tests/6-file-finder`, based on the story #4 tests branch. QA owns `c1-file-finder.spec.ts` and this README section. Developer owns app files and the real finder. Expected hand-back: implementation PR with unchanged acceptance assertions, any Zed exceptions, run output and the finder look-check screenshot.

## Offline Zed 1.23.2 evidence and open questions

The [pinned keymaps and provenance](../fixtures/zed-keymaps/README.md) establish these defaults:

| Action | macOS evidence | Linux evidence |
| --- | --- | --- |
| Open finder | [default-macos.json:756](../fixtures/zed-keymaps/default-macos.json#L756), `cmd-p`: `file_finder::Toggle` | [default-linux.json:702](../fixtures/zed-keymaps/default-linux.json#L702), `ctrl-p`: `file_finder::Toggle` |
| Next / previous result | [default-macos.json:17-20](../fixtures/zed-keymaps/default-macos.json#L17), `down` / `up`: `menu::SelectNext` / `menu::SelectPrevious` | [default-linux.json:13-16](../fixtures/zed-keymaps/default-linux.json#L13), same actions |
| Confirm / cancel | [default-macos.json:21-27](../fixtures/zed-keymaps/default-macos.json#L21), `enter` / `escape`: `menu::Confirm` / `menu::Cancel` | [default-linux.json:17-21](../fixtures/zed-keymaps/default-linux.json#L17), same actions |
| Toggle include ignored in finder | [default-macos.json:1312-1315](../fixtures/zed-keymaps/default-macos.json#L1312), FileFinder context, `cmd-shift-i`: `search::ToggleIncludeIgnored` | [default-linux.json:1258-1261](../fixtures/zed-keymaps/default-linux.json#L1258), FileFinder context, `ctrl-shift-i`: `search::ToggleIncludeIgnored` |

AC1's Cmd+P is tested as Ctrl+P on Linux to follow the pinned platform default. The include-ignored action proves a binding exists; it does not prove its initial state. The tests enforce the story's stated default of excluding ignored files without invoking that toggle.

Open questions for PM: confirm the stock finder layout, filename/path formatting, highlight styling, click activation, focus restoration and default ignore behavior against Zed 1.23.2. Keymaps cannot verify these behaviors offline. AC2 expects the full root-relative file path, including its basename, in the path field, following the issue's wording; confirm this matches Zed's presentation. The test does not prescribe fuzzy ranking. The AC2 screenshot attachment must still be compared with stock Zed; it is not a completed look check or a validated clip.

## Reused hooks and fixture lifecycle

Reuse `tests/e2e/helpers/electron.ts`, the isolated profile, and the story #4 hooks above. Each test supplies one `COD_TEST_PICK_FOLDERS` response containing all its roots. The add-folder button is focused and activated with Enter through the real UI. No roots are preloaded and no finder API is injected. AC3 uses `COD_TEST_OPEN_REQUEST_LOG_PATH` at the real open-file dispatch boundary; the existing contract remains required even if editor tabs are added. It checks exact path, workspace identity, request count and no requests during navigation.

An automatic fixture copies `orchard` and `harbor` for AC1-AC3. AC4 generates its own `.gitignore`, ignored file, ignored directory content, explicitly unignored file, visible control file and a `.git/hidden-marker.txt` sentinel. Every root runs real `git init`. AC5 generates exactly 20,000 project files in a fresh temporary root: 19,999 ordinary files and one unique `q` match. Git metadata is additional and excluded from the project-file count. These generated files are never committed. The fixture restores both environment variables and removes all generated directories after Electron closes, including on failures.

## Story #6 data-testid contract

Existing workspace and project-panel selectors retain their story #3 and #4 meanings. Add these selectors to the real UI:

| Selector | Required meaning |
| --- | --- |
| file-finder | The single visible finder overlay for the active workspace; hidden or absent when closed |
| file-finder-query | Focused text input inside the finder; keep this DOM element stable during query updates |
| file-finder-result | One displayed file row, with role=option, aria-selected=true or false, and absolute data-path |
| file-finder-name | Basename text inside each result row |
| file-finder-path | Full root-relative path including basename inside each result row, using `/` separators |
| file-finder-match | One or more spans containing only matched characters, in path order; combined text equals the query for the tested matches, with visible color, background, weight or text-decoration emphasis compared with the parent |

Render each matched character once for highlight assertions, even when the basename and path both contain it. Exactly one result is selected when matches exist, initially the first result. Up/Down change that selection while retaining query focus. Enter and clicking a row activate its absolute path and close the finder. Escape closes the finder and restores the exact previous focused control. These are DOM and behavior contracts for the tests, not a new test-only UI.

## Criteria, expected failure and timing evidence

| AC | Test in c1-file-finder.spec.ts | Coverage |
| --- | --- | --- |
| AC1 | Cmd+P opens the finder and Escape restores the previous focus | Empty workspace and two-root workspace; focus returns to the tab or add-folder control |
| AC2 | fuzzy path matches span active roots with names, relative paths and highlights | Noncontiguous `fst` matches in both roots, path-specific `afst` filtering, no results from another workspace, screenshot attachment |
| AC3 | Up/Down select results and Enter or a click dispatches the chosen file | Selection changes and reverses, no navigation requests, exact keyboard and mouse open requests |
| AC4 | .gitignore rules exclude files and directories and .git is never listed | Positive control, negation rule, ignored file, ignored directory content and Git sentinel under the same query |
| AC5 | first matching results render within 200 ms of a keystroke in 20,000 files | First `q` keystroke after opening, renderer-clock timing to a visible animation frame with the unique matching row, filename and path; JSON latency attachment |

Each scenario first opens the finder in the empty workspace. The intended first failure is `Story #6 file finder is missing: Cmd+P/Ctrl+P must show the real finder`, followed by Playwright's visibility assertion for `file-finder`. This checks the missing story #6 feature before attempting story #4 setup. Once the finder exists, the project panel and its hooks must be implemented for the remaining assertions. The current checkout contains story #3 app code but neither the project panel nor finder. These expected failures have not been measured.

AC5 arms a keydown listener on the query input, sends a real Playwright `q` keypress and measures `performance.now()` in the renderer until an animation frame sees the correct visible result with its name and path. It excludes automation IPC and polling time, does not warm up queries, and rejects stale unfiltered rows by requiring exactly the one `q` match. Missing results fail after a 1000 ms frame deadline; matching results must take at most 200 ms. The measurement samples DOM visibility at the animation frame before paint, not physical screen presentation. There is no test-only timing hook. The attached JSON records the measured milliseconds. Fixture construction and folder opening are outside the measured interval; indexing delays that remain at the keystroke are included.

## Run story #6 outside the sandbox

No Electron process was launched. Dependencies are absent, so Playwright collection, type checking and the red baseline remain pending. `node --experimental-strip-types --check tests/e2e/c1-file-finder.spec.ts` passes syntax validation. This is not a test execution or a criterion PASS. No commit or PR was created. The only changed files for this story are `tests/e2e/c1-file-finder.spec.ts` and `tests/e2e/README.md`, both uncommitted.

Install locked dependencies with `npm ci --no-audit --no-fund` outside the sandbox if needed. From this worktree root on macOS, run exactly:

```sh
mkdir -p artifacts/6
caffeinate -dimsu npx playwright test tests/e2e/c1-file-finder.spec.ts --reporter=list > artifacts/6/run.txt 2>&1
```

On Linux with Electron system libraries: `xvfb-run -a npx playwright test tests/e2e/c1-file-finder.spec.ts --reporter=list`.

Expected collection: five tests. Return `artifacts/6/run.txt` to QA. All five must fail at the missing-finder assertion before the red baseline is accepted; dependency, launch, fixture or prerequisite failures are not acceptable evidence for story #6.

# Story #5 developer handoff

Story: https://github.com/butvinm/cod/issues/5 - Open, edit and save files in editor tabs.
Criteria source: artifacts/5/issue.md, supplied by the PM offline.
Branch: tests/5-editor, based on the story #4 tests branch.
QA owns tests/e2e/c1-editor.spec.ts and tests/fixtures/projects/editor/ and tests/fixtures/zed-editor/.
Developer owns app code; existing tests, the harness and reference pins remain QA-owned.
Expected hand-back: implementation PR with unchanged acceptance assertions, run output, documented exceptions and the TypeScript look-check screenshot compared with stock Zed.

## Prerequisites and fixture contract

Reuse stories #3 and #4's real Electron launch, isolated profile and COD_TEST_PICK_FOLDERS contracts.
Each test creates temporary copies of orchard and harbor, overlays the editor samples, and initializes real git repos.
The picker queue is [[orchard], [harbor]] using those absolute temporary paths.
Files open through the real project panel, by selecting a project-entry and pressing Enter, following story #4's documented exception.
No renderer commands, preopened files or editor-only test renderer are introduced.
The spec uses project panel mouse selection and keyboard activation, plus the existing workspace keyboard shortcuts.

Story #4's implementation must be available before the story #5 red baseline is measured.
A failure at the missing project panel or missing fixture row is a prerequisite failure, not evidence that story #5 is missing.
Every scenario first opens a real fixture file and expects its editor-tab with this assertion message: `Story #5 editor is missing: opening a project file must create an editor tab`.
The next guard expects an editable buffer: `Story #5 editor is missing: active tab must display an editable buffer`.
These are intended failure messages, not measured output.

## Additional data-testid selectors

| Selector | Required meaning |
| --- | --- |
| editor-tab | Each visible active-workspace editor tab, with role=tab, aria-selected=true or false, and absolute data-path |
| editor-tab-label | Basename only inside each editor-tab |
| editor-surface | Active editor background surface inside workspace-area |
| editor-content | The active editable content node inside workspace-area; focusable; innerText contains source lines without gutters, labels or placeholder text |
| editor-syntax-token | Actual highlighted source text inside editor-content; data-syntax-token names its category in the pinned One Dark syntax map |
| editor-unsaved-indicator | Visible modified-state indicator inside the relevant editor-tab, hidden or absent for clean buffers; its exact appearance awaits the Zed reference |
| editor-save-prompt | Proposed real close-confirmation dialog, with keyboard-reachable Save, Discard and Cancel buttons; exact Zed/native parity awaits the reference |

Only the active workspace's editor tabs and active buffer belong in the visible workspace-area.
Exactly one editor tab is selected when files are open.
editor-content is the real editable node, not a mirrored test-only element.
Text geometry is read from its DOM to double-click the first word without assuming a font size.
Markers and attributes describe visible production state and must not substitute for syntax highlighting, editing or saving.
Do not attach a size or style to the unsaved indicator based on a guessed Zed default.
The save-prompt contract is provisional pending the offline reference question; a native prompt needs a QA-approved dialog hook instead of an untestable DOM contract.

## Coverage and unresolved parity

| AC | Automated scenario |
| --- | --- |
| AC1 | Open all seven sample languages; verify source text, tab label, editor background and foreground and at least two distinct syntax colors from the pinned One Dark theme; attach TypeScript screenshot |
| AC2 | Type, undo/redo, Shift with all four arrows, double-click word selection, copy/cut/paste, select all, line moves up/down and TypeScript comment toggle |
| AC3 | Clean and modified indicator states, unchanged disk before save, exact real disk contents after save, indicator cleared |
| AC4 | Existing-file focus without duplicate tab, close clean active tab, keyboard Cancel preserves draft, Discard preserves disk and loses draft, Save writes disk and closes; reopen confirms persisted contents |
| AC5 | Two workspaces with different tab sets; switch twice each way; restore active file and drafts including an inactive tab's edits; disk stays unchanged |

Pinned colors, binding actions, versioned source URLs and open questions are recorded in [the story #5 Zed reference](../fixtures/zed-editor/README.md).
The offline settings pin does not contain a verified default buffer font size, so that part of AC1 has no assertion yet.
Unsaved-indicator appearance, preview defaults and save-prompt defaults also remain unverified.
The prompt test asserts the story's three outcomes using Tab and Enter without inventing Zed's button order or mnemonics.
No complete Zed parity PASS may be reported until these questions are resolved and the necessary assertions or visual evidence are added.
The TypeScript screenshot is an initial look check, not a validated stakeholder clip.

## Run story #5 outside the sandbox

No Electron or browser process was launched during test authoring.
Install locked dependencies and ensure stories #3 and #4 are implemented and any required build has completed first.
From the worktree root on macOS:

```sh
mkdir -p artifacts/5
caffeinate -dimsu npx playwright test tests/e2e/c1-editor.spec.ts --reporter=list > artifacts/5/run.txt 2>&1
```

Linux equivalent with Electron libraries installed: `xvfb-run -a npx playwright test tests/e2e/c1-editor.spec.ts --reporter=list > artifacts/5/run.txt 2>&1`.
Return artifacts/5/run.txt to QA to confirm five expected editor failures and reject prerequisite or test failures.
No commit or PR was created; the story #5 files remain uncommitted as requested.
