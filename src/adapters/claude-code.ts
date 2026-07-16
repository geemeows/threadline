import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type {
  AgentAdapter,
  AgentEvent,
  AgentSession,
  Capabilities,
  PermissionDecision,
  SessionOutcome,
  StartOptions,
  Usage,
  UserMessage,
} from './types.js'

// Wire protocol facts verified empirically against claude 2.1.211 (issue #12):
// - `--permission-prompt-tool stdio` makes the CLI emit
//   {type:"control_request",request_id,request:{subtype:"can_use_tool",tool_name,input,tool_use_id,...}}
//   on stdout and accept {type:"control_response",response:{subtype:"success",request_id,
//   response:{behavior:"allow"|"deny",updatedInput?,message?}}} on stdin. Without that flag
//   permission checks auto-deny (itemized in result.permission_denials) — no event is emitted.
// - The terminal event is {type:"result",subtype:"success"|"error_max_turns"|"error_*",...}
//   carrying usage, total_cost_usd and session_id; outcome never lives in the exit code.

export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildProcess

export interface ClaudeCodeAdapterOptions {
  /** Executable to spawn; defaults to `claude` on PATH. */
  claudePath?: string
  /** Injection point for tests. */
  spawnFn?: SpawnFn
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = 'claude-code'
  readonly capabilities: Capabilities = {
    liveInput: true,
    livePermissions: true,
    streamingText: true,
    reportsTokens: true,
    reportsCost: true,
    resume: true,
  }

  private readonly claudePath: string
  private readonly spawnFn: SpawnFn

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    this.claudePath = options.claudePath ?? 'claude'
    this.spawnFn = options.spawnFn ?? (spawn as unknown as SpawnFn)
  }

  start(opts: StartOptions): AgentSession {
    return this.launch(opts, undefined)
  }

  resume(resumeToken: string, opts: StartOptions): AgentSession {
    return this.launch(opts, resumeToken)
  }

  private launch(opts: StartOptions, resumeToken: string | undefined): AgentSession {
    const args = buildArgs(opts, resumeToken)
    const child = this.spawnFn(this.claudePath, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return new ClaudeCodeSession(child, opts.prompt)
  }
}

export function buildArgs(opts: StartOptions, resumeToken?: string): string[] {
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode', opts.permissionPolicy.mode,
  ]
  const policy = opts.permissionPolicy
  if (policy.allowedTools?.length) args.push('--allowedTools', policy.allowedTools.join(','))
  if (policy.disallowedTools?.length) args.push('--disallowedTools', policy.disallowedTools.join(','))
  if (policy.intercept && policy.mode !== 'bypassPermissions') {
    args.push('--permission-prompt-tool', 'stdio')
  }
  if (opts.mcpConfig) {
    args.push('--mcp-config', JSON.stringify({ mcpServers: opts.mcpConfig.servers }))
    if (opts.mcpConfig.strict) args.push('--strict-mcp-config')
  }
  if (opts.model) args.push('--model', opts.model)
  if (resumeToken) args.push('--resume', resumeToken)
  return args
}

class ClaudeCodeSession implements AgentSession {
  readonly events: AsyncIterable<AgentEvent>
  readonly resumeToken: Promise<string>

  private readonly child: ChildProcess
  private readonly queue = new AsyncEventQueue<AgentEvent>()
  private resolveToken!: (token: string) => void
  private rejectToken!: (err: Error) => void
  private tokenSettled = false
  private resultSeen = false
  private killedByUs = false
  private interruptedByUs = false
  private stdoutBuffer = ''

  constructor(child: ChildProcess, prompt: string) {
    this.child = child
    this.events = this.queue
    this.resumeToken = new Promise<string>((resolve, reject) => {
      this.resolveToken = resolve
      this.rejectToken = reject
    })
    // Consumers may never read the token; don't let that surface as an unhandled rejection.
    this.resumeToken.catch(() => {})

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.onStdout(chunk))
    child.on('error', () => this.finish('crashed'))
    // 'close' (not 'exit') so buffered stdout — possibly holding the result
    // event — is fully drained before we decide whether to synthesize.
    child.on('close', () => this.finish(this.exitOutcome()))

