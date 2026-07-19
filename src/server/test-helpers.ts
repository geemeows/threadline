// Scripted in-memory AgentAdapter for registry/ws tests: events are pushed by
// the test and flow through the same AsyncIterable seam a real adapter uses.

import type {
  AgentAdapter,
  AgentEvent,
  AgentSession,
  Capabilities,
  PermissionDecision,
  PermissionMode,
  StartOptions,
  UserMessage,
} from '../adapters/index.js'

export class FakeSession implements AgentSession {
  sent: UserMessage[] = []
  permissions: Array<{ id: string; decision: PermissionDecision }> = []
  permissionModes: PermissionMode[] = []
  interrupted = false
  killed = false
  resumeToken: Promise<string>

  private queue: AgentEvent[] = []
  private waiters: Array<() => void> = []
  private done = false
  private resolveToken!: (token: string) => void

  constructor(public opts: StartOptions) {
    this.resumeToken = new Promise((resolve) => {
      this.resolveToken = resolve
    })
  }

  emit(event: AgentEvent): void {
    if (event.type === 'session_started') this.resolveToken(event.resumeToken)
    if (event.type === 'session_ended') this.done = true
    this.queue.push(event)
    for (const wake of this.waiters.splice(0)) wake()
  }

  events: AsyncIterable<AgentEvent> = {
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<AgentEvent>> => {
        while (this.queue.length === 0) {
          if (this.done) return { done: true, value: undefined }
          await new Promise<void>((resolve) => this.waiters.push(resolve))
        }
        return { done: false, value: this.queue.shift()! }
      },
    }),
  }

  send(msg: UserMessage): void {
    this.sent.push(msg)
  }
  respondPermission(id: string, decision: PermissionDecision): void {
    this.permissions.push({ id, decision })
  }
  setPermissionMode(mode: PermissionMode): void {
    this.permissionModes.push(mode)
  }
  interrupt(): void {
    this.interrupted = true
  }
  kill(): void {
    this.killed = true
    this.emit({ type: 'session_ended', outcome: 'killed', resumable: false })
  }
}

export class FakeAdapter implements AgentAdapter {
  readonly name = 'fake'
  readonly capabilities: Capabilities = {
    liveInput: true,
    livePermissions: true,
    livePermissionMode: true,
    streamingText: true,
    reportsTokens: true,
    reportsCost: true,
    resume: true,
  }
  sessions: FakeSession[] = []
  resumed: Array<{ token: string; opts: StartOptions }> = []

  start(opts: StartOptions): AgentSession {
    const session = new FakeSession(opts)
    this.sessions.push(session)
    return session
  }

  resume(resumeToken: string, opts: StartOptions): AgentSession {
    this.resumed.push({ token: resumeToken, opts })
    return this.start(opts)
  }
}

/** Poll until `check` stops throwing — event pumps are async. */
export async function eventually(
  check: () => void | Promise<void>,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      return await check()
    } catch (err) {
      if (Date.now() > deadline) throw err
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
}
