// Agent adapter seam, locked in issue #5 (grilling: agent adapter interface).
// The orchestrator codes against this interface only; CLI-specific degradation
// (one-shot send, static permissions) lives inside adapters and never leaks up.

export interface AgentAdapter {
  readonly name: string
  readonly capabilities: Capabilities
  start(opts: StartOptions): AgentSession
  resume(resumeToken: string, opts: StartOptions): AgentSession
}

export interface AgentSession {
  events: AsyncIterable<AgentEvent>
  send(msg: UserMessage): void
  respondPermission(id: string, decision: PermissionDecision): void
  /**
   * Change the permission mode of a running session. A no-op on adapters
   * without `livePermissionMode` — callers gate on the capability and fall back
   * to applying the mode on the next resume.
   */
  setPermissionMode(mode: PermissionMode): void
  interrupt(): void
  kill(): void
  /** Adapter-minted opaque token; resolves once the session is identifiable. */
  resumeToken: Promise<string>
}

export interface StartOptions {
  /** Repo or worktree the session runs in. */
  cwd: string
  /** Orchestrator-composed prompt — slash-skill syntax already embedded. */
  prompt: string
  permissionPolicy: PermissionPolicy
  mcpConfig?: McpConfig
  /** Appended to the CLI's system prompt (`--append-system-prompt`). */
  appendSystemPrompt?: string
  model?: string
  env?: Record<string, string>
}

/** The static/interactive gating stance a session runs under. */
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

export interface PermissionPolicy {
  mode: PermissionMode
  allowedTools?: string[]
  disallowedTools?: string[]
  /**
   * When true (and the adapter has livePermissions), unresolved permission
   * checks surface as permission_request events answered via
   * respondPermission(). When false, the CLI's static mode alone decides.
   */
  intercept: boolean
}

export interface McpConfig {
  /** Server definitions in the CLI's native shape, keyed by server name. */
  servers: Record<string, unknown>
  /** Ignore user/project MCP config outside this set. */
  strict?: boolean
}

export type UserMessage = { text: string } | { content: unknown[] }

export type PermissionDecision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message?: string }

export interface Capabilities {
  /** send() is real-time (vs faked via end-turn-then-resume). */
  liveInput: boolean
  /** Mid-run permission_request events (vs static policy only). */
  livePermissions: boolean
  /** --permission-mode can be changed mid-run (vs only at start/resume). */
  livePermissionMode: boolean
  /** assistant_delta events. */
  streamingText: boolean
  reportsTokens: boolean
  /** Native dollar figures — no pricing tables anywhere in MVP. */
  reportsCost: boolean
  resume: boolean
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  costUsd?: number
}

export type SessionOutcome =
  | 'completed'
  | 'max_turns'
  | 'error'
  | 'interrupted'
  | 'killed'
  | 'crashed'

// Normalized event union. Every event carries the original CLI JSON in `raw`
// (absent only on synthesized events) for full-fidelity transcripts.
export type AgentEvent =
  | { type: 'session_started'; resumeToken: string; model: string; raw: unknown }
  | { type: 'assistant_delta'; text: string; raw: unknown }
  | { type: 'assistant_message'; content: unknown[]; raw: unknown }
  | { type: 'tool_call'; name: string; input: unknown; callId: string; raw: unknown }
  | { type: 'tool_result'; callId: string; output: unknown; isError: boolean; raw: unknown }
  | { type: 'permission_request'; id: string; tool: string; input: unknown; raw: unknown }
  | { type: 'usage_update'; usage: Usage; raw: unknown }
  | { type: 'session_ended'; outcome: SessionOutcome; usage?: Usage; resumable: boolean; raw?: unknown }
