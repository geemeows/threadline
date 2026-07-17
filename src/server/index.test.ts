import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './index.js'
import { SessionRegistry } from './registry.js'
import { TranscriptStore } from './transcripts.js'
import { FakeAdapter } from './test-helpers.js'

let dir: string
let app: ReturnType<typeof createApp>['app']
let store: TranscriptStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'threadmap-app-'))
  store = new TranscriptStore(dir)
  const registry = new SessionRegistry({ fake: new FakeAdapter() }, store)
  const workspace = { root: '/ws', repos: [{ name: 'api', path: '/ws/api' }] }
  const ghExec = async (args: string[]) =>
    args[0] === 'repo'
      ? JSON.stringify({ nameWithOwner: 'geemeows/api' })
      : JSON.stringify([{ number: 1, title: 'Map: mvp', url: 'https://x/1', state: 'OPEN' }])
  ;({ app } = createApp({ workspace, registry, store, ghExec }))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('server', () => {
  it('responds on /api/health', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, name: 'threadmap' })
  })

  it('serves the discovered workspace', async () => {
    const res = await app.request('/api/workspace')
    expect(await res.json()).toEqual({ root: '/ws', repos: [{ name: 'api', path: '/ws/api' }] })
  })

  it('enumerates efforts off map issues', async () => {
    const res = await app.request('/api/efforts')
    const efforts = (await res.json()) as Array<{ ref: { id: string }; title: string }>
    expect(efforts).toHaveLength(1)
    expect(efforts[0]).toMatchObject({ ref: { id: 'geemeows/api#1' }, title: 'Map: mvp' })
  })

  it('lists sessions and 404s unknown session ids', async () => {
    expect(await (await app.request('/api/sessions')).json()).toEqual([])
    expect((await app.request('/api/sessions/nope')).status).toBe(404)
  })

  it('serves persisted transcripts', async () => {
    await store.append('s1', { type: 'assistant_delta', text: 'hi', raw: {} })
    const res = await app.request('/api/sessions/s1/transcript')
    expect(await res.json()).toEqual([{ type: 'assistant_delta', text: 'hi', raw: {} }])
  })
})
