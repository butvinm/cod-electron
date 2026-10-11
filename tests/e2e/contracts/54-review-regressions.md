# Story #54 developer contract

Story: #54 Regression tests for bugs found in sprint 2 reviews.
Mode: write-tests.
Branch: tests/54-review-regressions.
Source: the full issue body supplied in the QA handoff.
Requirements: review follow-ups for #29, #31 and #37.
Tests: tests/e2e/regressions-54.spec.ts, eight tests covering six criteria, including three AC5 paths.

QA owns the new spec, this contract and the five story-specific tests/fakes/claude/scenarios/54-*.json files.
Existing helpers, shared scenarios and app code are unchanged.
The developer owns the app fixes for the criteria, including the two AC5 follow-ups from review PR #62, and must preserve these acceptance assertions.
Expected hand-back: implementation PR, unchanged acceptance tests, typecheck output and Electron run output with traces or screenshots for failures.
No commits or Electron runs are made in this write-tests handoff, as explicitly requested by the PM.

## Acceptance criteria and expected baseline

| AC | Required behavior and coverage | Expected current result |
| --- | --- | --- |
| AC1 | Open A, add B in the same workspace, verify B is initially most recent, reopen A through Open Recent, create an empty workspace, verify the list is A then B, press Cmd-1 and verify only A opens | PASS |
| AC2 | Render a reference link with its definition inside a blockquote, click it, record its system-browser handoff and verify Cod does not navigate or create a window | PASS |
| AC3 | Render a fence with exactly one blank body line, verify raw code text is exactly one newline and its content height is one line | FAIL |
| AC4 | Open one file, verify its row is gray, close the editor tab with Cmd-W and verify all project rows lose the open-file gray | PASS |
| AC5 | During a gated streaming reply and then a pending permission prompt, open the mode menu and Escape; verify menu closure, selector focus, unchanged mode, no interruption, unchanged unanswered prompt and successful continuation on the same process | PASS |
| AC5 arrival | Open the mode menu while a reply streams, release a gated permission request, verify the menu retains focus, then Enter selects Manual and closes the menu while permission stays pending with no answer or tool execution | FAIL expected from review #62 |
| AC5 selector | Release a gated AskUserQuestion request, focus the selector with its menu closed, press Escape and verify the unchanged pending question, no history, no answer, no extra stdin and no interruption | FAIL expected from review #62 |
| AC6 | Escape from a pending question, verify exact MCP denial and completed continuation, then verify one visible collapsed Declined history line with no live question inputs | FAIL |

These are expected results from the supplied handoff and static inspection, not measured PASS/FAIL verdicts.
The normal all-red write-tests rule is overridden by the explicit request to cover four regressions already fixed on master.
There are no expected-failure annotations, skipped tests or relaxed assertions.
All eight tests must pass after implementation.

AC3's intended failure is `AC3: preserve one blank line without appending a second newline`: expected `"\n"`, current rendering produces `"\n\n"`.
The height assertion also checks the visible code body after removing padding and borders, using the computed line height rather than a fixed pixel value.
AC6's intended failure is `AC6: declined questions must remain in chat history`: expected one chat-question-history element, current denial removes the form without retaining history.
A fixture, syntax, launch or prerequisite failure does not establish either missing-feature baseline.
No actual failure message is claimed before the outside-sandbox run.

## Fixtures and isolation

The spec extends the shared real-Electron fixture with an automatic setup fixture that runs before launch.
Each test gets two throwaway real git repos, an empty invented CLAUDE_CONFIG_DIR, fake protocol log, gate directory and the shared helper's isolated Electron profile.
The fixture removes inherited COD_* overrides and agent credential variables for the run and restores them at teardown.
Folder selection uses the existing COD_TEST_PICK_FOLDERS hook.
The fake protocol log is attached before temporary data is removed.
Logs contain invented data only.

| Scenario | Use |
| --- | --- |
| 54-quoted-reference | AC2: existing reply envelopes with `[Read the quoted reference][orchard]` and `> [orchard]: https://example.invalid/story-54#quoted` |
| 54-blank-code | AC3: existing reply envelopes with the exact payload `"```\n\n```"` |
| 54-stream-then-permission | AC5: unchanged stream turn followed by the unchanged first permissions turn; finish gate holds the reply until the menu assertions finish |
| 54-permission-arrives-in-mode-menu | AC5 arrival: first stream fragment, permission-arrival gate, then a Bash permission request in the same turn; explicit Allow once produces the invented completion |
| 54-question-selector-escape | AC5 selector: question-arrival gate before a single invented AskUserQuestion; deliberate submission continues the fixture |
| ask-user-question-keyboard | AC6: existing question request, exact denial and continuation through the real MCP permission host |
| reply | AC1 and AC4: safe default fake if a process is unexpectedly started; these tests do not send agent messages |

