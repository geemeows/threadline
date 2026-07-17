import { describe, expect, it, vi } from 'vitest'
import type {
  ChildTicket,
  LabelNamespace,
  SpecStatus,
  TicketRef,
  TrackerAdapter,
} from '../tracker/types.js'
import { refSlug, ticketBranchPattern, trunkBranch } from './branches.js'
import { computeStage, watchEffort } from './watch.js'
import { applyOverride, formatOverrideComment, revokeOverride } from './override.js'
import type { PRInfo, PRSource } from './types.js'
import type { GatherDeps } from './inputs.js'

function ref(id: string, display = id): TicketRef {
  return { id, display, url: `https://example.test/${id}` }
}

const effort = ref('o/home#1', 'o/home#1')

class FakeTracker implements TrackerAdapter {
  name = 'fake'
  capabilities = { minPollIntervalMs: 1, freePolling: true }
  planningChildren: TicketRef[] = []
  ticketChildren: ChildTicket[] = []
  spec: SpecStatus = 'approved'
  stamps: string[] = ['ticketed']
  changes: boolean[] = []
  comments: string[] = []

  async openChildren(_e: TicketRef, ns?: LabelNamespace) {
    return ns === 'wayfinder' ? this.planningChildren : []
  }
  async children(_e: TicketRef, _ns?: LabelNamespace) {
    return this.ticketChildren
  }
  async frontier() {
    return []
  }
  async specStatus() {
    return this.spec
  }
  async mapStamps() {
    return this.stamps
  }
  async ticketBody() {
    return { title: 'ticket title', body: 'ticket body' }
  }
  async ticketTarget() {
    return { id: 'o/repo', display: 'o/repo' }
  }
  async routingTargets() {
    return [{ id: 'o/repo', display: 'o/repo' }]
  }
  async createChild(): Promise<TicketRef> {
    throw new Error('unused')
  }
  async addBlockedBy() {}
  async comment(_r: TicketRef, md: string) {
    this.comments.push(md)
  }
  async stamp(_r: TicketRef, name: string) {
    this.stamps.push(name)
  }
  async unstamp(_r: TicketRef, name: string) {
    this.stamps = this.stamps.filter((s) => s !== name)
  }
  async resolve() {}
  async changesSince(_e: TicketRef, cursor?: string) {
    const n = cursor ? Number(cursor) : 0
    return { changed: this.changes[n] ?? false, cursor: String(n + 1) }
  }
}

class FakePRSource implements PRSource {
  calls: { repoDir: string; ticketId: string; trunk: string }[] = []
  byTicket = new Map<string, PRInfo | null>()
  async ticketPR(repoDir: string, ticket: TicketRef, trunk: string) {
    this.calls.push({ repoDir, ticketId: ticket.id, trunk })
    return this.byTicket.get(ticket.id) ?? null
  }
}

function deps(tracker: FakeTracker, prSource: FakePRSource): GatherDeps {
  return { tracker, prSource, resolveRepoDir: (t) => `/ws/${t.id}` }
}

describe('branch conventions', () => {
  it('slugs GitHub refs and passes UUIDs through', () => {
    expect(refSlug(ref('o/repo#42'))).toBe('o-repo-42')
    expect(refSlug(ref('A1B2-c3d4'))).toBe('a1b2-c3d4')
    expect(ticketBranchPattern(ref('o/repo#42')).test('tm/feat/42-add-thing')).toBe(true)
  })

  it('trunk uses the map number, falling back to the slug', () => {
    expect(trunkBranch(ref('o/home#7', 'o/home#7'))).toBe('tm/effort/7')
    expect(trunkBranch(ref('uuid-123', 'ENG-45'))).toBe('tm/effort/uuid-123')
  })
})

describe('computeStage wiring', () => {
  it('asks the PR source about each ticket branch against the effort trunk, in the owning repo', async () => {
    const tracker = new FakeTracker()
    tracker.ticketChildren = [
      { ref: ref('o/repo#2'), state: 'open' },
      { ref: ref('o/repo#3'), state: 'closed' },
    ]
    const prs = new FakePRSource()
    prs.byTicket.set('o/repo#2', { url: 'u', state: 'open', unresolvedReviewThreads: 0 })

    const snap = await computeStage(deps(tracker, prs), effort)
    expect(prs.calls).toEqual([
      { repoDir: '/ws/o/repo', ticketId: 'o/repo#2', trunk: 'tm/effort/1' },
      { repoDir: '/ws/o/repo', ticketId: 'o/repo#3', trunk: 'tm/effort/1' },
    ])
    expect(snap.stage).toBe('implement')
    expect(snap.gates[3]!.unmet).toEqual(['o/repo#3 has no PR targeting the effort trunk'])
  })
})

