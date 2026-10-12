# Story #35 developer contract

Story: #35 - Continue a Cod chat in the terminal.
Requirement: A2, sprint 2 obligation O1.7.
Branch: tests/35-continue-in-terminal.
Tests: tests/e2e/a2-continue-in-terminal.spec.ts, exactly one test per AC1-AC4.

QA owns the acceptance spec, tests/e2e/helpers/continue-in-terminal.ts, this contract and the additive exit-log change in tests/fakes/claude/claude.
The developer owns app code implementing the header action, clipboard copy and process lifecycle.
Preserve these assertions; return fixture or contract problems to QA with evidence.
Expected hand-back: implementation PR, unchanged acceptance assertions, typecheck and Electron run output, and the real CLI check described below recorded in the PR.

## Acceptance criteria

- AC1: A chat with a session id has a keyboard-reachable Continue in Terminal button in its header. Activation copies `cd '<chat folder>' && claude --resume <session id>` and briefly shows Copied.
- AC2: Copying from an idle chat ends its Claude process, with an exit record from the fake.
- AC3: Sending after handoff starts Claude again with `--resume <same id>` in the same folder.
- AC4: During a running turn the button is disabled and its tooltip says to wait or interrupt first.

## UI and keyboard contract

Selectors are scoped to claude-chat inside the active workspace-area.
Keep the existing Message Claude textbox, chat-assistant-message with data-state, chat-user-message, chat-session-id and chat-working-directory selectors.
Add data-testid="chat-header" to the real chat header so the tests can establish where the action and feedback live without selecting a layout class.
Expose a native button with accessible name "Continue in Terminal" and normal Tab traversal from the composer.
Enter activates the focused button.
Show exact text "Copied" inside the header after a successful activation; clear it within five seconds and restore the Continue in Terminal action name if the label changed.
The feedback can be the button label or separate header text.
Use a native disabled button during a running turn and a title tooltip containing both "wait" and "interrupt", for example "Wait for the turn to finish or interrupt first".
AC4 checks the title attribute, avoiding timing and pointer-dependent native tooltip rendering.
After the gated turn completes the button becomes enabled.
No special keyboard shortcut for handoff is prescribed.

Setup works on both sides of story #29: if start-screen is visible, Cmd-N on macOS or Ctrl-N on Linux opens the chat.
Cmd-Shift-E or Ctrl-Shift-E shows the project panel.
Before #29, setup uses the existing Add Folder button with keyboard focus and Enter; when that button is absent it uses Cmd-Shift-A or Ctrl-Shift-A.
The existing COD_TEST_PICK_FOLDERS hook supplies a single invented folder.
These are Cod setup contracts, not a new claim about stock Zed behavior.
There is no look check or upstream fixture requirement for this Cod-specific feature.

## Fixture and process contract

The shared Electron harness launches the real app with isolated user data.
The new automatic fixture sets COD_CLAUDE_BIN to the existing scripted fake and isolates its log, gates, session state and CLAUDE_CONFIG_DIR in a temporary directory per test.
It removes shell Claude and Anthropic credential variables and restores the worker environment afterward.
The fixture never accesses real ~/.claude.
The folder is a real throwaway git repo named "terminal orchard", intentionally containing a space to exercise command quoting.
The test checks the clipboard text exactly, including the single quotes around the folder, &&, the production command name claude and the same session id.
The fake binary path must never appear in the copied command.
Paths containing an apostrophe are outside this fixture's coverage; production shell quoting still needs to handle them safely.

AC1-AC3 reuse the reply scenario, whose second turn remembers the first message through the fake's persisted session state.
AC4 reuses stream, held at its finish gate until QA releases it after checking the disabled action.
The only shared fake change is an exit record `{kind: "exit", pid, code, session_id}` from the existing process exit handler.
It records normal EOF and handled SIGINT/SIGTERM exits without changing the scripted protocol or turn data.
SIGKILL cannot run an exit handler, so an idle handoff must shut down gracefully to satisfy the explicit exit-log criterion.
No particular graceful signal or exit code is required by the tests.
AC2 establishes that the original idle process is alive before copying and then verifies both its exit log and actual OS process death, with no replacement process or extra turn.
AC3 waits for shutdown before sending, verifies a different process id, the adjacent --resume argument and id, both process working directories, the stable visible session id and retained prompt history.
Reading fake logs and OS process liveness is observation; tests never call Cod's handoff implementation through IPC or preload internals.
The Electron evaluate calls access only the real OS clipboard to seed, read and restore common clipboard formats.
Replies are checked with toContainText and data-state rather than assuming plain-text DOM, for compatibility with story #31 markdown rendering.
Fake JSONL logs are attached as story-35-fake-log before cleanup, including exit evidence after app teardown.
All inputs and fixture files contain invented data.

## Intended red baseline and execution

The current app has a Claude header and session id but no Continue in Terminal action.
All four tests are intended to fail at `Story #35 Continue in Terminal button is missing from the chat` after their existing chat/fake prerequisites succeed.
This is a predicted failure, not a measured Electron result.
A missing chat, broken folder picker or launch error is a prerequisite failure and does not establish the story's red baseline.
QA did not launch Electron or browser tests and did not commit, as instructed in this handoff.
`npm run typecheck` passed.
The Node-only fake protocol suite returned 9 passed and 1 failed at protocol.test.cjs:66 with `EMFILE: too many open files, watch` in its interrupt scenario.
A separate temporary copy using the unmodified HEAD fake reproduced the same full-suite failure, so this is not evidence of an exit-log regression.
Recheck the fake suite outside the sandbox if the watcher failure persists.

Run from the worktree root outside the sandbox on macOS:

```sh
mkdir -p /tmp/cod-art/35
caffeinate -dimsu npm run test:e2e -- tests/e2e/a2-continue-in-terminal.spec.ts --reporter=list > /tmp/cod-art/35/run.txt 2>&1
```

The npm pretest:e2e script rebuilds the app before Playwright starts.
On Linux omit caffeinate.
Return /tmp/cod-art/35/run.txt and any trace/screenshot paths to QA to confirm all four fail for the missing feature before implementation.

## Manual real CLI check

Before the implementation PR, copy the command from Cod using an authorized real Claude installation, run it in a terminal and verify the conversation continues.
Record the result in the PR using invented messages and a non-work folder.
There is no automated test for this manual check.
The fake proves host wiring and lifecycle, not interactive terminal compatibility.
Loading turns written in the terminal when returning to Cod and Codex support are out of scope.
