// REST surface for the implement pipeline (#30). Every route is a thin
// binding over the PipelineOrchestrator; the sessions it starts stream over
// the normal WS channel like any other session — these routes only trigger
// them and report git/PR side effects.

import { Hono } from 'hono'
import type { PipelineOrchestrator } from '../pipeline/orchestrator.js'

export interface PipelineRouteDeps {
  /** Lazy: tracker config + repo resolution need I/O, route creation doesn't. */
  orchestrator: () => Promise<PipelineOrchestrator>
}

export function createPipelineApp(deps: PipelineRouteDeps): Hono {
  const app = new Hono()

  const body = async (c: { req: { json(): Promise<unknown> } }) =>
    (await c.req.json().catch(() => ({}))) as { effort?: string; ticket?: string; force?: boolean }

  app.post('/implement', async (c) => {
    const { effort, ticket } = await body(c)
    if (!effort || !ticket) return c.json({ error: 'missing effort or ticket' }, 400)
    try {
      return c.json(await (await deps.orchestrator()).startImplement(effort, ticket))
    } catch (err) {
      return c.json({ error: message(err) }, 502)
    }
  })

  app.post('/reconcile', async (c) => {
    const { effort, ticket } = await body(c)
    if (!effort || !ticket) return c.json({ error: 'missing effort or ticket' }, 400)
    try {
      return c.json(await (await deps.orchestrator()).startReconcile(effort, ticket))
    } catch (err) {
      return c.json({ error: message(err) }, 502)
    }
  })

  app.post('/land', async (c) => {
    const { effort } = await body(c)
    if (!effort) return c.json({ error: 'missing effort' }, 400)
    try {
      return c.json({ results: await (await deps.orchestrator()).land(effort) })
    } catch (err) {
      return c.json({ error: message(err) }, 502)
    }
  })

  app.post('/cleanup', async (c) => {
    const { effort } = await body(c)
    if (!effort) return c.json({ error: 'missing effort' }, 400)
    try {
      return c.json({ results: await (await deps.orchestrator()).cleanupMerged(effort) })
    } catch (err) {
      return c.json({ error: message(err) }, 502)
    }
  })

  app.post('/complete', async (c) => {
    const { effort, force } = await body(c)
    if (!effort) return c.json({ error: 'missing effort' }, 400)
    try {
      return c.json({
        results: await (await deps.orchestrator()).completeEffort(effort, { force: force ?? false }),
      })
    } catch (err) {
      return c.json({ error: message(err) }, 502)
    }
  })

  return app
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
