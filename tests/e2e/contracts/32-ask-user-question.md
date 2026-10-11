# Story #32 developer contract

Story: #32 - Answer Claude's questions (AskUserQuestion) in the chat.
Requirements: A1, A4, sprint 2 obligation O1.4.
Branch: tests/32-ask-user-question.
Source: the full issue body supplied in the QA handoff.
Tests: tests/e2e/a1-a4-ask-user-question.spec.ts, exactly seven tests for AC1-AC7.

QA owns the spec, tests/e2e/helpers/ask-user-question.ts, the three tests/fakes/claude/scenarios/ask-user-question-*.json files, this contract and tests/fixtures/zed-elicitation/elicitation-v1.23.2.rs.
The developer owns app implementation, including permission routing and the chat view.
Do not weaken acceptance assertions or edit shared fake files to bypass the real permission host.
Expected hand-back: implementation PR, unchanged acceptance assertions, test output, live Claude 2.1.296 check of updatedInput.answers, and the required look comparison.
QA must review protocol evidence before any fixture change caused by the live check.

## Prerequisite and red baseline

The existing Claude chat and MCP permission host must work before establishing the #32 baseline.
Each test sends an invented composer message and checks that the fake's permission-request matches the scripted AskUserQuestion input through Cod's MCP tool.
It then asserts chat-question-form is visible with the message: `Story #32 question UI is missing: AskUserQuestion must show answerable questions instead of a raw permission prompt`.
Today the generic permission prompt is rendered instead, so this is the intended missing-feature failure for all seven tests.
A failed request prerequisite, fake crash or app launch is not a valid #32 failure.
Electron has not been run in the sandbox; expected failures are not measured failures.

New workspaces work both before and after #29: when start-screen is visible, the fixture presses Cmd-N on macOS or Ctrl-N on Linux before using the composer.
These tests do not add folders and need no project-panel Add Folder control.
Reply assertions use rendered text and completion state, so markdown rendering from #31 is compatible.

## Fake and isolation

The story-specific helper extends the existing Electron fixture with an automatic fake fixture initialized before launch.
Each test gets a fresh temp CLAUDE_CONFIG_DIR, fake log, gate directory and Electron user-data directory.
The config directory is empty invented state, never the real ~/.claude.
Credential variables are removed before Electron starts and restored after teardown.
The shared fake CLI and MCP client are unchanged.
The app launches the scripted fake via COD_CLAUDE_BIN and configures its real permission MCP tool.
The fake logs permission-request and permission-answer from that MCP tools/call path, and emits a deterministic next reply after receiving an answer.
The reply alone cannot prove correct answers; AC4 and AC5 inspect the recorded permission result as well.
The fake never runs a real agent or shell command.
Logs are attached before cleanup and contain invented inputs only.

| Scenario | Data |
| --- | --- |
| ask-user-question-counts | Four turns containing one, two, three and four questions; options cover two, three and four choices |
| ask-user-question-keyboard | Four single-choice questions, each with four options |
| ask-user-question-mixed | Single choice, multiple choice, then single choice for free text |

An allow result preserves input.questions and adds updatedInput.answers keyed by the exact question text.
Single choice returns its label, Other returns the exact typed string, and multiSelect returns the chosen labels.
AC5 accepts an array of labels or a comma-separated string because the issue does not prescribe that serialization; it checks the exact set with no extra labels.
The developer must settle the real Claude format with the live check required by the issue and record the evidence in the PR.
Denial is exactly `{ "behavior": "deny", "message": "The user declined to answer" }`.

## UI and keyboard contract

All hooks are in claude-chat within the active workspace-area and describe rendered UI, not app internals.

