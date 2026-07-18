// In-process session spawn registry — the one place live AgentSessions exist
// (tech-stack decision #9). It pumps each session's event stream exactly once,
// fanning out to (a) the transcript store and (b) any number of attached
// subscribers, with an in-memory replay buffer so a browser can re-open a chat
// mid-run. Everything else addresses sessions by id through this registry.

import { randomUUID } from 'node:crypto'
import type {
  AgentAdapter,
  AgentEvent,
  PermissionDecision,
  StartOptions,
  UserMessage,
} from '../adapters/index.js'
import {
  type QuestionAnswers,
  QUESTION_MCP_KEY,
  QUESTION_TOOL_FULLNAME,
} from './question-mcp.js'
import type { SessionMeta, TranscriptEvent } from './transcripts.js'
import { TranscriptStore } from './transcripts.js'

export interface StartSessionOptions extends StartOptions {
  /** Adapter name; defaults to the registry's only adapter when unambiguous. */
  adapter?: string
  /** Effort ref id (`owner/repo#n`); absent on setup sessions. */
  effort?: string
  stage?: string
}

export type SessionListener = (event: TranscriptEvent) => void

interface LiveSession {
  meta: SessionMeta
  buffer: TranscriptEvent[]
  listeners: Set<SessionListener>
  send: (msg: UserMessage) => void
  respondPermission: (id: string, decision: PermissionDecision) => void
  interrupt: () => void
  kill: () => void
}

export class SessionRegistry {
  private live = new Map<string, LiveSession>()
  // Sessions blocked inside the ask_user_questions MCP tool, awaiting a UI
  // answer. One per session — the agent can't call a second before the first
  // returns. Rejected on session end so the tool degrades instead of hanging.
  private pendingQuestions = new Map<
    string,
    { resolve: (a: QuestionAnswers) => void; reject: (e: Error) => void }
  >()

  constructor(
    private adapters: Record<string, AgentAdapter>,
    private store = new TranscriptStore(),
    private now: () => string = () => new Date().toISOString(),
    /** Base URL of threadmap's own HTTP server, e.g. `http://127.0.0.1:4664`.
     *  When set, planning sessions get the question MCP tool wired in. */
    private questionMcpBaseUrl?: string,
  ) {}

  start(opts: StartSessionOptions): SessionMeta {
    const adapter = this.pickAdapter(opts.adapter)
    return this.track(adapter.name, opts, (o) => adapter.start(o))
  }

  /** Re-open an ended session with the resume token its adapter minted. */
  async resume(sessionId: string, prompt: string): Promise<SessionMeta> {
    const prior = this.live.get(sessionId)?.meta ?? (await this.store.readMeta(sessionId))
    if (!prior) throw new RegistryError(`unknown session: ${sessionId}`)
    if (prior.status === 'running') throw new RegistryError(`session still running: ${sessionId}`)
    if (!prior.resumeToken) throw new RegistryError(`session not resumable: ${sessionId}`)
    const adapter = this.pickAdapter(prior.adapter)
    const opts: StartSessionOptions = {
      cwd: prior.cwd,
      prompt,
      permissionPolicy: { mode: 'default', intercept: true },
      effort: prior.effort,
      stage: prior.stage,
    }
    return this.track(adapter.name, opts, (o) => adapter.resume(prior.resumeToken!, o))
  }

  get(sessionId: string): SessionMeta | undefined {
    return this.live.get(sessionId)?.meta
  }

