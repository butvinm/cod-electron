# Developer contract: #37 Project panel icons and highlights like Zed

Branch: tests/37-project-panel-look.
Requirements: C1, sprint 2 obligation O2.1, stakeholder feedback 2026-10-11.
QA owns tests/e2e/c1-project-panel-look.spec.ts, this contract and tests/fixtures/zed-project-panel/.
Developer owns app code, app icon assets and their license notices.
Do not weaken assertions or change pinned fixtures; ask QA to approve any licensed substitute reference.
Leave Add Folder unchanged.
Shared helpers and fake providers are unchanged.

## Criteria and expected failures

| AC | Scenario | Expected missing-feature assertion |
| --- | --- | --- |
| AC1 | ts, json, md, rs, py, unknown and folder rows have pinned icon geometry; folders change on expand and collapse | AC1: every row must render Zed's folder_open icon |
| AC2 | Open two files by keyboard; the active row is gray without a blue frame and the old row loses gray | AC2: active editor file must use One Dark element.selected |
| AC3 | Focus panel; Down moves the blue frame off the open file; Up returns it; editor focus removes it | AC3: selected row must have a border.focused frame |
| AC4 | Open a deep file, switch away, collapse its parents, then use the finder to activate its existing tab | AC4: switching editor tabs must expand every collapsed parent |

These are expected failure descriptions, not observed results.
Electron and browser runs are explicitly deferred to the PM outside the sandbox.
A launch, fixture, or prerequisite failure is not a valid red baseline.
Stock Zed has not been launched in this QA run.

## Existing hooks and keyboard paths

Reuse project-panel, project-add-folder, editor-tab with absolute data-path and aria-selected, editor-content, file-finder, file-finder-query and file-finder-result.
Tree rows have role=treeitem, absolute data-path, aria-selected and aria-expanded for folders.
The picker uses the existing COD_TEST_PICK_FOLDERS queue; the inherited harness isolates the user profile and drives the real Electron app.
The story-local fixture creates a real throwaway git repo named panel-look before Electron starts.

- Cmd+Shift+E on macOS or Ctrl+Shift+E on Linux shows/focuses the panel.
- Focus Add Folder and press Enter to invoke the native picker fake.
- Home, Up, Down, Right and Left select, expand and collapse tree entries.
- Enter opens a file, preserving story #4's documented exception to Zed.
- Cmd+P or Ctrl+P, type item-089.ts and press Enter to activate the already-open deep tab without mouse input.

AC4 uses the existing finder instead of introducing another story's missing tab-switch shortcut as a prerequisite.
Its viewport assertion reads clipping geometry and never scrolls the row on behalf of the app.

## New hook

Add exactly one data-testid=project-entry-icon per visible row, including roots.
Apply it to a rendered inline SVG, a wrapper containing the SVG, or an img loading an SVG.
The test checks visible SVG geometry against pinned upstream assets, and checks img decoding where applicable.
A decorative label or a data attribute alone does not satisfy AC1.
No hidden state, mock tree or app-internal selection hook is requested.
Use a border, outline or box shadow on the row for the focused blue frame.
The frame test inspects the actual computed style; markers alone do not satisfy it.

The pinned One Dark tokens are element.selected = #454a56ff and border.focused = #47679eff.
See tests/fixtures/zed-project-panel/README.md for exact upstream paths, commit and icon mapping.
The issue allows Lucide replacements when an upstream icon license is unclear.
Before replacing any fixture, list the affected icon and its licensed substitute for QA review.
Do not copy GPL Rust mapping/resolver implementation into the MIT app from these test references.

## AC5 manual check

AC5 is a manual check, not an end-to-end test.
The implementation PR must include a screenshot of Cod's panel on the fixture folder and a side-by-side comparison with stock Zed 1.23.2.
QA must inspect the actual comparison and PR attachment before reporting AC5 PASS.
The PM should obtain the early look check after icons/highlights work and before AC4 implementation, as the issue asks.
Open the same generated panel-look folder in stock Zed 1.23.2 with default settings, default keymap and One Dark.
Show the root expanded, branches collapsed, sample.ts open and sample.json selected in the panel.
The reference folder can be recreated from the story-local fixture recipe in the spec.
Capture both panels next to each other, confirm the same rows and no private data, and attach the screenshot to the implementation PR.
Do not add evidence files under tests/.
No evidence manifest or environment variable is required by the end-to-end suite.

## Run and hand back

From the repository root, outside the Codex sandbox on macOS:

```sh
mkdir -p artifacts/37
caffeinate -dimsu npx playwright test tests/e2e/c1-project-panel-look.spec.ts --reporter=list > artifacts/37/run.txt 2>&1
```

The current build exists and deps are installed; after app changes run npm run build before this command.
On Linux use xvfb-run -a npx playwright test tests/e2e/c1-project-panel-look.spec.ts --reporter=list.

Hand back the implementation commit/PR, unchanged QA assertions, icon origins and license notices, typecheck output, run log with failure excerpts or PASS per AC, and the reviewed stock-Zed comparison attachment for the AC5 manual check.
QA must establish four missing-feature failures for AC1-AC4 on the baseline before implementation starts.
AC5 is reviewed manually on the implementation PR.
