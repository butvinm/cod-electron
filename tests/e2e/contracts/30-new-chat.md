# Story #30 developer contract

Story: #30 - New Claude Chat in any workspace, with a default folder.
Requirements: D12 (minutes 2026-10-11), sprint 2 obligation O1.2, WS2.
Branch: tests/30-new-chat.
Tests: tests/e2e/ws2-new-chat.spec.ts, exactly one test per AC1-AC5.

QA owns tests/e2e/ws2-new-chat.spec.ts, tests/e2e/helpers/new-chat.ts, this contract, and the additive fake session flag in tests/fakes/claude/claude.
The developer owns app implementation and must preserve the test assertions.
Expected hand-back: implementation PR, unchanged acceptance assertions, typecheck output and external Electron run output with evidence per AC.
No commits, PR creation, network access or Electron runs were requested for this QA handoff.

## Prerequisites and red baseline

Run against the implemented story #8 chat/composer/provider contract.
Story #29 may be present or absent.
When start-screen is visible, the helper presses Cmd-N on macOS or Ctrl-N on Linux before using the chat.
AC1 uses Cmd-Shift-A/Ctrl-Shift-A to add folders when that start screen was present, and the keyboard-focused project-add-folder button before #29.
COD_TEST_PICK_FOLDERS supplies two invented fixture directories through the existing native picker hook.
No new app startup or workspace injection hook is required.
The tests work with #31 markdown because they assert reply completion and history through stable test IDs, without requiring a particular rendered text structure.

Each test establishes an old completed conversation and presses Cmd-N/Ctrl-N to create the chat being checked.
This exercises New Claude Chat even before #29, when the app creates an initial chat automatically.
It also prevents existing #8 home/first-folder behavior from passing AC1 or AC3 while Cmd-N does nothing.
The intended first red assertion on the current implementation is `Story #30: Cmd-N/Ctrl-N must clear the old user history`, expecting zero chat-user-message elements.
After replacement is implemented, AC2 can fail at the configured-folder header/cwd assertion and AC5 at the problem notice or fallback assertion.
A missing #8 prerequisite or a launch failure is not a valid story #30 red baseline.
No Electron run was performed in the sandbox, so expected failures have not been measured.
Do not report expected failures as observed results.

## Keys and pinned Zed reference

New Claude Chat uses Cmd-N on macOS and Ctrl-N on Linux, the pinned Zed v1.23.2 agent::NewThread binding.
The existing byte-for-byte fixtures tests/fixtures/zed-keymaps/default-macos.json and default-linux.json were compared with the supplied read-only Zed source and match.
Their source URLs and git blob SHAs are recorded in tests/fixtures/zed-keymaps/README.md.
AgentPanel bindings are at macOS source line 258 and Linux source line 220.
Zed scopes these keys to its agent contexts; Cod's workspace-level New Claude Chat entry is specified by this story.
Stock Zed was not launched in this sandbox.
The story requires no look check.

## UI contract

All chat selectors are scoped to claude-chat inside the active workspace-area.

| Selector or accessible name | Required behavior |
| --- | --- |
| claude-chat | Visible current chat after Cmd-N/Ctrl-N |
| textbox "Message Claude" | Send an invented message with Enter; empty after replacement |
| chat-user-message, chat-assistant-message, chat-tool-call | Old history removed after replacement |
| chat-assistant-message data-state="complete" | A completed fake reply before replacing the chat |
| chat-working-directory | Header contains the absolute chosen folder path |
| chat-session-id | Header displays the session ID from the CLI; a fresh turn gets a different ID |
| chat-folder-notice | Visible single logical line explaining invalid settings or a missing default folder |
| start-screen | Optional #29 entry screen, opened into chat with Cmd-N/Ctrl-N |
| project-panel, project-root data-path | Existing folder-picker UI, confirming insertion order |
| project-add-folder | Keyboard folder entry before #29 |

chat-folder-notice is the only new test ID requested from the developer.
For invalid JSON its text names settings.json and says JSON is invalid or cannot be parsed.
For a missing folder its text contains the requested path and explains that it is missing or does not exist.
The notice has no embedded newline; responsive visual wrapping is allowed.
The exact sentence is not prescribed.

## Settings, cwd and fixture isolation

