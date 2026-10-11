# Story #33 developer contract

Story: #33 Switch a chat's permission mode with Shift+Tab.
Requirement: A4, obligation O1.5.
Branch: tests/33-permission-mode.
Acceptance tests: tests/e2e/a4-permission-mode.spec.ts, exactly one test for each of AC1-AC6.

QA owns this spec, this contract, tests/fakes/claude/permission-mode.cjs and tests/fixtures/zed-permission-mode/.
The developer owns the app implementation and must preserve the acceptance assertions.
No shared helper or shared fake file is changed by this handoff.
Expected hand-back: implementation PR, unchanged tests, typecheck output, Electron run output, composer screenshot next to stock Zed, and confirmation of the protocol assumptions below.

## UI and keyboard

All locators are scoped to the active workspace-area's claude-chat.
Wrap the composer textbox and mode selector in data-testid=chat-composer-area.
Use a button with data-testid=chat-permission-mode within that area, showing exactly Manual, Accept Edits, Plan or Auto.
The label itself is the menu trigger.
Use role=menu with accessible name "Permission mode" and four menuitemradio entries in the order Manual, Accept Edits, Plan, Auto.
The selected entry should have aria-checked=true.
The menu may live within the chat or an accessible descendant; these tests scope it to the chat.

Shift+Tab with Message Claude focused cycles Manual -> Accept Edits -> Plan -> Auto -> Manual.
Keep composer focus and draft text when cycling.
The selector must be reachable by Tab.
Enter opens the focused selector, Home focuses Manual, ArrowDown moves to Accept Edits, and Enter chooses the focused entry and closes the menu.
Clicking the selector and choosing Auto also works.
Home is the chosen standard menu navigation contract, not a claim that Zed binds Home in this context.

## Settings and process

Each Electron instance has its own user profile and CLAUDE_CONFIG_DIR with an invented settings.json.
AC3 opens one instance with permissions.defaultMode=auto, sends its first message, and checks Auto plus --permission-mode auto.
It then opens a fresh isolated instance with an empty settings object and checks Manual plus a manual startup mode (explicit --permission-mode manual or the CLI's default with no flag).
Never read the operator's real ~/.claude in this suite.
AC5 cycles an unstarted chat to Plan, asserts no start records yet, sends a message, and checks --permission-mode plan.
Mode values map Manual -> manual, Accept Edits -> acceptEdits, Plan -> plan, Auto -> auto.

COD_CLAUDE_BIN points to the separate executable tests/fakes/claude/permission-mode.cjs.
Pass through COD_FAKE_CLAUDE_LOG, COD_FAKE_CLAUDE_GATES and COD_FAKE_CLAUDE_MODE_REPORT to that child, as other fake-only hooks are passed through today.
The fake requires the existing print/stream-json/verbose/include-partial-messages flags and reuses the shared stream scenario's event data without changing it.
It logs start argv, pid, stdin, control requests, emitted events, mode reports and signals, using only invented inputs.
It waits at a finish gate to keep the same process and turn alive during AC4.
Each test attaches its protocol log before removing temporary data.

AC4 cycles through all four new modes during the pending turn and checks one set_permission_mode request for each, same PID, no start or termination, and successful completion after releasing finish.
The fake accepts newline-delimited {type:"control_request", request_id:"...", request:{subtype:"set_permission_mode", mode:"acceptEdits"}} and replies {type:"control_response", response:{subtype:"success", request_id:"...", response:{}}}.
This is a story-specific protocol assumption, not a schema documented by the supplied issue or proof of live CLI compatibility.
If the host uses initialization control messages, the fake acknowledges them without treating them as mode changes.

AC6 starts in Plan and sends a message.
The fake waits for report-mode before emitting {type:"system", subtype:"status", status:null, permissionMode:"manual", session_id:"...", uuid:"..."} and waits at finish afterward.
The UI must follow that report without keyboard input, sending set_permission_mode back, or restarting Claude.
The mode-report event shape is also an explicit protocol assumption that needs an authorized CLI check before compatibility is accepted.
If the installed Claude reports modes in a different envelope, return evidence to QA for a fixture correction before changing assertions.

## Coverage and red baseline

| AC | Coverage |
| --- | --- |
| AC1 | Visible named mode button and composer screenshot |
| AC2 | Full cycle and wrap, focus and draft preservation, four-entry mouse menu and keyboard selection |
| AC3 | Auto from isolated Claude config on a new chat and first-process argv; clean-config Manual fallback |
| AC4 | All four control-request mode values, same process throughout pending turn and completion |
| AC5 | No process before send, chosen Plan label and startup argv |
| AC6 | Process-reported Plan -> Manual, no mode-request echo or restart |

All six tests first assert the missing mode button with message "Story #33 composer permission mode must show <name>".
The chat prerequisite must already exist; a prerequisite, fixture, syntax or launch failure does not establish the #33 red baseline.
No Electron tests have been run in the sandbox, so failures are expected but unmeasured.
No criterion is accepted until the outside-sandbox run supplies actual assertion output.

Run from this worktree root on macOS:

```sh
mkdir -p /tmp/cod-art/33
caffeinate -dimsu npm run test:e2e -- tests/e2e/a4-permission-mode.spec.ts --reporter=list > /tmp/cod-art/33/run.txt 2>&1
```

The npm pretest hook builds the app first.
Return /tmp/cod-art/33/run.txt to QA for measured FAIL/PASS per AC and red-baseline validation.
Regression verification after implementation should include a1-claude-chat.spec.ts and a4-permissions.spec.ts.
