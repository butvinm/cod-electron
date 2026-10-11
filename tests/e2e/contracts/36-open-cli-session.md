# Story #36 developer contract

Story: #36 - Open a Claude CLI session in Cod.
Branch: tests/36-open-cli-session.
Requirements: A2, A3, sprint 2 obligation O1.7.
Tests: tests/e2e/a2-open-cli-session.spec.ts, exactly one Electron test per AC1-AC5.

QA owns the spec, tests/e2e/helpers/36-session-store.ts, tests/fakes/claude/36-session-store.cjs and this contract.
Developer owns the app implementation, preserves the acceptance assertions, and returns an implementation PR, protocol verification notes and external Electron run output.
No shared test helpers, shared fake behavior or app files were changed.
No commit or PR was requested for this handoff.

## Criteria and coverage

| AC | Automated coverage |
| --- | --- |
| AC1 | Zed history shortcut and header button; home sessions when there are no workspace folders; union of two workspace folders; exclusion of home and unrelated folders once folders exist; newest first; first user message rather than last turn as title; visible relative age; typing filter; clearing filter; Esc and reopen |
| AC2 | Opening a stored session replaces an existing conversation; string and text-block user content; old assistant replies; transcript order; tool_use and matching tool_result; collapsed summary, keyboard expansion, input and output; same tool controls for a subsequent live turn |
| AC3 | Choose the second workspace folder's session, not the first folder's; no CLI process on import; send one new prompt; exact adjacent --resume and ID arguments; cwd is the selected session's folder; retained ID, history and appended reply; old prompts are not replayed to stdin |
| AC4 | Start in Cod, load its saved session once, ensure the original CLI has stopped, resume via a distinct external CLI process, verify its stored turns and reopen the same session; no stale cached history or duplicate turns |
| AC5 | Exact empty-state text with no options, both without folders and with two folders; an unrelated folder's session must not count |

The look check is manual and has no separate automated test.
AC1 attaches a picker screenshot for comparison with stock Zed.
It is not a validated look check or a stakeholder clip until inspected beside stock Zed.
No screenshot was generated in this sandbox.

## UI and keyboard

| Accessible role/name or test ID | Required meaning |
| --- | --- |
| dialog "Claude sessions" | Visible session picker opened by the shortcut or header button |
| textbox "Filter Claude sessions" | Initially focused filter; typing narrows options, clearing restores them |
| option | One matching session row in displayed order; Enter in the filter opens the only matching row |
| claude-session-title | First user message shown inside each option |
| claude-session-age | Relative age shown inside each option; accept Zed's compact Nd format or N days wording |
| button "Claude session history" | Session-list button in the active chat header |
| claude-chat | Existing active workspace chat |
| chat-user-message, chat-assistant-message | Existing transcript rendering for both stored and live turns |
| chat-tool-call, chat-tool-input, chat-tool-output | Existing tool rendering for both stored and live calls |
| log "Conversation" | Existing transcript containing messages and tool calls in order |
| chat-session-id, chat-working-directory | Selected native session ID and working folder |
| textbox "Message Claude" | Existing keyboard composer |

Cmd-G on macOS and Ctrl-G on Linux open session history while the chat composer has focus.
Escape closes the picker; Enter confirms the filtered session and closes it.
The selector names are a QA contract for accessible controls, not a claim about Zed's exact accessible labels.
No new app test hook is required beyond accessible picker controls and the two row metadata test IDs.
The existing COD_CLAUDE_BIN and COD_TEST_PICK_FOLDERS launch overrides are reused.

Compatibility with #29: if start-screen is visible, press Cmd-N or Ctrl-N to open the chat.
For folder addition, focus the existing project panel's Add Folder button and press Enter when present; otherwise use Cmd-Shift-A or Ctrl-Shift-A.
Both branches drive real UI and use the same invented folder-dialog result.
Compatibility with #31: assert rendered assistant text and existing tool controls, with no assumption about markdown wrapper elements.

## Zed reference