Each launch uses a fresh temporary HOME, USERPROFILE, XDG_CONFIG_HOME, CLAUDE_CONFIG_DIR and Electron user data directory.
The settings path is $XDG_CONFIG_HOME/cod/settings.json.
AC2's valid setting includes a JSON comment to require JSONC support.
AC3 launches separately with no settings file and with a file containing an unrelated invented key.
AC5 launches separately with malformed JSON and with a default folder path that does not exist.
The home fallback must equal the fixture home, never the operator's home.
The production fallback settings location remains ~/.config/cod/settings.json on both platforms as specified in the issue; these tests isolate settings through XDG_CONFIG_HOME.
The first-folder case supplies a conflicting configured default to verify that workspace folders take precedence.
Both workspace folders are real throwaway git repositories with invented notes.txt files.
The fixture removes credential variables and inherited COD_* overrides from child environments and passes only its own fake hooks.
It does not change the test worker's process.env or shared Electron helper.

## Fake process and session evidence

Use the existing COD_CLAUDE_BIN override and stream-json provider path.
The fake's start records must show the selected cwd and argv without --resume for a fresh chat.
The existing reply scenario provides complete deterministic turns.
COD_FAKE_CLAUDE_UNIQUE_SESSIONS=1 is an additive opt-in: a non-resumed launch without --session-id gets a new UUID instead of the historical fixed fake UUID.
Other tests retain the fake's previous behavior when this flag is absent.
A supplied --session-id and --resume still take precedence.
The fake session files and log live under the fixture CLAUDE_CONFIG_DIR, never ~/.claude.
These session files use the fake's existing log-based persistence format, not a claim about Claude's production storage layout.

AC4 captures the old session ID from the visible header, creates a fresh chat, verifies exactly two app CLI starts and no --resume on the second, and checks that the second turn contains only the new prompt under a new session ID.
It then spawns the fake CLI directly with --resume <old-header-id> and the same fixture environment/store.
The CLI must exit successfully, emit the old session ID, and retain the original prompt in its history.
This proves Cod preserves a CLI-resumable session through the fake interface; it does not run a real Claude account or inspect app internals.
Each launch attaches its fake JSONL log before cleanup, and a window screenshot on failure.
Artifacts contain fixture-only paths, messages and environment variable names.
Review screenshots before publishing them.

## Coverage

| AC | Test name | Assertions |
| --- | --- | --- |
| AC1 | Cmd-N starts Claude in the first workspace folder and shows it in the header | Two roots in insertion order, fresh history, first-folder header/cwd, no resume, configured default overridden |
| AC2 | an empty workspace starts Claude in the JSONC default_chat_folder and shows it | JSONC setting, fresh history, default-folder header/cwd, no resume |
| AC3 | an empty workspace without settings or without the key starts Claude at home | Separate absent-file and absent-key launches, fresh history, fixture-home header/cwd, no resume |
| AC4 | Cmd-N clears history, starts without resume and preserves the old CLI session | Empty history/composer, new session ID and prompt history, old header ID resumes successfully through fake CLI |
| AC5 | invalid JSON or a missing default folder falls back home with a one-line problem notice | Separate malformed-JSON and nonexistent-directory launches, visible problem-specific notice, fixture-home header/cwd, no resume |

## Run outside the sandbox

From this worktree root on macOS:

```sh
mkdir -p /tmp/cod-art/30
caffeinate -dimsu npx playwright test tests/e2e/ws2-new-chat.spec.ts --reporter=list > /tmp/cod-art/30/run.txt 2>&1
```

The npx invocation does not run the npm pretest build script, and Playwright global setup does not build the app. Run this first so the tests use current app sources:

```sh
npm run build
```

On Linux use the same Playwright command without caffeinate.
Return /tmp/cod-art/30/run.txt and any failure artifacts to QA to judge the five tests' failure reasons.
The test registration count and typecheck do not establish an Electron verdict.

## Local validation

`npm run typecheck` passed.
`npx playwright test tests/e2e/ws2-new-chat.spec.ts --list` registered exactly five tests and launched no browser or Electron process.
A Node-only smoke check passed for two distinct fresh fake session IDs and CLI resume of the old session with its original prompt history.
`node --test tests/fakes/claude/protocol.test.cjs` reported 9 passed and 1 failed: the existing interrupt case failed with `EMFILE: too many open files, watch`.
This is a watcher failure in the local environment, not evidence for a story acceptance verdict.
The new story uses only the reply scenario and does not use the interrupt scenario or its file watcher.
Electron acceptance failures remain unmeasured until the external run.
