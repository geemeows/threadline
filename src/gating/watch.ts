// Effort watcher — the engine's single poll loop. Change detection goes
// through the seam's opaque cursors (changesSince), paced by the adapter's
// capabilities. PR state lives outside the tracker (#19 §6), so gates that
// hang on PRs can move with no tracker change at all — a slower unconditional
// recompute cadence covers that.

import type { TicketRef } from '../tracker/types.js'
import type { StageSnapshot } from './types.js'
import { deriveStage } from './derive.js'
import { gatherGateInputs, type GatherDeps } from './inputs.js'

export interface WatchOptions {
  signal?: AbortSignal
  /** Floor between polls; the adapter's minPollIntervalMs still wins. */
  pollIntervalMs?: number
  /** Recompute even without a tracker change (PR-driven gates). Default 60s. */
  prRefreshIntervalMs?: number
}

export async function computeStage(deps: GatherDeps, effort: TicketRef): Promise<StageSnapshot> {
  return deriveStage(await gatherGateInputs(deps, effort))
}

/**
 * Yields a snapshot immediately, then again whenever the derived result
 * changes. Returns when the signal aborts.
 */
export async function* watchEffort(
  deps: GatherDeps,
  effort: TicketRef,
  opts: WatchOptions = {},
): AsyncGenerator<StageSnapshot> {
  const { signal } = opts
  const pollEvery = Math.max(
    deps.tracker.capabilities.minPollIntervalMs,
    opts.pollIntervalMs ?? 0,
  )
  const prRefreshEvery = opts.prRefreshIntervalMs ?? 60_000

  let last = await computeStage(deps, effort)
  yield last
  let cursor: string | undefined
  let sincePrRefresh = 0

  while (!signal?.aborted) {
    await sleep(pollEvery, signal)
    if (signal?.aborted) return
    sincePrRefresh += pollEvery

    let changed: boolean
    try {
      ;({ changed, cursor } = await deps.tracker.changesSince(effort, cursor))
    } catch {
      continue // transient tracker error — keep the loop alive, retry next tick
    }
    if (!changed && sincePrRefresh < prRefreshEvery) continue
    sincePrRefresh = 0

    let next: StageSnapshot
    try {
      next = await computeStage(deps, effort)
    } catch {
      continue
    }
    if (JSON.stringify(next) !== JSON.stringify(last)) {
      last = next
      yield next
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const t = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
    function done() {
      clearTimeout(t)
      signal?.removeEventListener('abort', done)
      resolve()
    }
  })
}
