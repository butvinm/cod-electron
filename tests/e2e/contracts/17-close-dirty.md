# Story #17 developer contract

Story: #17 - Ask before closing a workspace with unsaved files.
Source: [offline issue](../../../artifacts/17/issue.md).
Branch: tests/17-close-dirty.
QA owns this contract and [c1-close-dirty.spec.ts](../c1-close-dirty.spec.ts).
Developer owns app implementation under src/ and must leave acceptance assertions unchanged.
Expected hand-back: implementation PR, unchanged tests, and output for all five criteria plus the regression suite.

## Reused harness and reference

Use the real Electron launch and isolated profile from [helpers/electron.ts](../helpers/electron.ts), and the folder picker and DOM contracts in [README.md](../README.md).
Each test copies the invented editor fixtures into two temporary repositories, runs real git init, scripts native folder-picker responses with COD_TEST_PICK_FOLDERS, restores the environment and deletes its copies afterward.
No committed fixture is written.
File opening follows c1-editor.spec.ts: select the real project-entry row, focus the project panel and press Enter (story #4's documented exception).
Folder setup waits for the root row, selects it and presses ArrowRight to ensure its children are expanded.
Edits, saves, workspace navigation and prompt choices use the real keyboard paths.
AC1 also exercises the workspace tab close button with the mouse.

Use the offline [Zed editor reference](../../fixtures/zed-editor/README.md) for the single-file prompt facts.
The story and QA handoff supply the multi-file text: "Do you want to save changes to the following files?" and buttons Save all, Discard all, Cancel.
No network research was performed.
Reuse the in-window prompt on both platforms and the single-file highlight behavior: Save all initially highlighted, Enter confirms, Escape cancels, Up/Down and Tab/Shift+Tab move with wrapping.
The highlighted choice has a visibly different background and data-highlighted="true"; other buttons omit that value or use false.

## Prompt DOM contract

Reuse editor-save-prompt on the real dialog, with role=alertdialog.
Only one prompt is visible.
Its button names in DOM order are Save all, Discard all, Cancel.
Add editor-save-prompt-file to each visible listed path, with no label prefix.
Show only modified files, including inactive editor tabs.
Use project-relative paths for each workspace with one root, as the single-file reference does.
List paths in workspace tab order, then editor tab order within each workspace.
The tests use different basenames across workspaces, so disambiguation for identical names remains an implementation choice.

A workspace close includes only that workspace's dirty files.
Quit includes dirty files across all workspaces, including inactive ones while a clean workspace is active.
Cancel preserves workspace identities, editor tabs, buffers, dirty indicators and original disk bytes.
Discard all removes the requested workspace without any disk writes.
Save all writes every modified buffer before closing.
A failed save keeps the workspace open, activates the failing tab, preserves its dirty buffer and displays the existing editor-notice error, "Could not save <basename>: <reason>".
Previously successful saves may stay saved; retry lists the remaining dirty files.
A last-workspace close produces the existing fresh workspace with a different identity.

## Coverage

| AC | Scenario |
| --- | --- |
| AC1 | Mouse close with one dirty file; Cancel; shortcut close with two dirty files and a clean active editor tab; exact list excludes the clean file |
| AC2 | Two dirty buffers; real deterministic save failure; failing tab and notice; restore target; retry Save all; both disk drafts and workspace removal |
| AC3 | Enter on highlighted Cancel; reopen each tab and verify draft, indicator and unchanged disk; Enter on Discard all; verify removal and unchanged disk |
| AC4 | Default highlight, Up/Down, Tab/Shift+Tab and wrapping; visual highlight distinction; Escape from Discard all preserves edits; reopen and Enter saves |
| AC5 | Dirty files in two inactive workspaces while a third clean workspace is active; real app.quit(); prompt; Enter on Cancel; window alive; all workspace identities, drafts and disk contents preserved; keyboard navigation and real saves still work |

## Failure fixture and quit trigger

AC2 moves sample.ts to a backup outside the temporary repository after opening and modifying it, then creates a directory at its original path.
The real filesystem save must fail because the target is not a file, including under root.
A read-only file alone would not fail the existing atomic rename save.
The test restores the original target in finally before retrying.
No filesystem fake or save-error hook is required.

AC5 uses Playwright ElectronApplication.evaluate only to schedule Electron app.quit() on the next main-process turn.
This is a documented test trigger of the production before-quit lifecycle, not renderer state injection, window destruction or an implementation of the prompt in the test.
Scheduling lets evaluate return before a missing quit guard terminates its execution context.
The prompt visibility assertion may report a closed page on the red baseline: if quit exits rather than prompts after the established modified-buffer guards, that is the expected missing-feature failure.
Do not substitute ElectronApplication.close() as the AC5 trigger.
After successful Cancel assertions the test saves both drafts through the UI, leaving clean buffers for harness teardown.
No new application test hook is requested.

## Pending red baseline

No Electron or browser process was launched during authoring.
Playwright --list collects exactly five tests.
Every test establishes existing panel and editor prerequisites, then checks the story #17 prompt before its outcome assertions.
The intended failure is "Story #17 multi-file save prompt is missing: closing or quitting with modified files must ask first".
AC5 can also fail because the page closed during that assertion.
These are expected failures from source inspection, not measured run output.
A launch, prerequisite, fixture or selector failure must be corrected before accepting the red baseline.

The first measured run in artifacts/17/run.txt had five setup failures: file-finder-input was not found.
The AC1 error-context.md shows the "Search files" textbox was active; c1-file-finder.spec.ts and src/renderer/file-finder.js use file-finder-query, not file-finder-input.
This was a test selector error, not evidence of a product focus bug.
Setup now uses the established project-panel file-opening path from c1-editor.spec.ts.
The revised tests still need an Electron run outside the sandbox before the red baseline can be accepted.

Run outside the sandbox on macOS from this worktree root:

```sh
caffeinate -dimsu npx playwright test tests/e2e/c1-close-dirty.spec.ts --reporter=list > artifacts/17/run.txt 2>&1
```

Direct npx playwright runs do not build the editor bundle.
If dependencies or the editor bundle are missing, prepare them with npm ci and npm run build before measuring the baseline.
Return artifacts/17/run.txt to QA for the measured verdict.
No files were staged or committed, and no PR was created.

## Additional lifecycle coverage on story/17-close-dirty

The existing five tests and their assertions are unchanged.
Three additional scenarios cover the stakeholder's QA handoff:

| Criteria | Added scenario |
| --- | --- |
| AC3, AC5 | BrowserWindow.close() shows the multi-file prompt; keyboard Cancel keeps the window, workspace identity, dirty buffer and disk bytes; a second window close followed by Discard all exits normally without writing |
| AC2, AC5 | Three additional app.quit() calls while the prompt is open retain the original DOM dialog; a MutationObserver counts exactly one prompt creation; Save all writes both drafts and produces one will-quit event, one window close, one application close and one normal process exit |
| AC2, AC5 | Quit Save all writes an earlier file in another workspace, then fails on a read-only temporary target; the app stays alive, selects the failing workspace and tab, displays the save error and keeps that draft dirty; the earlier file stays saved |

The read-only scenario changes only temporary fixture permissions and restores them in finally.
It makes sample.ts read-only (0444) and its containing temporary repository read-only (0555), because atomic replacement can overwrite a read-only file in a writable directory.
It checks W_OK before requesting quit and requires an unprivileged test runner.
A privileged runner that bypasses permissions fails this fixture prerequisite; it must not be reported as a product failure.
The original directory-target AC2 test still covers a deterministic save failure even under root.

Window-close and quit requests use the real Electron lifecycle.
Window-close requests are scheduled on the next main-process turn so evaluate returns even when the missing close guard would terminate the process.
Repeated quit requests run after the first prompt is visibly open.
DOM observation and the will-quit listener only count externally visible events; they do not invoke renderer internals or modify save behavior.
Successful exits are asserted before harness teardown, including exit code 0 and no signal.
The partial-failure test saves the remaining draft through the keyboard after restoring permissions.

## Typing during Save all: deferred to deterministic unit coverage

There is no deterministic end-to-end write barrier exposed by the current app.
The editor:write IPC handler calls EditorFiles.write synchronously in the main process.
That method uses synchronous writeSync, fsyncSync and renameSync calls on small local fixture files.
A keyboard command issued after Enter can therefore arrive after the write and window close; increasing file size or sleeping would create a timing race rather than prove typing happened while the targeted write was pending.
EditorFiles has an injectable beforeCommit hook for unit tests, but the main process does not expose that hook to the Electron harness.
Monkey-patching filesystem methods, replacing the IPC handler or renderer editor API through evaluate would test altered application internals and violate the real-app testing contract.
No app code or test hook was added by QA.

The required unit scenario is to hold the targeted editor write promise, attempt a real editor document change while Save all awaits it, release the write, and verify either that editing was blocked or that close is rejected and the newer document remains dirty and intact.
Also verify that the saved snapshot corresponds to the text actually written, rather than incorrectly marking the newer document saved.
The current tests/unit/editor-files.test.mjs beforeCommit checks cover filesystem target replacement, not this renderer buffer race.
Renderer typing-during-save coverage remains unverified and is a developer handoff requirement, not a PASS claim.
If a future handoff authorizes an app hook, a fixture-scoped write-start notification and explicit release barrier would allow keyboard-driven Electron coverage without sleeps.

## Validation of the additions

Playwright --list collected all eight tests successfully (five existing and three new).
TypeScript checking of c1-close-dirty.spec.ts passed with --noEmit --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck.
git diff --check passed, and comparison with HEAD confirmed every existing helper, test body and assertion is unchanged.

Collect without launching Electron:

```sh
npx playwright test tests/e2e/c1-close-dirty.spec.ts --list --reporter=list
```

Run outside the sandbox as an unprivileged user after dependencies and the editor bundle are ready:

```sh
caffeinate -dimsu npx playwright test tests/e2e/c1-close-dirty.spec.ts --reporter=list
```

No Electron run was performed while authoring these additions.
These lifecycle scenarios extend an existing implementation, so no failing baseline or passing verdict is claimed without a measured run.
The user explicitly requested no commits; no files were staged, committed or published.