    this.writeLine({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: prompt }] },
    })
  }

  send(msg: UserMessage): void {
    const content = 'text' in msg ? [{ type: 'text', text: msg.text }] : msg.content
    this.writeLine({ type: 'user', message: { role: 'user', content } })
  }

  respondPermission(id: string, decision: PermissionDecision): void {
    const response =
      decision.behavior === 'allow'
        ? { behavior: 'allow', updatedInput: decision.updatedInput }
        : { behavior: 'deny', message: decision.message ?? 'Denied by user' }
    this.writeLine({
      type: 'control_response',
      response: { subtype: 'success', request_id: id, response },
    })
  }

  interrupt(): void {
    this.interruptedByUs = true
    this.writeLine({
      type: 'control_request',
      request_id: `interrupt-${Math.random().toString(36).slice(2)}`,
      request: { subtype: 'interrupt' },
    })
  }

  kill(): void {
    this.killedByUs = true
    this.child.kill('SIGKILL')
  }

  private writeLine(obj: unknown): void {
    if (this.child.stdin?.writable) this.child.stdin.write(JSON.stringify(obj) + '\n')
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    let newline: number
    while ((newline = this.stdoutBuffer.indexOf('\n')) >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (!line) continue
      let raw: any
      try {
        raw = JSON.parse(line)
      } catch {
        continue // non-JSON noise on stdout is not part of the protocol
      }
      this.translate(raw)
    }
  }

  private translate(raw: any): void {
    switch (raw.type) {
      case 'system': {
        if (raw.subtype === 'init') {
          this.settleToken(raw.session_id)
          this.queue.push({
            type: 'session_started',
            resumeToken: raw.session_id,
            model: raw.model,
            raw,
          })
        }
        return
      }
      case 'stream_event': {
        const delta = raw.event?.delta
        if (raw.event?.type === 'content_block_delta' && delta?.type === 'text_delta' && delta.text) {
          this.queue.push({ type: 'assistant_delta', text: delta.text, raw })
        }
        return
      }
      case 'assistant': {
        const content: any[] = raw.message?.content ?? []
        for (const block of content) {
          if (block.type === 'tool_use') {
            this.queue.push({
              type: 'tool_call',
              name: block.name,
              input: block.input,
              callId: block.id,
              raw,
            })
          }
        }
        if (content.some((b) => b.type === 'text' && b.text)) {
          this.queue.push({ type: 'assistant_message', content, raw })
        }
        return
      }
      case 'user': {
        const content: any[] = raw.message?.content ?? []
        for (const block of content) {
          if (block.type === 'tool_result') {
            this.queue.push({
              type: 'tool_result',
              callId: block.tool_use_id,
              output: block.content,
              isError: block.is_error === true,
              raw,
            })
          }
        }
        return
      }
      case 'control_request': {
        if (raw.request?.subtype === 'can_use_tool') {
          this.queue.push({
            type: 'permission_request',
            id: raw.request_id,
            tool: raw.request.tool_name,
            input: raw.request.input,
            raw,
          })
        } else {
          // Unknown CLI-initiated request: refuse rather than hang it forever.
          this.writeLine({
            type: 'control_response',
            response: {
              subtype: 'error',
              request_id: raw.request_id,
              error: `unsupported control request: ${raw.request?.subtype}`,
            },
          })
        }
        return
      }
      case 'result': {
        this.resultSeen = true
        this.settleToken(raw.session_id)
        const usage = usageFromResult(raw)
        this.queue.push({ type: 'usage_update', usage, raw })
        this.queue.push({
          type: 'session_ended',
          outcome: outcomeFromResult(raw, this.interruptedByUs),
          usage,
          resumable: typeof raw.session_id === 'string',
          raw,
        })
        this.child.stdin?.end()
        return
      }
      default:
        return // rate_limit_event, hook chatter, future event types
    }
  }

  private exitOutcome(): SessionOutcome {
    if (this.killedByUs) return 'killed'
    if (this.interruptedByUs) return 'interrupted'
    return 'crashed'
  }

  private settleToken(sessionId: unknown): void {
    if (this.tokenSettled || typeof sessionId !== 'string') return
    this.tokenSettled = true
    this.resolveToken(sessionId)
  }

  private finish(outcome: SessionOutcome): void {
    if (!this.tokenSettled) {
      this.tokenSettled = true
      this.rejectToken(new Error(`session ended (${outcome}) before a session id was assigned`))
    }
    if (!this.resultSeen) {
      this.resultSeen = true
      // Contract: exactly one session_ended per stream — synthesize when the
      // process dies without a result event. `raw` is absent by design.
      this.queue.push({
        type: 'session_ended',
        outcome,
        resumable: false,
        raw: undefined,
      })
    }
    this.queue.end()
  }
}

function outcomeFromResult(raw: any, interrupted: boolean): SessionOutcome {
  if (raw.subtype === 'success' && raw.is_error !== true) return 'completed'
  if (raw.subtype === 'error_max_turns') return 'max_turns'
  if (interrupted) return 'interrupted'
  return 'error'
}

function usageFromResult(raw: any): Usage {
  const u = raw.usage ?? {}
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens,
    cacheCreationInputTokens: u.cache_creation_input_tokens,
    costUsd: typeof raw.total_cost_usd === 'number' ? raw.total_cost_usd : undefined,
  }
}

/** Unbounded push queue exposed as a single-consumer AsyncIterable. */
class AsyncEventQueue<T> implements AsyncIterable<T> {
  private items: T[] = []
  private waiters: Array<(result: IteratorResult<T>) => void> = []
  private ended = false

  push(item: T): void {
    if (this.ended) return
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value: item, done: false })
    else this.items.push(item)
  }

  end(): void {
    if (this.ended) return
    this.ended = true
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.items.length > 0) {
          return Promise.resolve({ value: this.items.shift() as T, done: false })
        }
        if (this.ended) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => this.waiters.push(resolve))
      },
    }
  }
}
