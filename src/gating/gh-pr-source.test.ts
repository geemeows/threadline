import { describe, expect, it } from 'vitest'
import { countUnresolved, GhPrSource, pickPR, type GhExec } from './gh-pr-source.js'

describe('pickPR', () => {
  const open = { number: 1, url: 'u1', state: 'OPEN' as const }
  const merged = { number: 2, url: 'u2', state: 'MERGED' as const }
  const closed = { number: 3, url: 'u3', state: 'CLOSED' as const }

  it('prefers open over merged over abandoned', () => {
    expect(pickPR([closed, merged, open])).toBe(open)
    expect(pickPR([closed, merged])).toBe(merged)
    expect(pickPR([closed])).toBe(closed)
    expect(pickPR([])).toBeUndefined()
  })
})

describe('countUnresolved', () => {
  it('counts unresolved threads and tolerates missing shapes', () => {
    const graphql = {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: { nodes: [{ isResolved: true }, { isResolved: false }, { isResolved: false }] },
          },
        },
      },
    }
    expect(countUnresolved(graphql)).toBe(2)
    expect(countUnresolved({})).toBe(0)
  })
})

describe('GhPrSource', () => {
  it('lists PRs by head+base in the repo dir and fetches threads for live PRs', async () => {
    const calls: string[][] = []
    const exec: GhExec = async (args, repoDir) => {
      calls.push([repoDir, ...args])
      if (args[0] === 'pr')
        return JSON.stringify([{ number: 7, url: 'https://x/pull/7', state: 'OPEN' }])
      return JSON.stringify({
        data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: false }] } } } },
      })
    }
    const pr = await new GhPrSource(exec).ticketPR('/ws/repo', 'tl/o-repo-2', 'tl/effort/1')
    expect(pr).toEqual({ url: 'https://x/pull/7', state: 'open', unresolvedReviewThreads: 1 })
    expect(calls[0]).toEqual([
      '/ws/repo', 'pr', 'list', '--head', 'tl/o-repo-2', '--base', 'tl/effort/1',
      '--state', 'all', '--json', 'number,url,state', '--limit', '20',
    ])
    expect(calls[1]![0]).toBe('/ws/repo')
    expect(calls[1]).toContain('graphql')
    expect(calls[1]).toContain('number=7')
  })

  it('returns null when no PR exists and skips threads for abandoned PRs', async () => {
    const none = new GhPrSource(async () => '[]')
    expect(await none.ticketPR('/r', 'b', 't')).toBeNull()

    let graphqlCalled = false
    const abandoned = new GhPrSource(async (args) => {
      if (args[0] === 'api') graphqlCalled = true
      return JSON.stringify([{ number: 7, url: 'u', state: 'CLOSED' }])
    })
    expect(await abandoned.ticketPR('/r', 'b', 't')).toEqual({
      url: 'u',
      state: 'closed',
      unresolvedReviewThreads: 0,
    })
    expect(graphqlCalled).toBe(false)
  })
})
