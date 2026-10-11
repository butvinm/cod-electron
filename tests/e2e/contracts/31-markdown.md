# Story #31: Chat replies wrap and render markdown

Issue: #31. Requirement: A1. Sprint 2 obligation: O1.3.
Branch: tests/31-markdown.
Acceptance suite: tests/e2e/a1-markdown.spec.ts.
Story-specific fake fixture: tests/e2e/fixtures/31-markdown.ts.

## Ownership and hand-back

QA owns the two test files and this contract.
The developer owns application implementation under src/ and any implementation unit tests.
Do not weaken, skip, delete or rewrite these acceptance assertions.
If a fixture or assertion needs correcting, return the problem to QA with evidence.
Hand back the implementation commit/PR, typecheck results and external Electron run output, with PASS/FAIL and evidence for AC1 through AC7.

## Acceptance criteria and probes

1. AC1: At a 900 px content width, long prose wraps, both the path and URL are exactly 200 characters, and the collapsed Read tool shows its long target without extending the history or pane beyond the window. History scrollWidth must be no greater than clientWidth plus 1 px. A deliberately wide fenced code line must actually scroll in a local box before the history ancestor. Wrapping or clipping away the code line does not pass.
2. AC2: h1, h2 and h3 headings, ul/ol/li nesting, strong, em and blockquote elements render with their expected text. Nested list structure is tested, not only visual indentation. A screenshot is attached by the test for later look comparison.
3. AC3: Two GFM tables render, including thead/tr/th header cells and data cells. The twelve-column table must actually scroll in its own box, and the history must remain contained.
4. AC4: Fences tagged ts, js, json, py, rust, go and sh render as pre > code. Character-level computed colors must match the pinned One Dark editor theme for keywords and strings. JSON uses a boolean literal because JSON has no keywords. Inline code renders as a code element outside pre. Token classes and span boundaries are not prescribed.
5. AC5: The accessible markdown link has the exact href. Clicking it must record one URL in the main-process external-browser hook. The main frame must not navigate, the original page URL and BrowserWindow count must remain unchanged, and the composer remains visible.
6. AC6: Four deterministic chunks stop at a heading/prose fragment, an unfinished ts fence/string, a wide code line with the fence still open, and the final closed fence/table. Each intermediate fragment is checked before its release gate advances. Every sampled animation frame must keep the pane, history and messages contained. Final headings, code and table must render. A second turn delivers the identical full text as one delta; its semantic tree, text, colors, weights and whitespace styles must equal the streamed result. No wall-clock sleeps.
7. AC7: The img/onerror and script payloads remain visible as literal text, create no active HTML nodes or handler attributes, trigger no dialog and leave the execution sentinel false after a paint. A surrounding heading and bold phrase must render. This positive control prevents the current plain-text-only renderer from passing the safety criterion.

## Existing UI contracts

Reuse workspace-area, claude-chat, chat-user-message, chat-assistant-message and chat-tool-call data-testid values.
Keep the Conversation log role and Message Claude textbox accessible name.
Assistant messages expose data-state=streaming or complete.
The tests locate rendered HTML by roles and semantic tags, never by layout classes.
No new data-testid values are required.
Keyboard flow: focus Message Claude, insert invented text, press Enter.
The link criterion explicitly uses a mouse click.
Window resizing uses Electron BrowserWindow.setContentSize(900, 700), not a browser viewport emulation.

## Requested main-process hook for AC5

Only when COD_TEST_RECORD_EXTERNAL_URLS=1, initialize globalThis.__codTestOpenedExternalURLs as an empty string array in the Electron main process.
On the same validated external-link path used to call shell.openExternal in normal operation, append the requested URL to that array and suppress launching the real system browser in this test mode.
Prevent the default in-window navigation and creation of an Electron browser window.
The test reads the array with ElectronApplication.evaluate; it does not invoke the opener or inject replies through IPC.
The hook must record the URL only after the real renderer-to-main handoff, not through a separate fake UI path.
No hook is needed for markdown rendering, streaming or script safety.

## Fixtures and Zed reference

The fixture copies the existing scripted Claude CLI into a unique temporary directory and writes story-31.json there.
The shared fake executable, scenario files and shared Electron helper remain untouched.
Each test has unique fake logs, gates and an isolated Electron profile.
All text, paths and example.invalid URLs are invented.
The helper restores environment overrides on teardown and removes temporary state.
The stream-json envelope limitations documented in tests/fakes/claude/README.md apply here too.

Zed source inspected read-only at v1.23.2, commit c0199504b9cce79bc27524950022ed701bc3ebd5: https://github.com/zed-industries/zed/blob/c0199504b9cce79bc27524950022ed701bc3ebd5/crates/markdown/src/markdown.rs.
MarkdownStyle around lines 240-330 uses theme syntax colors, local code overflow scrolling, monospace code, 8 px padding, a border and agent-specific heading sizes.
Color assertions reuse the existing byte-for-byte tests/fixtures/zed-themes/one.json fixture and its provenance README.
No pixel spacing assertions are added based on a guessed stock screenshot.
The stock Zed agent-panel look check and side-by-side screenshot remain pending external QA; this sandbox session does not launch either application.
Use a reply containing the heading/list fixture, table fixture and ts code fence for that comparison.
PM parsing decision: @lezer/markdown with GFM and the installed CodeMirror language packages. A missing shell language package is not permission to omit sh highlighting. If the chosen packages cannot satisfy the story without a runtime dependency, stop and report why in the implementation PR.

## Expected baseline failures and external run

These are predicted assertions from source inspection, not observed Electron failure messages.
AC1 should fail at history/pane containment or at the requirement for local sideways code scrolling; the current code uses pre-wrap/overflow-wrap instead.
AC2 should fail at the missing heading role.
AC3 should fail at the expected two semantic tables.
AC4 should fail at the expected seven pre > code elements.
AC5 should fail at the missing accessible link, then require the main-process hook after links are implemented.
AC6 should fail at overflow containment or the final heading/table/code semantic checks.
AC7 should preserve raw HTML safely but fail at the surrounding semantic heading positive control.

Run outside the sandbox on macOS from this worktree:

```sh
mkdir -p /tmp/cod-art/31
caffeinate -dimsu npm run test:e2e -- tests/e2e/a1-markdown.spec.ts --reporter=list > /tmp/cod-art/31/run.txt 2>&1
```

The npm pretest:e2e script builds the app before Playwright runs.
Return /tmp/cod-art/31/run.txt plus test-results traces/screenshots to QA.
Before implementation, QA must confirm all seven tests fail at feature assertions rather than launch or fixture errors.
No expected-failure annotations are used; the tests must become ordinary passes after implementation.
No Electron verdict is claimed until that external run is reviewed.
