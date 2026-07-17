import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionMeta } from './transcripts.js'
import { TranscriptStore } from './transcripts.js'

let dir: string
let store: TranscriptStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'threadmap-transcripts-'))
  store = new TranscriptStore(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function meta(id: string, createdAt: string): SessionMeta {
  return {
    id,
    adapter: 'fake',
    cwd: '/repo',
    prompt: '/grilling go',
    createdAt,
    status: 'ended',
  }
}

describe('TranscriptStore', () => {
  it('appends events and reads them back in order', async () => {
    await store.append('s1', { type: 'assistant_delta', text: 'hel', raw: 1 })
    await store.append('s1', { type: 'assistant_delta', text: 'lo', raw: 2 })

    const events = await store.readEvents('s1')
    expect(events).toEqual([
      { type: 'assistant_delta', text: 'hel', raw: 1 },
      { type: 'assistant_delta', text: 'lo', raw: 2 },
    ])
  })

  it('returns [] for an unknown session transcript', async () => {
    expect(await store.readEvents('nope')).toEqual([])
    expect(await store.readMeta('nope')).toBeNull()
  })

  it('round-trips metadata and lists sessions newest first', async () => {
    await store.writeMeta(meta('old', '2026-07-01T00:00:00Z'))
    await store.writeMeta(meta('new', '2026-07-17T00:00:00Z'))

    expect(await store.readMeta('old')).toMatchObject({ id: 'old', status: 'ended' })
    expect((await store.list()).map((m) => m.id)).toEqual(['new', 'old'])
  })
})
