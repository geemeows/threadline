import { describe, expect, it } from 'vitest'
import type { GhExec } from '../gating/index.js'
import { listEfforts, mintEffort, provisionalName } from './efforts.js'

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

describe('provisionalName', () => {
  it('takes the first non-empty line, trimmed', () => {
    expect(provisionalName('\n  Add a settings page  \nmore detail here')).toBe('Add a settings page')
  })

  it('returns empty string when the idea is blank', () => {
    expect(provisionalName('   \n\n  ')).toBe('')
  })

  it('caps long ideas at ~60 chars with an ellipsis', () => {
    const long = 'x'.repeat(80)
    const name = provisionalName(long)
    expect(name).toHaveLength(60)
    expect(name.endsWith('…')).toBe(true)
    expect(name.startsWith('x'.repeat(59))).toBe(true)
  })

  it('leaves a line at the cap untouched', () => {
    const exact = 'y'.repeat(60)
    expect(provisionalName(exact)).toBe(exact)
  })
})

describe('mintEffort', () => {
  const repo = { name: 'api', path: '/ws/api' }

  function fakeMintExec(url: string): { exec: GhExec; calls: { args: string[]; dir: string }[] } {
    const calls: { args: string[]; dir: string }[] = []
    const exec: GhExec = async (args, dir) => {
      calls.push({ args, dir })
      if (args[0] === 'repo') return JSON.stringify({ nameWithOwner: 'geemeows/api' })
      if (args[0] === 'issue' && args[1] === 'create') return `${url}\n`
      throw new Error(`unexpected gh args: ${args.join(' ')}`)
    }
    return { exec, calls }
  }

  it('creates a wayfinder:map issue with the derived title in the home repo', async () => {
    const { exec, calls } = fakeMintExec('https://github.com/geemeows/api/issues/42')
    const effort = await mintEffort(repo, 'Add a settings page\nwith theming', exec)

    const create = calls.find((c) => c.args[0] === 'issue' && c.args[1] === 'create')
    expect(create).toBeDefined()
    expect(create!.dir).toBe('/ws/api')
    expect(create!.args).toContain('--label')
    expect(create!.args).toContain('wayfinder:map')
    expect(create!.args).toContain('--title')
    expect(create!.args[create!.args.indexOf('--title') + 1]).toBe('Add a settings page')
  })

  it('returns an EffortSummary shaped like listEfforts, keyed off the created issue', async () => {
    const { exec } = fakeMintExec('https://github.com/geemeows/api/issues/42')
    const effort = await mintEffort(repo, 'Add a settings page', exec)

    expect(effort).toMatchObject({
      ref: {
        id: 'geemeows/api#42',
        display: 'geemeows/api#42',
        url: 'https://github.com/geemeows/api/issues/42',
      },
      title: 'Add a settings page',
      state: 'open',
      repo: { name: 'api', path: '/ws/api' },
    })
  })
})