The existing tests/fixtures/zed-keymaps/default-macos.json and default-linux.json were compared byte for byte with the supplied Zed v1.23.2 source and match.
Their source URLs and Git blob hashes are already recorded in tests/fixtures/zed-keymaps/README.md.
No duplicate fixture is needed.
The pinned action is agents_sidebar::ToggleThreadHistory in the ThreadsSidebar context: default-macos.json:810 and default-linux.json:755.
The pinned AddFolderToProject bindings are default-macos.json:1330 and default-linux.json:1275.
Read-only source investigation: crates/sidebar/src/sidebar.rs:7525 renders a clock history button and uses ToggleThreadHistory in its tooltip and click handler.
crates/agent_ui/src/threads_archive_view.rs:172 creates a search editor; lines 290-295 sort entries and normalize the filter; lines 1030-1045 format relative ages, including Nd for fewer than seven days.
Fixture ages are two, five and six days, away from hour/day and week transitions.
The renderer clock is fixed for AC1; file timestamps are relative to the fixture creation time so main-process age calculation also stays in the same day buckets.
Stock Zed was not launched under the user's no-browser/no-Electron constraint; the visual comparison remains for the external QA run.

## Isolated native store and fake CLI

The automatic fixture sets CLAUDE_CONFIG_DIR to a fresh temp directory before the existing harness launches Electron and restores the environment after app teardown.
The operator's ~/.claude is never read, changed or copied.
Home folder sessions use the home path as metadata and an encoded folder name inside the fixture config directory only.
The two workspace folders are real throwaway git repositories with invented notes.txt content.
All shell credential variables matching the existing provider's credential pattern are removed for this suite.
CLI logs contain invented prompts, argv, process IDs and cwd, and are attached before cleanup.

Store path: <fixture CLAUDE_CONFIG_DIR>/projects/<encoded absolute folder>/<session UUID>.jsonl.
Fixture encoding replaces every non-ASCII-alphanumeric character in the absolute folder path with '-'.
Native records have type=user or assistant, message.role/content, sessionId, uuid, parentUuid, cwd, timestamp, version=2.1.296, userType=external and isSidechain=false.
Records form a parent chain; tool results are user messages containing tool_result blocks, not user-authored conversation bubbles.
User-authored content covers both a string and text-block arrays.
This shape and encoding are inferred fixtures, not verification against an operator's real store.
The story requires the developer to check the installed claude 2.1.296 encoding and JSONL format read only and record findings without copying real session content.
If that check contradicts the fixture, return a structural explanation to QA before changing assertions or fixture shapes.

The story-specific executable implements the existing print/stream-json CLI interface.
It validates --resume against a session file in the fixture store, emits init/assistant/tool/result events, and appends the new user and assistant turns to that same store.
It uses no model, network, account or real shell tool execution.
The external terminal continuation uses another process of this executable with the same streaming flags, matching the established #8 terminal-resume test approach.
The terminal UI and handoff button from other stories are outside this story's test contract; the native displayed ID is the handoff identity.
Selecting an imported session must stop any prior Cod CLI process before the external continuation begins.
AC4 confirms that stop and waits for the external process to exit before reopening, so it does not test attachment to a running terminal session.

## Validation and intended red baseline

npm run typecheck: PASS.
node --check tests/fakes/claude/36-session-store.cjs: PASS.
Playwright --list discovers exactly five tests without launching Electron.
A Node-only fixture smoke check passed separate CLI resume, terminal persistence, live tool events and the eight-record parent chain.
This proves fixture mechanics only, not any acceptance criterion.

Electron tests were not run, as explicitly requested.
Every test is intended to fail at: "Story #36 session picker is missing: agent history must open the workspace Claude sessions".
There is no measured failure message yet; the external run must establish that all five fail for the missing picker, rather than launch, fixture or prerequisite errors.
Until that output returns, the QA verdict is FAIL for lack of measured acceptance evidence.

Run outside the sandbox from this worktree root on macOS:

```sh
mkdir -p /tmp/cod-art/36
caffeinate -dimsu npm run test:e2e -- tests/e2e/a2-open-cli-session.spec.ts --reporter=list > /tmp/cod-art/36/write-tests-run.txt 2>&1
```

On Linux, use the same command without caffeinate -dimsu.
The npm script builds the app before Playwright runs.
Return /tmp/cod-art/36/write-tests-run.txt and any failure trace to QA for the measured verdict.
