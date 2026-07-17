import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { configPath, readConfig, writeConfig } from './config.js'

let dir: string

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

async function makeRoot(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'threadmap-setup-'))
  return dir
}

describe('workspace config', () => {
  it('returns null when no config exists', async () => {
    const root = await makeRoot()
    expect(await readConfig(root)).toBeNull()
  })

  it('round-trips tracker, repos, and linear mapping', async () => {
    const root = await makeRoot()
    await writeConfig(root, {
      tracker: 'linear',
      repos: ['api', 'web'],
      linear: { orgId: 'org-1', repoTeams: { api: 'team-1' } },
    })
    const config = await readConfig(root)
    expect(config).toEqual({
      tracker: 'linear',
      repos: ['api', 'web'],
      linear: { orgId: 'org-1', repoTeams: { api: 'team-1' } },
    })
    // #21's consumers read the same file — keep the on-disk spelling stable.
    const raw = JSON.parse(await readFile(configPath(root), 'utf8')) as { tracker: string }
    expect(raw.tracker).toBe('linear')
  })

  it('defaults an unknown tracker spelling to github', async () => {
    const root = await makeRoot()
    await writeConfig(root, { tracker: 'jira' as never })
    expect((await readConfig(root))?.tracker).toBe('github')
  })
})
