import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LinearClient } from '../tracker/linear-client.js'
import { readConfig, writeConfig } from '../setup/index.js'
import { createSetupApp, type SetupRouteDeps } from './setup-routes.js'
import type { Workspace } from './workspace.js'

let dir: string

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

async function makeWorkspace(): Promise<Workspace> {
  dir = await mkdtemp(join(tmpdir(), 'threadmap-routes-'))
  await mkdir(join(dir, 'api', '.git'), { recursive: true })
  return { root: dir, repos: [{ name: 'api', path: join(dir, 'api') }] }
}

function makeApp(workspace: Workspace, overrides: Partial<SetupRouteDeps> = {}) {
  return createSetupApp({
    workspace,
    exec: async () => 'ok',
    skillsPaths: {
      canonicalDir: join(workspace.root, 'no-skills'),
      agentDirs: {},
      markerPath: join(workspace.root, 'no-marker.json'),
    },
    effortsExist: async () => false,
    credentialsPath: join(workspace.root, 'credentials.json'),
    ...overrides,
  })
}

const json = (body: unknown) => ({
  method: 'PUT' as string,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

describe('setup routes', () => {
  it('GET /status reflects config on disk', async () => {
    const workspace = await makeWorkspace()
    const app = makeApp(workspace)
    const before = (await (await app.request('/status')).json()) as { configured: boolean }
    expect(before.configured).toBe(false)
    await writeConfig(workspace.root, { tracker: 'github', repos: ['api'] })
    const after = (await (await app.request('/status')).json()) as {
      configured: boolean
      tracker: string
      repos: { name: string }[]
    }
    expect(after.configured).toBe(true)
    expect(after.tracker).toBe('github')
    expect(after.repos.map((r) => r.name)).toEqual(['api'])
  })

  it('PUT /config merges patches and persists', async () => {
    const workspace = await makeWorkspace()
    const app = makeApp(workspace)
    await app.request('/config', json({ tracker: 'linear', repos: ['api'] }))
    await app.request('/config', json({ linear: { repoTeams: { api: 'team-1' } } }))
    const config = await readConfig(workspace.root)
    expect(config).toEqual({
      tracker: 'linear',
      repos: ['api'],
      linear: { repoTeams: { api: 'team-1' } },
    })
  })

  it('PUT /config rejects a tracker flip once efforts exist (#7 §9)', async () => {
    const workspace = await makeWorkspace()
    await writeConfig(workspace.root, { tracker: 'github' })
    const app = makeApp(workspace, { effortsExist: async () => true })
    const res = await app.request('/config', json({ tracker: 'linear' }))
    expect(res.status).toBe(409)
    expect((await readConfig(workspace.root))?.tracker).toBe('github')
    // non-tracker patches still land
    const ok = await app.request('/config', json({ repos: ['api'] }))
    expect(ok.status).toBe(200)
  })

  it('POST /linear/key validates, stores, and records the org id', async () => {
    const workspace = await makeWorkspace()
    await writeConfig(workspace.root, { tracker: 'linear' })
    const app = makeApp(workspace)
    // The route builds its own client from the pasted key — stub global fetch.
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: { viewer: { name: 'Mel' }, organization: { id: 'org-1', name: 'Acme' } },
      }),
    })) as unknown as typeof fetch
    try {
      const res = await app.request('/linear/key', { ...json({ apiKey: 'lin_api_x' }), method: 'POST' })
      expect(res.status).toBe(200)
      expect(((await res.json()) as { orgId: string }).orgId).toBe('org-1')
    } finally {
      globalThis.fetch = realFetch
    }
    expect((await readConfig(workspace.root))?.linear?.orgId).toBe('org-1')
  })

  it('POST /docs/apply stamps templates into the picked repo', async () => {
    const workspace = await makeWorkspace()
    await writeConfig(workspace.root, { tracker: 'github', repos: ['api'] })
    const app = makeApp(workspace)
    const plan = (await (await app.request('/docs/plan?repo=api')).json()) as { path: string }[]
    expect(plan.map((e) => e.path)).toContain('docs/agents/issue-tracker.md')
    const res = await app.request('/docs/apply', {
      ...json({ repo: 'api', files: ['docs/agents/issue-tracker.md'] }),
      method: 'POST',
    })
    expect(((await res.json()) as { mode: string }).mode).toBe('committed')
  })

  it('unknown repo on docs endpoints is a 404', async () => {
    const workspace = await makeWorkspace()
    const app = makeApp(workspace)
    expect((await app.request('/docs/plan?repo=nope')).status).toBe(404)
  })

  it('POST /github/provision stamps the vocabulary into every confirmed repo (#43)', async () => {
    const workspace = await makeWorkspace()
    await writeConfig(workspace.root, { tracker: 'github', repos: ['api'] })
    const calls: { args: string[]; cwd?: string }[] = []
    const app = makeApp(workspace, {
      exec: async (_cmd, args, cwd) => {
        calls.push({ args, cwd })
        return ''
      },
    })
    const res = await app.request('/github/provision', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { repos: { name: string; ok: boolean }[] }
    expect(body.repos).toEqual([{ name: 'api', ok: true, detail: expect.stringContaining('labels') }])
    const labelCalls = calls.filter((c) => c.args[0] === 'label')
    expect(labelCalls.length).toBeGreaterThan(0)
    expect(labelCalls.every((c) => c.cwd === join(workspace.root, 'api'))).toBe(true)
  })

  it('POST /github/provision with no confirmed repos is a 400', async () => {
    dir = await mkdtemp(join(tmpdir(), 'threadmap-routes-'))
    const workspace: Workspace = { root: dir, repos: [] }
    const app = makeApp(workspace)
    expect((await app.request('/github/provision', { method: 'POST' })).status).toBe(400)
  })

  it('GET /linear/teams uses the injected client', async () => {
    const workspace = await makeWorkspace()
    await writeConfig(workspace.root, { tracker: 'linear' })
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { teams: { nodes: [{ id: 't1', key: 'API', name: 'API' }] } } }),
    })) as unknown as typeof fetch
    const app = makeApp(workspace, {
      linearClient: async () => new LinearClient({ apiKey: 'k', fetchImpl }),
    })
    const teams = (await (await app.request('/linear/teams')).json()) as { id: string }[]
    expect(teams).toEqual([{ id: 't1', key: 'API', name: 'API' }])
  })
})
