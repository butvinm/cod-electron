# Story #34 developer contract

Story: #34 - Open files Claude reads, edits or mentions from the chat.
Branch: tests/34-open-files-from-chat.
Requirements: A1, C1, sprint 2 obligation O1.6.
The issue body supplied in the QA handoff is the source of the five criteria.
No network access is needed.

QA owns tests/e2e/a1-c1-open-files-from-chat.spec.ts, tests/e2e/helpers/chat-files-34.ts and this contract.
Developer owns implementation under src/ and must leave the acceptance assertions unchanged.
Expected hand-back: implementation PR, unchanged tests, measured output per criterion, and the regression suite output.
No app code, shared helper or shared fake runner was changed by QA.

## Real app and invented fixtures

Reuse the real _electron.launch harness in tests/e2e/helpers/electron.ts with an isolated app profile per test.
The automatic story fixture creates three real temporary git repositories in order: orchard, harbor and meadow.
It copies the existing scripted fake Claude CLI and its MCP client into the temporary directory, preserving executable permissions, and generates one scenario in that copy's scenarios directory.
The generated scenario uses the existing stream-json protocol, with unique tool IDs and assistant message IDs, four successful tool results, one text reply and a successful turn result.
It does not request permissions or access any real agent or account.
The Edit and MultiEdit files contain the successful replacements before the transcript is replayed.
The fixture supplies an empty temporary CLAUDE_CONFIG_DIR, clears inherited agent credential variables, restores environment values after each test and removes all temporary files after Electron teardown.
The fake runner stores its invented session state next to the fixture log.
No real ~/.claude content is read or written by the story fixture.

COD_TEST_PICK_FOLDERS supplies three successive native folder-picker answers.
Before #29, setup uses the existing project panel's Add Folder button with focus and Enter.
If start-screen is visible on initial launch, setup presses Cmd+N on macOS or Ctrl+N on Linux to open the chat, and uses Cmd+Shift+A or Ctrl+Shift+A to add folders.
It waits for each project's root path and for the chat working folder before sending the prompt.
This keeps the tests compatible with both versions of workspace startup.
The reply contains both plain text and backtick inline code so #31's markdown rendering is exercised after that dependency merges.

## DOM and interaction contract

Reuse workspace-area, claude-chat, chat-working-directory, chat-tool-call, chat-assistant-message, project-root, editor-tab and editor-content.
Reuse the Message Claude textbox, editor tabs with role=tab and aria-selected=true, their absolute data-path values, and complete reply data-state.
No additional data-testid or test-only application API is requested.

