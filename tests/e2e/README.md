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
