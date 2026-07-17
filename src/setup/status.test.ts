import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Workspace } from '../server/workspace.js'
import { computeSetupStatus, confirmedRepos } from './status.js'
import { REQUIRED_DOCS } from './docs.js'
import type { SkillsPaths } from './skills.js'

let dir: string

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

async function makeRoot(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'threadmap-status-'))
  return dir
}

async function makeRepo(root: string, name: string, opts: { docs?: boolean } = {}) {
  const path = join(root, name)
  await mkdir(join(path, '.git'), { recursive: true })
  if (opts.docs) {
    for (const doc of REQUIRED_DOCS) {
      await mkdir(join(path, doc.path, '..'), { recursive: true })
      await writeFile(join(path, doc.path), '# stub\n')
    }
  }
  return { name, path }
}

/** Skills paths pointing at a ready fake install (marker pin matches, no skills to link). */
async function readySkills(root: string): Promise<SkillsPaths> {
  const canonicalDir = join(root, 'agents-skills')
  await mkdir(canonicalDir, { recursive: true })
  const markerPath = join(root, 'skills.json')
  const { SKILLS_PIN } = await import('./skills.js')
  await writeFile(markerPath, JSON.stringify({ pin: SKILLS_PIN }))
  return { canonicalDir, agentDirs: {}, markerPath }
}

const ghOk = async () => 'ok'
const ghFail = async () => {
  throw new Error('You are not logged into any GitHub hosts')
}

describe('computeSetupStatus', () => {
  it('reports unconfigured with amber checks on a fresh workspace', async () => {
    const root = await makeRoot()
    const repo = await makeRepo(root, 'api')
    const workspace: Workspace = { root, repos: [repo] }
    const status = await computeSetupStatus(workspace, null, {
      exec: ghFail,
      skillsPaths: { canonicalDir: join(root, 'none'), agentDirs: {}, markerPath: join(root, 'none.json') },
    })
    expect(status.configured).toBe(false)
    expect(status.tracker).toBeNull()
    expect(status.auth.ok).toBe(false)
    expect(status.auth.detail).toContain('gh auth login')
    expect(status.skills.ok).toBe(false)
    expect(status.ready).toBe(false)
  })

  it('is ready when auth + skills pass and one repo has all docs', async () => {
    const root = await makeRoot()
    const ready = await makeRepo(root, 'api', { docs: true })
    const bare = await makeRepo(root, 'web')
    const workspace: Workspace = { root, repos: [ready, bare] }
    const status = await computeSetupStatus(workspace, { tracker: 'github' }, {
      exec: ghOk,
      skillsPaths: await readySkills(root),
    })
    expect(status.auth.ok).toBe(true)
    expect(status.skills.ok).toBe(true)
    expect(status.repos.find((r) => r.name === 'api')?.ready).toBe(true)
    expect(status.repos.find((r) => r.name === 'web')?.ready).toBe(false)
    expect(status.ready).toBe(true)
  })

  it('requires a team mapping per repo when the tracker is linear', async () => {
    const root = await makeRoot()
    const repo = await makeRepo(root, 'api', { docs: true })
    const workspace: Workspace = { root, repos: [repo] }
    const base = {
      skillsPaths: await readySkills(root),
      checkLinearAuth: async () => ({ ok: true, detail: 'valid' }),
    }
    const unmapped = await computeSetupStatus(workspace, { tracker: 'linear' }, base)
    expect(unmapped.repos[0]?.ready).toBe(false)
    const mapped = await computeSetupStatus(
      workspace,
      { tracker: 'linear', linear: { repoTeams: { api: 'team-1' } } },
      base,
    )
    expect(mapped.repos[0]?.ready).toBe(true)
    expect(mapped.repos[0]?.teamId).toBe('team-1')
  })

  it('honors the confirm list over discovery', async () => {
    const root = await makeRoot()
    const a = await makeRepo(root, 'api')
    const b = await makeRepo(root, 'web')
    const workspace: Workspace = { root, repos: [a, b] }
    expect(confirmedRepos(workspace, null).map((r) => r.name)).toEqual(['api', 'web'])
    expect(confirmedRepos(workspace, { tracker: 'github', repos: ['web'] }).map((r) => r.name)).toEqual(['web'])
  })

  it('locks the tracker when efforts exist', async () => {
    const root = await makeRoot()
    const repo = await makeRepo(root, 'api')
    const workspace: Workspace = { root, repos: [repo] }
    const status = await computeSetupStatus(workspace, { tracker: 'github' }, {
      exec: ghOk,
      skillsPaths: await readySkills(root),
      effortsExist: async () => true,
    })
    expect(status.trackerLocked).toBe(true)
  })
})