Every openable file path has accessible role=link and its displayed path, including any line/column suffix, as its exact accessible name.
Tool links are visible in the tool row without expanding the details.
They must support click, normal Tab and Shift+Tab focus, and Enter activation.
AC4 starts with focus inside the Conversation log, using its first focusable button or link for Tab and its last for Shift+Tab.
It visits the tool and reply targets in transcript order for Tab and reverse order for Shift+Tab.
After Enter opens and focuses the editor, it restores focus to the previous transcript link before navigating to the next target.
Focus must remain inside the history while reaching each target.
The PM revised AC4 to start in the history because Shift+Tab in the composer cycles permission mode (#33) and Tab in the editor indents, matching Zed.
A keyboard path from the composer into the history is separate story #64.
Avoid nesting the path link inside the tool summary button; the summary must remain independently expandable.
Inline-code paths retain their code presentation inside the link.
Missing files and existing files outside the allowed roots remain text without link role.
Do not launch an external browser for these local file links.

Opening a link activates the correct editor tab and focuses editor-content.
Line and column suffixes use one-based coordinates; a line without a column starts at column 1.
No caret destination is prescribed for a bare path, Read or Write.
Edit targets the first changed line, line 7 in the fixture.
MultiEdit targets the earliest changed line in file order, line 4, even though the edits array lists line 15 before line 4.
The tests observe the native collapsed browser selection inside the real contenteditable DOM to check coordinates.
They do not read CodeMirror state or inject renderer behavior.
Small fixtures keep all 20 lines rendered so direct DOM child order corresponds to file line order.

## Criteria and coverage

| AC | Test and required outcome |
| --- | --- |
| AC1 | Click Read, Edit, MultiEdit and Write paths; verify absolute active editor paths; verify Edit line 7 and MultiEdit line 4 |
| AC2 | Each of src/a.ts, src/a.ts:12 and src/a.ts:12:5 has two links, one plain and one inline code; click all six, checking line/column where present, including reopening an already open tab |
| AC3 | Existing src/a.ts is a positive control; missing paths in bare, line and line/column forms remain text; an existing absolute outside file, its inline-code position form and ../outside.ts remain text; no editor tab opens |
| AC4 | Starting in chat history, all four tool links and both plain/inline position links are reached in order with Tab and in reverse order with Shift+Tab; Enter opens the same file and coordinates as click; focus returns to history before the next target |
| AC5 | The chat's working folder wins a three-root same-path collision; the next root wins a fallback collision in roots two and three; a path only in the last root opens; an absolute path inside the last root opens at its coordinates |

The current chat working folder is the first workspace folder, as defined in src/agents/chats.ts.
AC5 checks that production UI arrangement plus ordered fallback through every root; it does not invent a way to set a different per-chat working folder.
If a future story adds independent chat working folders, extend this criterion's scenario through that UI.
File links outside the chat folder and workspace folders are out of scope for opening, even when they exist.
The AC3 fixture explicitly guards that boundary.
Diff display is out of scope.

## Zed investigation

Inspected the supplied read-only Zed 1.23.2 source before writing the contract: crates/agent_ui/src/agent_ui.rs, open_abs_path_at_point, opens an editor and changes its selection when a point is supplied; crates/workspace/src/path_link.rs defines exact cwd-relative and worktree-root-relative path matching.
The acceptance assertions come directly from #34, rather than importing Zed's path heuristics or its allowance for existing outside-worktree files.
No new upstream keymap, settings or theme behavior is copied; existing startup keys come from the #29 handoff.
The issue specifies no look check, and stock Zed was not launched in the sandbox.

## Validation and pending red baseline

npm run typecheck passed.
Playwright --list collected exactly five tests, one per criterion, with no Electron launch.
The generated scenario passed a standalone smoke check through the unchanged fake CLI runner: 11 wire events, all four tool calls, one reply, successful result and exit code 0.
New-file whitespace and restricted-character checks passed.
No tests were skipped or marked as expected failures with test.fail().
No Electron or browser test was run, so no measured PASS or FAIL and no failure-message excerpt can yet be reported.
The current src/renderer/chat.ts renders tool targets as spans and reply text as plain paragraphs, and project:open-file has no line/column arguments.
The intended first failures are:

| AC | Intended assertion message |
| --- | --- |
| AC1 | Story #34 Read file_path must be a clickable link in the tool row |
| AC2 | Story #34 src/a.ts must link in both plain text and inline code |
| AC3 | Story #34 existing-file control must be linked before testing non-links |
| AC4 | Story #34 file links must exist before exercising keyboard navigation |
| AC5 | Story #34 src/shared.ts:3:2 must resolve against the chat and workspace folders |

Launch, fixture, startup and transcript prerequisite failures are test/setup problems, not an accepted red baseline.
Return the measured output to QA to confirm that all five tests fail for missing file links before implementation starts.

Run from this worktree root outside the sandbox on macOS:

```sh
mkdir -p /tmp/cod-art/34
npm run build
caffeinate -dimsu npx playwright test tests/e2e/a1-c1-open-files-from-chat.spec.ts --reporter=list > /tmp/cod-art/34/run.txt 2>&1
```

On Linux with Electron system dependencies installed, use xvfb-run -a in place of caffeinate -dimsu.
No files were staged or committed and no PR was created, as requested.