AC6 reuses the existing pending and response helpers to verify transport before checking history.
AC5 verifies the reply remains streaming after Escape, releases finish and waits for completion before starting the permission turn.
The permission prompt stays unanswered after Escape, then Allow once explicitly resolves it to prove the chat can continue.
The two new AC5 scenarios are selected by exact test title; existing criterion defaults and shared scenarios are unchanged.
AC5 arrival waits for the gate and opens the menu before releasing the request, so prompt timing does not depend on sleeps.
Enter selects the already active Manual item, closes the menu and returns focus to the selector without answering the request.
AC5 selector releases the question gate and waits for the request and form before focusing the closed selector and pressing Escape.
Both tests inspect unanswered protocol logs before deliberately answering through the prompt or question form, then require exactly one allow response and completed continuation.
The question test also checks that only the original user message reached Claude stdin before deliberate submission.
No real agents, shell tools or external websites are called.

## UI and keyboard contract

Use existing roles and hooks: workspace-tab, workspace-area, start-screen, Recent list, recent-folder with data-path, Open Recent dialog, Search recent folders textbox, recent options with data-path, project-panel, project-root, treeitem with data-path, file-finder, file-finder-query, file-finder-result, editor-tab and editor-content.
Chat hooks are scoped to the active workspace-area's claude-chat: chat-user-message, chat-assistant-message with data-state, chat-permission-mode, chat-permission-prompt, chat-interrupted, chat-question-form and chat-question-history.
The mode menu retains role=menu named Permission mode and a Manual menuitemradio.
AC6 reuses chat-question-history for the retained declined card and requires a button named exactly Declined with aria-expanded=false.
The collapsed history has no live radio or textbox controls.
This is a proposed rendered-UI hook contract for the new decline state, not a request to expose internal state.
No new IPC or main-process hooks are needed.

AC2 reuses COD_TEST_RECORD_EXTERNAL_URLS=1 and __codTestOpenedExternalURLs to observe the existing system-browser handoff without launching a browser.
Markdown code is inspected through semantic pre > code elements, never layout classes or parser internals.
AC4 compares every rendered tree row's computed background to element.selected from the pinned One Dark theme.
The open-file highlight is asserted first so a panel that never highlights cannot pass.

macOS keys: Cmd-O, Cmd-Shift-A, Alt-Cmd-O, Cmd-Shift-N, Cmd-1, Cmd-P, Cmd-W and Cmd-N.
Linux uses Ctrl in place of Cmd; Open Folder is the existing Ctrl-K then Ctrl-O chord.
New Workspace comes from the existing zed-keymaps helper; no new Zed behavior or look comparison is introduced.
Other paths use Enter and Escape through page.keyboard.
The one mouse action is the link click explicitly requested by AC2.

## Run outside the sandbox

From the worktree root on macOS:

```sh
mkdir -p /tmp/cod-art/54
caffeinate -dimsu npm run test:e2e -- tests/e2e/regressions-54.spec.ts --reporter=list > /tmp/cod-art/54/run.txt 2>&1
```

The npm pretest:e2e script builds the app before Playwright runs.
On Linux omit caffeinate.
Return /tmp/cod-art/54/run.txt and any test-results traces or screenshots to QA for a measured verdict.
The original six-test baseline expectation was 4 passed, 2 failed, 0 skipped.
The two added AC5 tests are expected to fail against PR #62 for the focus-stealing and global Escape paths described in /tmp/cod-art/54/review-62.md.
The first intended failure is the mode menu closing or losing Manual focus when permission arrives.
The second intended failure is the pending question disappearing after Escape on the closed selector; the original tests branch may fail earlier at selector focus, before PR #62's focusin fix.
These expectations are from static inspection only; no Electron run or measured verdict is claimed.
Typecheck alone cannot establish a criterion PASS or FAIL.
Other changes, clips, a look check, commits and PR publication are outside this handoff.
