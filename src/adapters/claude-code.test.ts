import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { ClaudeCodeAdapter, buildArgs } from './claude-code.js'
import type { AgentEvent, StartOptions } from './types.js'

class FakeChild extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  killedWith: string | undefined

  kill(signal?: string): boolean {
    this.killedWith = signal ?? 'SIGTERM'
    return true
  }

  emitLine(obj: unknown): void {
    this.stdout.write(JSON.stringify(obj) + '\n')
  }

  close(): void {
    this.stdout.end()
    this.emit('close', 0, null)
  }

  stdinLines(): unknown[] {
    const text = (this.stdin.read() as Buffer | null)?.toString() ?? ''
    return text
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
  }
}

function makeSession(opts?: Partial<StartOptions>) {
  const child = new FakeChild()
  const adapter = new ClaudeCodeAdapter({
    spawnFn: () => child as unknown as ChildProcess,
  })
  const session = adapter.start({
    cwd: '/tmp/x',
    prompt: 'do the thing',
    permissionPolicy: { mode: 'default', intercept: true },
    ...opts,
  })
  return { child, adapter, session }
}

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for await (const ev of events) out.push(ev)
  return out
}

// Wire fixtures below are trimmed captures from live probes against claude 2.1.211.
const INIT = { type: 'system', subtype: 'init', session_id: 'sess-123', model: 'claude-fable-5' }
const RESULT = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  session_id: 'sess-123',
  total_cost_usd: 0.25,
  usage: {
    input_tokens: 4,
    output_tokens: 233,
    cache_read_input_tokens: 40945,
    cache_creation_input_tokens: 10199,
  },
}

describe('buildArgs', () => {
  const base: StartOptions = {
    cwd: '/tmp/x',
    prompt: 'p',
    permissionPolicy: { mode: 'default', intercept: true },
  }

  it('always speaks stream-json both ways in print mode', () => {
    const args = buildArgs(base)
    expect(args).toContain('-p')
    expect(args.join(' ')).toContain('--input-format stream-json')
    expect(args.join(' ')).toContain('--output-format stream-json')
    expect(args).toContain('--include-partial-messages')
  })

  it('enables the stdio permission prompt only when intercepting', () => {
    expect(buildArgs(base).join(' ')).toContain('--permission-prompt-tool stdio')
    expect(
      buildArgs({ ...base, permissionPolicy: { mode: 'default', intercept: false } }).join(' '),
    ).not.toContain('--permission-prompt-tool')
    expect(
      buildArgs({ ...base, permissionPolicy: { mode: 'bypassPermissions', intercept: true } }).join(' '),
    ).not.toContain('--permission-prompt-tool')
  })

  it('passes tool lists, mcp config, model, and resume token', () => {
    const args = buildArgs(
      {
        ...base,
        permissionPolicy: { mode: 'acceptEdits', intercept: true, allowedTools: ['Read', 'Grep'], disallowedTools: ['Bash'] },
        mcpConfig: { servers: { tracker: { command: 'x' } }, strict: true },
        model: 'claude-sonnet-5',
      },
      'sess-42',
    )
    const joined = args.join(' ')
    expect(joined).toContain('--permission-mode acceptEdits')
    expect(joined).toContain('--allowedTools Read,Grep')
    expect(joined).toContain('--disallowedTools Bash')
    expect(joined).toContain('--strict-mcp-config')
    expect(args[args.indexOf('--mcp-config') + 1]).toBe(JSON.stringify({ mcpServers: { tracker: { command: 'x' } } }))
    expect(joined).toContain('--model claude-sonnet-5')
    expect(joined).toContain('--resume sess-42')
  })
})

