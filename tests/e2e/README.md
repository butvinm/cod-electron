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
