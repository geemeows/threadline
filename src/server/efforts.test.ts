import { describe, expect, it } from 'vitest'
import type { GhExec } from '../gating/index.js'
import { listEfforts } from './efforts.js'

const repos = [
  { name: 'api', path: '/ws/api' },
  { name: 'web', path: '/ws/web' },
]

function fakeExec(byRepo: Record<string, { owner: string; issues: unknown[] }>): GhExec {
  return async (args, repoDir) => {
    const repo = byRepo[repoDir]
    if (!repo) throw new Error(`gh failed in ${repoDir}`)
    if (args[0] === 'repo') return JSON.stringify({ nameWithOwner: repo.owner })
    if (args[0] === 'issue') return JSON.stringify(repo.issues)
    throw new Error(`unexpected gh args: ${args.join(' ')}`)
  }
}

describe('listEfforts', () => {
  it('enumerates wayfinder:map issues across repos, minting owner/repo#n refs', async () => {
    const exec = fakeExec({
      '/ws/api': {
        owner: 'geemeows/api',
        issues: [{ number: 7, title: 'Map: payments', url: 'https://x/7', state: 'OPEN' }],
      },
      '/ws/web': {
        owner: 'geemeows/web',
        issues: [{ number: 3, title: 'Map: onboarding', url: 'https://x/3', state: 'OPEN' }],
      },
    })

    const efforts = await listEfforts(repos, exec)
    expect(efforts).toHaveLength(2)
    expect(efforts[0]).toMatchObject({
      ref: { id: 'geemeows/api#7', display: 'geemeows/api#7', url: 'https://x/7' },
      title: 'Map: payments',
      state: 'open',
      repo: { name: 'api' },
    })
  })

  it('skips repos where gh fails instead of failing the enumeration', async () => {
    const exec = fakeExec({
      '/ws/api': {
        owner: 'geemeows/api',
        issues: [{ number: 7, title: 'Map: payments', url: 'https://x/7', state: 'OPEN' }],
      },
      // /ws/web missing — exec throws there
    })

    const efforts = await listEfforts(repos, exec)
    expect(efforts.map((e) => e.ref.id)).toEqual(['geemeows/api#7'])
  })

  it('passes state=all only when includeClosed is set', async () => {
    const calls: string[][] = []
    const exec: GhExec = async (args) => {
      calls.push(args)
      if (args[0] === 'repo') return JSON.stringify({ nameWithOwner: 'o/r' })
      return JSON.stringify([])
    }

    await listEfforts([repos[0]!], exec)
    await listEfforts([repos[0]!], exec, { includeClosed: true })
    const issueCalls = calls.filter((a) => a[0] === 'issue')
    expect(issueCalls[0]).toContain('open')
    expect(issueCalls[1]).toContain('all')
  })
})