  /** Live sessions plus ended ones persisted by the transcript store. */
  async list(): Promise<SessionMeta[]> {
    const persisted = await this.store.list()
    const liveIds = new Set(this.live.keys())
    return [
      ...[...this.live.values()].map((s) => s.meta),
      ...persisted.filter((m) => !liveIds.has(m.id)),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /**
   * Attach a listener: replays buffered events synchronously, then streams
   * live ones. Returns a detach function.
   */
  subscribe(sessionId: string, listener: SessionListener): () => void {
    const session = this.require(sessionId)
    for (const event of session.buffer) listener(event)
    session.listeners.add(listener)
    return () => session.listeners.delete(listener)
  }

  send(sessionId: string, msg: UserMessage): void {
    const session = this.require(sessionId)
    session.send(msg)
    // The adapter stream never echoes user input — record the human's half
    // here so re-opened transcripts hold the whole conversation.
    if ('text' in msg) this.record(session, { type: 'user_message', text: msg.text })
  }

  respondPermission(sessionId: string, permissionId: string, decision: PermissionDecision): void {
    const session = this.require(sessionId)
    session.respondPermission(permissionId, decision)
    this.record(session, { type: 'permission_response', id: permissionId, decision })
  }

  /**
   * Answer the session's pending ask_user_questions call — resolves the promise
   * the MCP tool handler is blocked on, which returns the answer to the CLI. The
   * CLI then emits its own tool_result into the stream, so we don't record one.
   */
  answerQuestion(
    sessionId: string,
    _callId: string,
    _questions: unknown[],
    answers: QuestionAnswers,
  ): void {
    const pending = this.pendingQuestions.get(sessionId)
    if (!pending) return
    this.pendingQuestions.delete(sessionId)
    pending.resolve(answers)
  }

  /* ---- QuestionBridge: the question MCP server's in-process back-channel ---- */

  /** Block until the session's question is answered in the UI (or it dies). */
  awaitAnswer(sessionId: string): Promise<QuestionAnswers> {
    this.pendingQuestions.get(sessionId)?.reject(new Error('superseded by a newer question'))
    return new Promise<QuestionAnswers>((resolve, reject) => {
      this.pendingQuestions.set(sessionId, { resolve, reject })
    })
  }

  isLive(sessionId: string): boolean {
    return this.live.has(sessionId)
  }

  private failPendingQuestion(sessionId: string, reason: string): void {
    const pending = this.pendingQuestions.get(sessionId)
    if (!pending) return
    this.pendingQuestions.delete(sessionId)
    pending.reject(new Error(reason))
  }

  interrupt(sessionId: string): void {
    this.require(sessionId).interrupt()
  }

  kill(sessionId: string): void {
    this.require(sessionId).kill()
  }

  /** Kill every live session — server shutdown. */
  killAll(): void {
    for (const s of this.live.values()) s.kill()
  }

  private track(
    adapterName: string,
    opts: StartSessionOptions,
    spawn: (o: StartOptions) => ReturnType<AgentAdapter['start']>,
  ): SessionMeta {
    // The MCP URL is per-session, so mint the id first and hand the adapter the
    // options already carrying the question tool (planning sessions only).
    const id = randomUUID()
    const session = spawn(this.withQuestionTool(id, opts))
    const meta: SessionMeta = {
      id,
      adapter: adapterName,
      cwd: opts.cwd,
      prompt: opts.prompt,
      effort: opts.effort,
      stage: opts.stage,
      createdAt: this.now(),
      status: 'running',
    }
    const entry: LiveSession = {
      meta,
      buffer: [],
      listeners: new Set(),
      send: (m) => session.send(m),
      respondPermission: (id, d) => session.respondPermission(id, d),
      interrupt: () => session.interrupt(),
      kill: () => session.kill(),
    }
    this.live.set(meta.id, entry)
    void this.store.writeMeta(meta).catch(() => {})
    void this.pump(entry, session.events)
    return meta
  }

  /** Wire the ask_user_questions MCP tool into planning sessions (no-op
   *  otherwise): register the per-session HTTP MCP server and pre-approve the
   *  tool so calling it never triggers a permission prompt. */
  private withQuestionTool(id: string, opts: StartSessionOptions): StartSessionOptions {
    if (!this.questionMcpBaseUrl || opts.stage !== 'planning') return opts
    const servers = {
      ...(opts.mcpConfig?.servers ?? {}),
      [QUESTION_MCP_KEY]: { type: 'http', url: `${this.questionMcpBaseUrl}/mcp/${id}` },
    }
    const nudge =
      `When a decision during planning is genuinely the user's to make, ask via the ` +
      `${QUESTION_TOOL_FULLNAME} tool (multiple-choice, blocks for their answer) instead of asking in prose. ` +
      `The built-in AskUserQuestion tool is unavailable here; this is its replacement.`
    return {
      ...opts,
      mcpConfig: { servers, ...(opts.mcpConfig?.strict ? { strict: true } : {}) },
      appendSystemPrompt: opts.appendSystemPrompt ? `${opts.appendSystemPrompt}\n\n${nudge}` : nudge,
      permissionPolicy: {
        ...opts.permissionPolicy,
        allowedTools: [...(opts.permissionPolicy.allowedTools ?? []), QUESTION_TOOL_FULLNAME],
      },
    }
  }

  private async pump(entry: LiveSession, events: AsyncIterable<AgentEvent>): Promise<void> {
    const { meta } = entry
    try {
      for await (const event of events) {
        entry.buffer.push(event)
        await this.store.append(meta.id, event).catch(() => {})
        if (event.type === 'session_started') {
          meta.resumeToken = event.resumeToken
          void this.store.writeMeta(meta).catch(() => {})
        } else if (event.type === 'usage_update') {
          meta.usage = event.usage
        } else if (event.type === 'session_ended') {
          meta.status = 'ended'
          meta.outcome = event.outcome
          if (event.usage) meta.usage = event.usage
          if (!event.resumable) meta.resumeToken = undefined
        }
        for (const listener of entry.listeners) listener(event)
      }
    } finally {
      // The seam guarantees exactly-one session_ended (synthesized on crash),
      // but a broken iterator must not leave a zombie 'running' meta behind.
      if (meta.status !== 'ended') {
        meta.status = 'ended'
        meta.outcome = 'crashed'
      }
      await this.store.writeMeta(meta).catch(() => {})
      this.live.delete(meta.id)
      // Anything still blocked in the question tool must unblock, or the CLI
      // process (already gone) would leave the promise dangling forever.
      this.failPendingQuestion(meta.id, 'session ended before the question was answered')
    }
  }

  private record(session: LiveSession, event: TranscriptEvent): void {
    session.buffer.push(event)
    void this.store.append(session.meta.id, event).catch(() => {})
    for (const listener of session.listeners) listener(event)
  }

  private pickAdapter(name?: string): AgentAdapter {
    if (name) {
      const adapter = this.adapters[name]
      if (!adapter) throw new RegistryError(`unknown adapter: ${name}`)
      return adapter
    }
    const all = Object.values(this.adapters)
    if (all.length !== 1 || !all[0]) throw new RegistryError('adapter name required')
    return all[0]
  }

  private require(sessionId: string): LiveSession {
    const session = this.live.get(sessionId)
    if (!session) throw new RegistryError(`no live session: ${sessionId}`)
    return session
  }
}

export class RegistryError extends Error {}