describe('ClaudeCodeSession', () => {
  it('writes the prompt as the first stream-json user message', () => {
    const { child } = makeSession({ prompt: 'hello world' })
    const [first] = child.stdinLines() as any[]
    expect(first).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'hello world' }] },
    })
  })

  it('translates a full happy-path stream and resolves the resume token', async () => {
    const { child, session } = makeSession()
    child.emitLine(INIT)
    child.emitLine({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
    })
    child.emitLine({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Writing it now.' },
          { type: 'tool_use', id: 'toolu_1', name: 'Write', input: { file_path: '/tmp/x/a.txt' } },
        ],
      },
    })
    child.emitLine({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'File created', is_error: false }],
      },
    })
    child.emitLine({ type: 'rate_limit_event', rate_limit_info: {} }) // must be ignored
    child.emitLine(RESULT)
    child.close()

    await expect(session.resumeToken).resolves.toBe('sess-123')
    const events = await collect(session.events)
    expect(events.map((e) => e.type)).toEqual([
      'session_started',
      'assistant_delta',
      'tool_call',
      'assistant_message',
      'tool_result',
      'usage_update',
      'session_ended',
    ])
    const ended = events.at(-1) as Extract<AgentEvent, { type: 'session_ended' }>
    expect(ended.outcome).toBe('completed')
    expect(ended.resumable).toBe(true)
    expect(ended.usage).toEqual({
      inputTokens: 4,
      outputTokens: 233,
      cacheReadInputTokens: 40945,
      cacheCreationInputTokens: 10199,
      costUsd: 0.25,
    })
    // every non-synthesized event carries the raw CLI JSON
    expect(events.every((e) => e.raw !== undefined)).toBe(true)
  })

  it('handles NDJSON lines split across chunks', async () => {
    const { child, session } = makeSession()
    const line = JSON.stringify(INIT) + '\n'
    child.stdout.write(line.slice(0, 20))
    child.stdout.write(line.slice(20))
    child.emitLine(RESULT)
    child.close()
    const events = await collect(session.events)
    expect(events[0]?.type).toBe('session_started')
  })

  it('surfaces can_use_tool as permission_request and round-trips the decision', async () => {
    const { child, session } = makeSession()
    child.emitLine(INIT)
    // exact shape captured from the live probe
    child.emitLine({
      type: 'control_request',
      request_id: 'req-9',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Write',
        display_name: 'Write',
        input: { file_path: '/tmp/x/a.txt', content: 'hi' },
        tool_use_id: 'toolu_1',
      },
    })

    const iterator = session.events[Symbol.asyncIterator]()
    await iterator.next() // session_started
    const { value: perm } = await iterator.next()
    expect(perm).toMatchObject({
      type: 'permission_request',
      id: 'req-9',
      tool: 'Write',
      input: { file_path: '/tmp/x/a.txt', content: 'hi' },
    })

    session.respondPermission('req-9', { behavior: 'allow', updatedInput: { file_path: '/tmp/x/a.txt', content: 'hi' } })
    session.respondPermission('req-9', { behavior: 'deny' })
    const lines = child.stdinLines() as any[]
    expect(lines.at(-2)).toEqual({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'req-9',
        response: { behavior: 'allow', updatedInput: { file_path: '/tmp/x/a.txt', content: 'hi' } },
      },
    })
    expect(lines.at(-1).response.response).toEqual({ behavior: 'deny', message: 'Denied by user' })
  })

  it('refuses unknown control requests instead of hanging them', () => {
    const { child } = makeSession()
    child.emitLine({ type: 'control_request', request_id: 'req-x', request: { subtype: 'mystery' } })
    return new Promise<void>((resolve) => {
      setImmediate(() => {
        const last = (child.stdinLines() as any[]).at(-1)
        expect(last.response.subtype).toBe('error')
        expect(last.response.request_id).toBe('req-x')
        resolve()
      })
    })
  })

  it('synthesizes session_ended(crashed) when the process dies without a result', async () => {
    const { child, session } = makeSession()
    child.emitLine(INIT)
    child.close()
    const events = await collect(session.events)
    const ended = events.at(-1) as Extract<AgentEvent, { type: 'session_ended' }>
    expect(ended).toMatchObject({ type: 'session_ended', outcome: 'crashed', resumable: false })
    expect(ended.raw).toBeUndefined()
  })

  it('reports killed when kill() was ours, and exactly one session_ended', async () => {
    const { child, session } = makeSession()
    child.emitLine(INIT)
    session.kill()
    expect(child.killedWith).toBe('SIGKILL')
    child.close()
    const events = await collect(session.events)
    const ends = events.filter((e) => e.type === 'session_ended')
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ outcome: 'killed', resumable: false })
  })

  it('maps result subtypes to outcomes', async () => {
    for (const [subtype, outcome] of [
      ['error_max_turns', 'max_turns'],
      ['error_during_execution', 'error'],
    ] as const) {
      const { child, session } = makeSession()
      child.emitLine(INIT)
      child.emitLine({ ...RESULT, subtype, is_error: true })
      child.close()
      const events = await collect(session.events)
      const ended = events.at(-1) as Extract<AgentEvent, { type: 'session_ended' }>
      expect(ended.outcome).toBe(outcome)
    }
  })

  it('send() writes a user message; interrupt() sends the control request', () => {
    const { child, session } = makeSession()
    session.send({ text: 'follow-up' })
    session.interrupt()
    const lines = child.stdinLines() as any[]
    expect(lines.at(-2).message.content).toEqual([{ type: 'text', text: 'follow-up' }])
    expect(lines.at(-1)).toMatchObject({ type: 'control_request', request: { subtype: 'interrupt' } })
  })

  it('rejects resumeToken when the session dies before init', async () => {
    const { child, session } = makeSession()
    child.close()
    await expect(session.resumeToken).rejects.toThrow(/before a session id/)
  })

  it('resume() passes the token straight back to the CLI', () => {
    let capturedArgs: string[] = []
    const child = new FakeChild()
    const adapter = new ClaudeCodeAdapter({
      spawnFn: (_cmd, args) => {
        capturedArgs = args
        return child as unknown as ChildProcess
      },
    })
    adapter.resume('sess-abc', {
      cwd: '/tmp/x',
      prompt: 'continue',
      permissionPolicy: { mode: 'default', intercept: true },
    })
    expect(capturedArgs.join(' ')).toContain('--resume sess-abc')
  })
})