describe('watchEffort', () => {
  it('yields immediately, then only on derived change, and stops on abort', async () => {
    const tracker = new FakeTracker()
    tracker.ticketChildren = [{ ref: ref('o/repo#2'), state: 'open' }]
    // poll 1: changed but same derivation; poll 2: unchanged; poll 3: changed + moved
    tracker.changes = [true, false, true]
    const prs = new FakePRSource()

    const ac = new AbortController()
    const seen: string[] = []
    const iter = watchEffort(deps(tracker, prs), effort, {
      signal: ac.signal,
      prRefreshIntervalMs: 60_000,
    })
    for await (const snap of iter) {
      seen.push(snap.stage)
      if (seen.length === 1) {
        // after first yield, let the ticket gain a PR before the next changed poll
        prs.byTicket.set('o/repo#2', { url: 'u', state: 'open', unresolvedReviewThreads: 0 })
      }
      if (seen.length === 2) ac.abort()
    }
    expect(seen).toEqual(['implement', 'code-review'])
  })

  it('recomputes on the PR refresh cadence even when the tracker is quiet', async () => {
    const tracker = new FakeTracker()
    tracker.ticketChildren = [{ ref: ref('o/repo#2'), state: 'open' }]
    tracker.changes = [] // tracker never reports a change
    const prs = new FakePRSource()

    const ac = new AbortController()
    const seen: string[] = []
    for await (const snap of watchEffort(deps(tracker, prs), effort, {
      signal: ac.signal,
      prRefreshIntervalMs: 2, // ≤ poll interval → refresh every poll
    })) {
      seen.push(snap.stage)
      prs.byTicket.set('o/repo#2', { url: 'u', state: 'open', unresolvedReviewThreads: 0 })
      if (seen.length === 2) ac.abort()
    }
    expect(seen).toEqual(['implement', 'code-review'])
  })
})

describe('override write path', () => {
  const record = {
    who: 'geemeows',
    when: '2026-07-17T00:00:00Z',
    unmetConditions: ['spec sub-issue is still open (closing = approval)'],
    reason: 'spec approved verbally in standup',
  }

  it('writes the audit comment before the stamp', async () => {
    const tracker = new FakeTracker()
    tracker.stamps = []
    const order: string[] = []
    vi.spyOn(tracker, 'comment').mockImplementation(async (_r, md) => {
      order.push('comment')
      tracker.comments.push(md)
    })
    vi.spyOn(tracker, 'stamp').mockImplementation(async (_r, name) => {
      order.push('stamp')
      tracker.stamps.push(name)
    })

    await applyOverride(tracker, effort, 'to-spec', record)
    expect(order).toEqual(['comment', 'stamp'])
    expect(tracker.stamps).toEqual(['override:to-spec'])
    expect(tracker.comments[0]).toContain('## Override: to-spec')
    expect(tracker.comments[0]).toContain('**Who**: geemeows')
    expect(tracker.comments[0]).toContain('spec sub-issue is still open')
  })

  it('rejects an override without a reason', async () => {
    const tracker = new FakeTracker()
    await expect(
      applyOverride(tracker, effort, 'to-spec', { ...record, reason: '  ' }),
    ).rejects.toThrow(/reason/)
    expect(tracker.comments).toEqual([])
  })

  it('revoke removes the stamp and leaves an audit comment', async () => {
    const tracker = new FakeTracker()
    tracker.stamps = ['ticketed', 'override:to-spec']
    await revokeOverride(tracker, effort, 'to-spec', 'geemeows', '2026-07-17T01:00:00Z')
    expect(tracker.stamps).toEqual(['ticketed'])
    expect(tracker.comments[0]).toContain('## Override revoked: to-spec')
  })

  it('formats every audit field', () => {
    const md = formatOverrideComment('implement', record)
    expect(md).toMatchInlineSnapshot(`
      "## Override: implement

      - **Who**: geemeows
      - **When**: 2026-07-17T00:00:00Z
      - **Unmet condition(s)**:
        - spec sub-issue is still open (closing = approval)
      - **Reason**: spec approved verbally in standup"
    `)
  })
})
