# Story #8 scripted Claude CLI

`claude` is an executable Node script, launched as a child process through the same interface as the installed Claude CLI. It does not contact a service, execute tools, use credentials or load a real Claude profile. All prompts, tool inputs and outputs are invented.

## Source contracts

Based on the official [headless docs](https://code.claude.com/docs/en/headless) and [CLI reference](https://code.claude.com/docs/en/cli-reference), saved for offline QA as `artifacts/8/claude-headless.md` and `artifacts/8/claude-cli-reference.md`.

The saved headless docs explicitly specify newline-delimited stream-json output, `--verbose`, `--include-partial-messages`, `stream_event.event.delta.type = text_delta`, `delta.text`, a final `result` with session metadata, `session_id` for continuation, and main-conversation `parent_tool_use_id = null`. The CLI reference specifies `-p`, `--input-format stream-json`, `--output-format stream-json`, `--resume <id>` and `--session-id <uuid>`. The headless docs specify SIGTERM exits 143 and SIGINT ends a turn. Missing authentication is a result on stdout. Bare mode does not use subscription login, so Cod must never pass `--bare`.

The supplied pages are not complete protocol schemas. The following fields and structures are inferred, not captured from a real CLI: `system.subtype = init`, its `cwd`, `tools`, `model`, `permissionMode`, `apiKeySource` and `uuid`; the stream-json stdin `type = user`, `message.role = user` and `message.content` string or text-block array; `message_start`, `content_block_start`, `content_block_stop`, `message_delta`, `message_stop`, their `index`, message ID, role, content, model, stop fields and usage; `assistant.message.content` with `tool_use` ID/name/input; `user.message.content` with `tool_result`, `tool_use_id`, content and `is_error`; envelope UUIDs; result `subtype`, `is_error`, `errors`, duration, turn count, cost and usage fields. In particular, the authentication error's exact subtype and message are inferred. The text-delta container's session/UUID/index fields are inferred, while its `type`, `event.delta.type` and `event.delta.text` path are documented.

These inferred shapes need confirmation against a permitted live CLI check by the developer on master or by hand. A fake run proves the host contract, not compatibility with every real CLI version, token-file access, or terminal rendering. The separate-process AC6 check uses the fake in headless mode with `--resume`, not an interactive terminal.

## Hooks

| Variable | Meaning |
| --- | --- |
| COD_CLAUDE_BIN | Cod's executable override; spawn this path directly without modifying the file. Production defaults to installed `claude` on PATH. |
| COD_FAKE_CLAUDE_LOG | Fake-only JSONL log and session state file prefix, unique per test. Required. |
| COD_FAKE_CLAUDE_SCENARIO | Fake-only scenario basename. Defaults to `reply`. |
| COD_FAKE_CLAUDE_GATES | Fake-only directory containing test-controlled release files. |

The fake requires print mode (`-p` or `--print`), both format flags set to `stream-json`, `--verbose` and `--include-partial-messages`. It accepts `--resume <id>` and `--session-id <uuid>`. It logs other flags so the acceptance tests can reject forbidden ones. It reads one JSON user message per stdin line, supports multiple turns in a process, and waits for EOF before exiting after a normal completed turn. It can also handle one process per turn using `--resume`. Session IDs supplied by Cod are used verbatim; otherwise the fixed UUID ends in `0008`.

Session state is saved next to the log as `<log>.<session-id>.session.json`, including prompt history and turn index. Resume of an unknown ID fails. A resumed process reads the prior history and uses the next scripted turn. This is fake-only state, not a copy of Claude's real session storage.

Each JSON scenario contains `turns`, each a list of `event`, `gate` or `hold` steps. `$SESSION`, `$CWD` and `$UUID` values are filled by the executable. Envelope UUIDs are synthetic. No output timing depends on a wall clock. `gate` watches its directory for a named release file. `hold` keeps the process alive until SIGINT, SIGTERM or forced termination; it cannot finish successfully on its own.

| Scenario | Flow |
| --- | --- |
| reply | First greeting, then a continuation referencing the first message |
| stream | First text fragment, wait for `finish` gate, then final delta and result |
| tools | Read notes.txt tool_use, tool_result with invented contents, final reply |
| interrupt | Incomplete reply held open; next turn in the persisted session continues |
| not-logged-in | Error result on stdout with `claude auth login`, exit 1 |
| missing | Harness-only case: COD_CLAUDE_BIN names a nonexistent file, exercising a real spawn failure |

`start` log records contain argv, cwd and selected environment variable names only, never environment values. The selection covers `ANTHROPIC_*`, `CLAUDE_*`, `COD_*` and `HOME`. `stdin` records contain raw JSON from the invented test messages. Other records track emitted event types, turn history, gates and termination signals. SIGINT exits 130 and SIGTERM exits 143 without a success result. Tests do not require a particular interrupt signal, but require the process to stop.

Logs and state are temporary and removed after each test. Do not point this fake at real messages: its stdin/history log is intentionally readable for QA. AC5 removes shell credential variables before launching Electron and inserts two invented sentinels. Cod must strip those credential variables before spawning the fake. The log checks names, never values. Source review or a separate access audit is still required to prove that Cod never reads or stores login credentials.
