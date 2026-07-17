import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LinearClient } from '../tracker/linear-client.js'
import {
  VOCABULARY_LABELS,
  createTeam,
  provisionLinear,
  storeLinearKey,
  validateLinearKey,
} from './linear.js'

let dir: string

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

/** LinearClient over a scripted fetch — records every GraphQL query. */
function fakeLinear(respond: (query: string, variables?: Record<string, unknown>) => unknown) {
  const queries: { query: string; variables?: Record<string, unknown> }[] = []
  const fetchImpl = (async (_url: unknown, init?: { body?: string }) => {
    const { query, variables } = JSON.parse(init?.body ?? '{}') as {
      query: string
      variables?: Record<string, unknown>
    }
    queries.push({ query, variables })
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: respond(query, variables) }),
    }
  }) as unknown as typeof fetch
  return { queries, client: new LinearClient({ apiKey: 'k', fetchImpl }) }
}

describe('validateLinearKey', () => {
  it('returns org + viewer from the viewer query', async () => {
    const { client } = fakeLinear(() => ({
      viewer: { name: 'Mel' },
      organization: { id: 'org-1', name: 'Acme' },
    }))
    expect(await validateLinearKey(client)).toEqual({
      orgId: 'org-1',
      orgName: 'Acme',
      viewerName: 'Mel',
    })
  })
})

describe('storeLinearKey', () => {
  it('merges under linear.<orgId> and sets 0600', async () => {
    dir = await mkdtemp(join(tmpdir(), 'threadmap-creds-'))
    const path = join(dir, 'credentials.json')
    await writeFile(path, JSON.stringify({ linear: { 'org-0': { apiKey: 'old' } }, other: 1 }))
    await storeLinearKey('org-1', 'lin_api_new', path)
    const parsed = JSON.parse(await readFile(path, 'utf8')) as {
      linear: Record<string, { apiKey: string }>
      other: number
    }
    expect(parsed.linear['org-0']?.apiKey).toBe('old')
    expect(parsed.linear['org-1']?.apiKey).toBe('lin_api_new')
    expect(parsed.other).toBe(1)
    const mode = (await stat(path)).mode & 0o777
    expect(mode).toBe(0o600)
  })
})

describe('provisionLinear', () => {
  it('creates missing vocabulary labels and disables auto-close per team', async () => {
    const created: string[] = []
    const updatedTeams: { id: string; input: Record<string, unknown> }[] = []
    const { client } = fakeLinear((query, variables) => {
      if (query.includes('issueLabels(filter')) {
        // pretend the map label already exists, everything else is missing
        const name = (variables as { name: string }).name
        return { issueLabels: { nodes: name === 'wayfinder:map' ? [{ id: 'l1' }] : [] } }
      }
      if (query.includes('issueLabelCreate')) {
        created.push(((variables as { input: { name: string } }).input).name)
        return { issueLabelCreate: { issueLabel: { id: 'new' } } }
      }
      if (query.includes('teamUpdate')) {
        const v = variables as { id: string; input: Record<string, unknown> }
        updatedTeams.push({ id: v.id, input: v.input })
        return { teamUpdate: { success: true } }
      }
      throw new Error(`unexpected query: ${query}`)
    })

    await provisionLinear(client, ['team-1', 'team-2'])
    expect(created).toEqual(VOCABULARY_LABELS.filter((l) => l !== 'wayfinder:map'))
    expect(updatedTeams).toEqual([
      { id: 'team-1', input: { autoCloseParentIssues: false, autoCloseChildIssues: false } },
      { id: 'team-2', input: { autoCloseParentIssues: false, autoCloseChildIssues: false } },
    ])
  })
})

describe('createTeam', () => {
  it('issues teamCreate and returns the team', async () => {
    const { client, queries } = fakeLinear(() => ({
      teamCreate: { team: { id: 't1', key: 'API', name: 'API' } },
    }))
    const team = await createTeam(client, 'API')
    expect(team.id).toBe('t1')
    expect(queries[0]?.query).toContain('teamCreate')
  })
})
