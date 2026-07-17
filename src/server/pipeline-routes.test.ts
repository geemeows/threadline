import { describe, expect, it } from 'vitest'
import type { PipelineOrchestrator } from '../pipeline/orchestrator.js'
import { createPipelineApp } from './pipeline-routes.js'

function appWith(orchestrator: Partial<PipelineOrchestrator>) {
  return createPipelineApp({ orchestrator: async () => orchestrator as PipelineOrchestrator })
}

const post = (app: ReturnType<typeof createPipelineApp>, path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

describe('pipeline routes', () => {
  it('starts an implement session and returns its meta', async () => {
    const calls: string[][] = []
    const app = appWith({
      startImplement: async (effort: string, ticket: string) => {
        calls.push([effort, ticket])
        return { id: 's1', status: 'running' } as never
      },
    })
    const res = await post(app, '/implement', { effort: 'o/home#1', ticket: 'o/web#42' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 's1', status: 'running' })
    expect(calls).toEqual([['o/home#1', 'o/web#42']])
  })

  it('400s on missing parameters', async () => {
    const app = appWith({})
    expect((await post(app, '/implement', { effort: 'o/home#1' })).status).toBe(400)
    expect((await post(app, '/reconcile', {})).status).toBe(400)
    expect((await post(app, '/land', {})).status).toBe(400)
    expect((await post(app, '/cleanup', {})).status).toBe(400)
    expect((await post(app, '/complete', {})).status).toBe(400)
  })

  it('502s with the orchestrator error message', async () => {
    const app = appWith({
      land: async () => {
        throw new Error('trunk exploded')
      },
    })
    const res = await post(app, '/land', { effort: 'o/home#1' })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'trunk exploded' })
  })

  it('passes force through to completeEffort', async () => {
    const seen: unknown[] = []
    const app = appWith({
      completeEffort: async (_effort: string, opts: unknown) => {
        seen.push(opts)
        return []
      },
    })
    await post(app, '/complete', { effort: 'o/home#1', force: true })
    expect(seen).toEqual([{ force: true }])
  })
})
