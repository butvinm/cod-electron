# Story #9 developer contract

Story: #9 - Answer Claude's permission requests in the chat.
Branch: tests/9-permissions, based on story #8 tests.
Source: artifacts/9/issue.md.
Tests: tests/e2e/a4-permissions.spec.ts, 10 scenarios covering AC1-AC5.

QA owns this contract, the acceptance spec and tests/fakes/claude/.
Developer owns app implementation of the permission host and UI, and must preserve the acceptance assertions and story #8 contracts.
Expected hand-back: implementation PR, unchanged assertions, documented S shortcut, run output, pending-prompt screenshot and confirmation of inferred protocol shapes against an authorized real CLI check.
No app code, commits, staging, PR or network operations are part of this handoff.

## Prerequisite and intended red baseline

Story #8 chat is being built in parallel.
Run on an app that already satisfies the #8 chat launch/composer contract.
Every #9 scenario sends an invented message, then asserts that chat-permission-prompt is visible with the message: `Story #9 permission prompt is missing: the pending MCP request must be answerable in the chat`.
If #8 has not landed, the prerequisite chat assertion can fail instead; that does not establish a red baseline for #9.
The fake holds a missing permission host pending without emitting an invented stdio approval request or crashing.
No Electron run has been performed, so these are intended failures, not measured verdicts.

## Production path and fake

Use story #8's COD_CLAUDE_BIN override, streaming flags, native session persistence and isolated Electron harness.
Pass COD_FAKE_CLAUDE_* hooks through to the child.
Cod supplies `--permission-prompt-tool <name>` and `--mcp-config <file-or-json>` for its real local MCP approval server.
The fake loads that config, initializes the server, discovers the named tool and calls it before scripted tool_use/tool execution.
HTTP must use loopback with type=http; stdio uses command, args and optional env and is started by the fake CLI from Cod's config, as the CLI starts local stdio MCP servers.
Do not supply a QA server from the Electron fixture or exchange undocumented approval messages on Claude stdin.
Cod owns server implementation, UI routing and cleanup; the fake owns the client only.
MCP client transport is JSONL stdio or Streamable HTTP POST with JSON/SSE responses.
Legacy SSE and WebSocket are outside this fixture's scope.
The scripted command is never executed as a real shell command.

The saved docs establish the flag/config contracts but do not specify permission request/response fields or MCP JSON-RPC framing.
The fake uses inferred request `{ "tool_name": "Bash", "input": { "command": "printf cod-permission-fixture" } }` and text-content JSON answer `{ "behavior": "allow", "updatedInput": { "command": "printf cod-permission-fixture" } }` or `{ "behavior": "deny", "message": "<reason>" }`.
Do not treat these shapes as documented by the supplied pages.
See tests/fakes/claude/README.md for the exact source sections and limitations.
If a real CLI check contradicts these shapes, return evidence to QA before changing the fixture or tests.

## UI and keyboard contract

All selectors are scoped to claude-chat inside the active workspace-area.

| Selector or accessible name | Meaning |
| --- | --- |
| chat-permission-prompt | Visible pending prompt in the real transcript, with tool name and full command |
| chat-session-status | Visible session status, including "needs input" while permission is pending and a different status after completion |
| button "Allow once" | Initial focused choice when a focused chat receives a prompt; Enter activates it |
| button "Allow for this session" | Session choice, aria-keyshortcuts="S"; show S in the prompt as shortcut help |
| button "Deny" | Enters denial form |
| textbox "Denial reason" | Focused after Esc or Deny; short optional reason |
| button "Send denial" | Submits the reason; Enter in the reason field also submits |

Lowercase s while the choices have focus allows for the session.
Tab moves Allow once -> Allow for this session -> Deny, and Shift+Tab reverses.
Right/Down move forward through choices; Left/Up move backward.
Enter activates the focused choice; it must not always invoke Allow once when another choice has focus.
Esc from the pending choices opens the denial form and must not interrupt the Claude process.
Buttons also work by clicking.
No wraparound behavior or reason-form Esc behavior is prescribed.
Session approval caching belongs to Cod's host in this contract: the fake calls the permission tool for every identical request and never caches approval itself.
Return a plain allow answer with updatedInput for cached requests, without showing another prompt.
Allow once must show the next identical request again.
Session approval must be scoped to the real session and not persisted as a permanent rule; these tests exercise the same session across two turns, not cross-session isolation.
S is a story-specific chosen key, not a claim about the stock Zed keymap.

## Coverage and evidence

| AC | Scenario coverage |
| --- | --- |
| AC1 | Tool/command/choices, needs input, no premature execution or answer, pending-prompt screenshot |
| AC2 | Enter once and repeat prompt; documented S and no repeated prompt; Esc denial; Tab/Shift+Tab and all four arrows; clicks on all choices |
| AC3 | Quoted denial reason arrives unchanged in the MCP answer and transcript |
| AC4 | Separate allow and deny tests assert answer log, execution or no execution, complete transcript reaction and cleared pending status |
| AC5 | CLI flags, local MCP connection, named-tool request and answer, no approval control messages on Claude stdin |

Each Electron scenario attaches the fake JSONL log before fixture cleanup.
Logs contain only invented user inputs, permission data, argv and environment names; server stderr and env values are not copied.
The AC1 screenshot needs PM comparison with stock Zed before publishing.
This is not a validated stakeholder clip.
Fake checks prove host plumbing, not full real Claude compatibility or lifecycle/source review of Cod's MCP server.

## Run outside the sandbox

After story #8 implementation is present, run from this worktree root on macOS:

```sh
caffeinate -dimsu npx playwright test tests/e2e/a4-permissions.spec.ts --reporter=list > artifacts/9/run.txt 2>&1
```

Then check story #8 regression compatibility through the real app:

```sh
caffeinate -dimsu npx playwright test tests/e2e/a1-claude-chat.spec.ts --reporter=list > artifacts/9/story-8-regression.txt 2>&1
```

Return the output to QA for measured PASS/FAIL per criterion and confirmation that all 10 #9 tests fail at the missing-permission assertion before development.
Node-only fake checks run without Electron: `node --test tests/fakes/claude/protocol.test.cjs`.