| Hook or role | Meaning |
| --- | --- |
| chat-question-form | Visible pending question card in the transcript |
| group named by exact question text | One group per question containing its header, question text, choices and descriptions |
| radio named by exact option label | Single-choice option; use a separate accessible description for option description and numbering |
| checkbox named by exact option label | Multiple-choice option |
| radio or checkbox named Other | Extra free-text option after the supplied choices |
| textbox named Other answer | Free-text input within its question group |
| button named Submit | Explicit submission after committing the last question |
| chat-question-history | Collapsed submitted question card retained in the transcript |
| button named Questions and answers | History disclosure with aria-expanded=false after submission |
| chat-question-answer | One visible summary row per question, with the exact question text and answer |

The first supplied option receives focus when the question arrives and when advancing to the next question.
Down and Up move option focus; numeric keys 1-4 focus the corresponding supplied option.
Enter commits a single choice and advances to the first option of the next question, or to Submit after the last one.
The committed radio remains checked until submission.
For multiple choice, Space toggles the focused checkbox, arrows move focus, and Enter commits the selected set and advances.
The selected checkboxes remain checked until submission.
Other is reached with Down after the supplied options.
Enter on single-choice Other or Space on multiple-choice Other moves focus to Other answer.
Typing followed by Enter commits the text and advances, just like a label answer.
Choosing only Other on a multiSelect question also returns the typed string.
The tests do not prescribe mixing named choices and Other on the same question.
Enter on Submit sends exactly one permission answer; committing questions alone does not send one.
Escape from the question sends the exact denial immediately, without opening a generic denial-reason form or interrupting Claude.
Submitted history shows each question and answer while collapsed, with no live radio or textbox controls.

## Criterion coverage

| AC | Evidence to collect |
| --- | --- |
| AC1 | All four question-count cases, headers, exact text, labels, descriptions, no generic prompt; screenshot of the four-question card |
| AC2 | Down, Up and all four numeric shortcuts, checked single choices, next-question and Submit focus, no early permission answer |
| AC3 | Two toggled checkboxes remain checked, a third remains unchecked, focus advances |
| AC4 | Other typed text reaches the permission result for single and multiple choice questions |
| AC5 | Exact question keys, preserved questions, chosen label, exact multi-label set, quoted free text, complete next reply |
| AC6 | Exact denial result, completed continuation reply, enabled composer, no interrupt or fake tool execution |
| AC7 | Collapsed disclosure state and visible per-question answer summaries retained after completion |

## Pinned Zed reference and manual look check

Pinned byte for byte: tests/fixtures/zed-elicitation/elicitation-v1.23.2.rs.
Upstream: https://github.com/zed-industries/zed/blob/c0199504b9cce79bc27524950022ed701bc3ebd5/crates/agent_ui/src/conversation_view/elicitation.rs.
Local read-only checkout: /Users/butvinm/Dev/3rd-party/zed-v1.23.2, commit c0199504b9cce79bc27524950022ed701bc3ebd5.
The reference implements single-select radio indicators, multi-select checkboxes, option label and muted description, and Submit actions.
It is an ACP elicitation view, so the issue's AskUserQuestion keyboard rules and transport remain the authority for these tests.
Stock Zed and Claude Code UI have not been launched here.
Manual check has no automated acceptance test: compare the four-option question to Claude Code's terminal question UI and stock Zed 1.23.2 elicitation where applicable.
The AC1 screenshot is evidence to inspect before sharing, not a completed look comparison or validated clip.
Plan approval and questions from Codex are out of scope.

## Run outside the sandbox

From this worktree root on macOS, build and run with:

```sh
mkdir -p /tmp/cod-art/32
caffeinate -dimsu npm run test:e2e -- tests/e2e/a1-a4-ask-user-question.spec.ts --reporter=list > /tmp/cod-art/32/run.txt 2>&1
```

On Linux omit caffeinate.
The npm command runs the pretest:e2e build before Playwright.
Return /tmp/cod-art/32/run.txt and test-results evidence to QA for a measured verdict and confirmation that all seven tests fail at the missing-question-UI assertion.
Do not mark the story or any criterion PASS from typecheck alone.
