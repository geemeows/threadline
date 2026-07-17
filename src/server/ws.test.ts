import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionRegistry } from './registry.js'
import { TranscriptStore } from './transcripts.js'
import { FakeAdapter, eventually } from './test-helpers.js'
import type { ServerMessage } from './ws.js'
import { createConnection } from './ws.js'

let dir: string
let adapter: FakeAdapter
let registry: SessionRegistry
let sent: ServerMessage[]
let connection: ReturnType<typeof createConnection>

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'threadmap-ws-proto-'))
  adapter = new FakeAdapter()
  registry = new SessionRegistry({ fake: adapter }, new TranscriptStore(dir))
  sent = []
  connection = createConnection(registry, (msg) => sent.push(msg))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const startMsg = JSON.stringify({
  type: 'start_session',
  cwd: '/repo',
  prompt: 'go',
  permissionPolicy: { mode: 'default', intercept: true },
})

function sessionId(): string {
  const msg = sent.find((m) => m.type === 'session') as { meta: { id: string } }
  return msg.meta.id
}

describe('ws connection', () => {
  it('start_session replies with meta and streams that session’s events', async () => {
    await connection.onMessage(startMsg)
    expect(sent[0]).toMatchObject({ type: 'session', meta: { status: 'running' } })

    adapter.sessions[0]!.emit({ type: 'assistant_delta', text: 'hi', raw: {} })
    await eventually(() =>
      expect(sent).toContainEqual({
        type: 'event',
        sessionId: sessionId(),
        event: { type: 'assistant_delta', text: 'hi', raw: {} },
      }),
    )
  })

  it('attach replays the buffer; detach stops the stream', async () => {
    await connection.onMessage(startMsg)
    const id = sessionId()
    adapter.sessions[0]!.emit({ type: 'assistant_delta', text: 'one', raw: {} })
    await eventually(() => expect(sent.filter((m) => m.type === 'event')).toHaveLength(1))

    // a second connection attaching late sees the buffered event replayed
    const sent2: ServerMessage[] = []
    const conn2 = createConnection(registry, (msg) => sent2.push(msg))
    await conn2.onMessage(JSON.stringify({ type: 'attach', sessionId: id }))
    expect(sent2).toHaveLength(1)

    await conn2.onMessage(JSON.stringify({ type: 'detach', sessionId: id }))
    adapter.sessions[0]!.emit({ type: 'assistant_delta', text: 'two', raw: {} })
    await eventually(() => expect(sent.filter((m) => m.type === 'event')).toHaveLength(2))
    expect(sent2).toHaveLength(1) // detached — saw nothing new
  })

  it('routes send, permission, interrupt, and kill to the session', async () => {
    await connection.onMessage(startMsg)
    const id = sessionId()
    const session = adapter.sessions[0]!

    await connection.onMessage(JSON.stringify({ type: 'send', sessionId: id, text: 'more' }))
    await connection.onMessage(
      JSON.stringify({ type: 'permission', sessionId: id, id: 'p1', decision: { behavior: 'deny' } }),
    )
    await connection.onMessage(JSON.stringify({ type: 'interrupt', sessionId: id }))
    await connection.onMessage(JSON.stringify({ type: 'kill', sessionId: id }))

    expect(session.sent).toEqual([{ text: 'more' }])
    expect(session.permissions).toEqual([{ id: 'p1', decision: { behavior: 'deny' } }])
    expect(session.interrupted).toBe(true)
    expect(session.killed).toBe(true)
  })

  it('answers malformed and failing messages with error, not a dead socket', async () => {
    await connection.onMessage('not json')
    expect(sent[0]).toMatchObject({ type: 'error', message: expect.stringContaining('JSON') })

    await connection.onMessage(JSON.stringify({ type: 'send', sessionId: 'nope', text: 'x' }))
    expect(sent[1]).toMatchObject({ type: 'error', message: expect.stringContaining('nope') })

    await connection.onMessage(JSON.stringify({ type: 'wat' }))
    expect(sent[2]).toMatchObject({ type: 'error', message: expect.stringContaining('wat') })
  })

  it('close detaches all subscriptions', async () => {
    await connection.onMessage(startMsg)
    connection.close()
    adapter.sessions[0]!.emit({ type: 'assistant_delta', text: 'after', raw: {} })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sent.filter((m) => m.type === 'event')).toHaveLength(0)
  })
})
