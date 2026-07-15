# Research: headless streaming interfaces of agent CLIs

Resolves [#2](https://github.com/geemeows/threadline/issues/2) (part of #1).
Researched 2026-07-15 against primary sources (official docs); each claim cites its source.
Fidelity: Claude Code deep, Codex/Cursor low (enough to shape the adapter seam).

## Question

What exactly can `claude -p --input-format stream-json --output-format stream-json` do
today, and what shape must our adapter interface take so Codex/Cursor CLIs can slot in
later?

---

## 1. Claude Code headless mode (deep dive)

### 1.1 Print mode flags

- `-p` / `--print` — non-interactive mode.
- `--output-format text | json | stream-json` (print mode only).
- `--input-format text | stream-json`.
- `--include-partial-messages` — adds token-delta `stream_event` lines to stream-json output.
- `--verbose` — required for stream-json to emit full turn-by-turn events.
- `--bare` — skip auto-discovery of hooks, skills, plugins, MCP servers, CLAUDE.md.

Sources: [headless docs](https://code.claude.com/docs/en/headless.md),
[CLI reference](https://code.claude.com/docs/en/cli-reference.md).

### 1.2 stream-json output events

NDJSON, one JSON object per line:

| `type` | `subtype` | Key fields |
|---|---|---|
| `system` | `init` | `model`, `tools`, `mcp_servers`, `plugins`, `capabilities` — first event |
| `system` | `api_retry` | `attempt`, `max_retries`, `retry_delay_ms`, `error_status` |
| `stream_event` | — | Anthropic API delta events (`text_delta` etc.); only with `--include-partial-messages` |
| `assistant` | — | complete assistant `message` with content blocks (text, tool_use) |
| `user` | — | user/tool-result `message` |
| `result` | `success` \| `error_max_turns` \| `error_*` | `result` text, `session_id`, `usage` (token counts), `total_cost_usd`, `duration_ms`, `num_turns`, `is_error` |

The terminal `result` event carries **usage and dollar cost** (`usage`, `total_cost_usd`)
plus `session_id` — this is where an adapter reads cost and captures the session id for
resume. Source: [headless docs](https://code.claude.com/docs/en/headless.md).

### 1.3 stream-json input — bidirectional chat

With `--input-format stream-json`, user messages are written to stdin as NDJSON:

```json
{"type":"user","message":{"role":"user","content":"follow-up text"}}
```

Streaming input mode over one long-lived process supports: multiple turns, message
queueing, interruption/cancellation, and image attachments — none of which
single-message mode supports. This is the mechanism for **answering an in-flight
question from the browser**: keep the process alive, write the next user message to
stdin. Source:
[streaming vs single mode](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode.md).

### 1.4 Control protocol (permission prompt interception)

- Bidirectional control messages ride the same stdio stream:
  - `control_request` (CLI → wrapper): `{type:"control_request", request_id, request:{subtype:"can_use_tool", tool_name, input, ...}}`
  - `control_response` (wrapper → CLI): `{type:"control_response", response:{request_id, behavior:"allow"|"deny", updatedInput?}}`
- This is how a wrapper answers an in-flight **tool-permission prompt** (the SDK's
  `canUseTool` callback is implemented over this).
- Caveat: the wire protocol is exercised by the official Agent SDKs but is **not fully
  specified in the official CLI docs**; the stdio `--permission-prompt-tool` behavior is
  documented mainly via SDK sources and community protocol write-ups
  ([example](https://github.com/Roasbeef/claude-agent-sdk-go/blob/main/docs/cli-protocol.md), non-official).
  Treat the raw protocol as semi-stable; prefer the Agent SDK if we can take the dependency.
- Static alternatives (documented): `--permission-mode` (`default`, `acceptEdits`,
  `plan`, `dontAsk`, `bypassPermissions`), `--dangerously-skip-permissions`,
  `--allowedTools` / `--disallowedTools` (patterns like `"Bash(git *)"`),
  `--permission-prompt-tool <mcp_tool>` to delegate prompts to an MCP tool.
  Sources: [permissions](https://code.claude.com/docs/en/permissions.md),
  [permission modes](https://code.claude.com/docs/en/permission-modes.md).

### 1.5 Session resume

- `--resume <session-id|name>` — resume a specific session; works in print mode:
  `claude -p --resume <id> "follow-up"`.
- `--continue` — most recent session in the working directory.
- `--fork-session` — branch a session, leaving the original intact.
- `session_id` is emitted in the `init` and `result` events; session lookup is scoped to
  the project directory + git worktrees. `--no-session-persistence` disables saving.
- The docs expose no separate `--session-id <uuid>` pre-assignment flag; adapters should
  capture the id from output rather than assign one.

Source: [sessions](https://code.claude.com/docs/en/sessions.md),
[headless](https://code.claude.com/docs/en/headless.md).

### 1.6 MCP config injection

- `--mcp-config <file-or-inline-JSON>` — inject MCP servers per invocation.
- `--strict-mcp-config` — use only the injected config, ignore user/project config.
- MCP tools are named `mcp__<server>__<tool>` in permission rules.

Source: [MCP docs](https://code.claude.com/docs/en/mcp.md),
[CLI reference](https://code.claude.com/docs/en/cli-reference.md).

### 1.7 Skills / slash commands from `-p`

- Skills and slash commands can be invoked by name inside the prompt string:
  `claude -p "/my-skill args"`.
- Several built-ins accept args in print mode (`/model`, `/effort`, `/config key=value`, …);
  interactive-only commands (`/login`, `/help`) are unavailable.

Source: [headless](https://code.claude.com/docs/en/headless.md),
[skills](https://code.claude.com/docs/en/skills.md).

### 1.8 Exit / error semantics

- Errors surface primarily **in-band**: the `result` event's `is_error` and `subtype`
  (`success`, `error_max_turns`, `error_*`).
- Documented process-level behavior: >10MB piped stdin exits non-zero with an error;
  transient API errors retry up to 10 times (`CLAUDE_CODE_MAX_RETRIES`); background Bash
  tasks are killed ~5s after the final result.
- **No official exit-code table exists.** Adapters must treat the `result` event, not
  the exit code, as the source of truth for outcome, and any nonzero exit / missing
  `result` line as an infrastructure failure.

Source: [headless](https://code.claude.com/docs/en/headless.md),
[errors](https://code.claude.com/docs/en/errors.md).

---

## 2. Codex CLI (`codex exec`) — low fidelity

Source: [Codex non-interactive docs](https://developers.openai.com/codex/noninteractive)
(canonical; `docs/exec.md` in [openai/codex](https://github.com/openai/codex) redirects there).

- `codex exec --json` emits JSONL: `thread.started`, `turn.started`, `turn.completed`,
  `turn.failed`, `item.started`/`item.completed` (agent messages, reasoning, command
  executions, file changes, MCP tool calls, web searches, plan updates).
- Usage: `turn.completed.usage` = `input_tokens`, `cached_input_tokens`,
  `output_tokens`, `reasoning_output_tokens`. **Tokens only — no dollar cost.**
- Input: one-shot. Prompt as arg; piped stdin is treated as *additional context*, not a
  message channel. **No bidirectional stdin-JSON mode.**
- Resume: `codex exec resume <SESSION_ID>` or `resume --last`; `--ephemeral` disables persistence.
- Permissions: preset policy only (`--sandbox read-only|workspace-write|danger-full-access`);
  **no interactive approval callback** in exec mode.
- Extras with no Claude equivalent: `--output-schema <path>` (JSON-Schema-constrained
  final answer), `--output-last-message <path>`.
- MCP: configured via `config.toml` / `codex mcp`; MCP calls appear as `item.*` events.

## 3. Cursor CLI (`cursor-agent`) — low fidelity

Sources: [headless docs](https://cursor.com/docs/cli/headless),
[parameter reference](https://cursor.com/docs/cli/reference/parameters).

- `cursor-agent -p --output-format text|json|stream-json`; `--stream-partial-output`
  for deltas.
- stream-json events: `system` (subtype `init`), `assistant`, `tool_call`
  (`started`/`completed`), `result` — the `result` documents **duration only, no
  token/cost usage**.
- Resume: `--resume [chatId]`, `--continue`; `cursor-agent ls` lists sessions.
- Permissions: `--force` / `--yolo` (allow unless explicitly denied); **no interactive
  permission-prompt protocol** in print mode.
- MCP: `cursor-agent mcp` subcommands (login/list/enable/disable).
- Unconfirmed: stdin-as-prompt; undocumented usage fields in `result`.

---

## 4. Implications for the adapter interface

The seam must not be Claude-shaped. Common denominator vs. Claude-only capabilities:

| Capability | Claude Code | Codex exec | Cursor agent | Adapter stance |
|---|---|---|---|---|
| Streamed JSONL output | yes | yes | yes | **core**: normalize to a common event stream |
| Terminal result event | yes (`result`) | yes (`turn.completed`/`failed`) | yes (`result`) | **core** |
| Session resume by id | yes | yes | yes | **core**: `resume(sessionId, prompt)` |
| Bidirectional stdin (in-flight replies) | yes (stream-json input) | no | no | **optional capability flag**; fallback = resume-per-turn |
| Permission prompt interception | yes (control protocol / canUseTool) | no (preset sandbox) | no (`--force`/denylist) | **optional capability flag**; fallback = static policy config |
| Usage tokens in result | yes | yes | not documented | optional field |
| Dollar cost in result | yes (`total_cost_usd`) | no | no | optional; compute from tokens where absent |
| MCP config injection per run | yes (`--mcp-config`) | config file only | subcommand-managed | adapter takes declarative MCP config; each impl maps or rejects |
| Skill/slash invocation in prompt | yes | no | no | Claude-specific; express as prompt-preprocessing, not interface method |
| Exit codes | not specified | n/a (in-band) | n/a (in-band) | never rely on exit codes; parse terminal event |

Concrete shape: a `CliAgentAdapter` with `start(prompt, opts) -> EventStream`,
`resume(sessionId, prompt, opts) -> EventStream`, and a `capabilities` descriptor
(`bidirectionalInput`, `permissionCallback`, `usage`, `cost`, `mcpInjection`). The
browser-facing "answer an in-flight question" feature works natively only on Claude;
for Codex/Cursor it degrades to end-turn-then-resume. Permission UX must be designed
around a capability check, with static policy as the universal fallback.

## Open questions / unconfirmed

- Claude: official spec for the raw stdio control protocol and exit codes (SDK-mediated
  today; community docs only for the wire format).
- Claude: interrupt semantics over raw stream-json (documented for SDK, not raw CLI).
- Cursor: stdin piping as prompt input; any usage fields in `result`.
- Codex: MCP config mechanics beyond items appearing in the stream.
