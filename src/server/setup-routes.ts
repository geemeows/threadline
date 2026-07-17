// REST surface for the setup wizard / readiness panel (#22). Every route is
// a thin binding over src/setup — checks stay pure observation, fixes are
// explicit POSTs the panel triggers. Doc-gen agent sessions are NOT here:
// the UI starts those over the normal WS channel like any other session.

import { Hono } from 'hono'
import {
  applyDocs,
  computeSetupStatus,
  confirmedRepos,
  createTeam,
  defaultSkillsPaths,
  installSkills,
  listTeams,
  planDocs,
  provisionGitHub,
  provisionLinear,
  readConfig,
  storeLinearKey,
  validateLinearKey,
  writeConfig,
  type Exec,
  type SkillsPaths,
  type StatusDeps,
  type WorkspaceConfig,
} from '../setup/index.js'
import { defaultExec } from '../setup/exec.js'
import { LinearClient, resolveLinearApiKey } from '../tracker/index.js'
import { listEfforts } from './efforts.js'
import type { Workspace } from './workspace.js'

export interface SetupRouteDeps {
  workspace: Workspace
  exec?: Exec
  skillsPaths?: SkillsPaths
  /** Injectable for tests; real one builds a client from stored credentials. */
  linearClient?: (orgId?: string) => Promise<LinearClient>
  /** Injectable for tests; used both by status and the tracker lock. */
  effortsExist?: () => Promise<boolean>
  statusDeps?: StatusDeps
  /** Injectable credentials file path for tests. */
  credentialsPath?: string
}

export function createSetupApp(deps: SetupRouteDeps): Hono {
  const { workspace } = deps
  const exec = deps.exec ?? defaultExec
  const skillsPaths = deps.skillsPaths ?? defaultSkillsPaths()
  const clientFor =
    deps.linearClient ??
    (async (orgId?: string) => new LinearClient({ apiKey: await resolveLinearApiKey(orgId) }))
  const effortsExist =
    deps.effortsExist ??
    (async () => {
      const config = await readConfig(workspace.root)
      const repos = confirmedRepos(workspace, config)
      // Efforts are wayfinder:map issues; even Linear workspaces keep code on
      // GitHub, but the map lives in the tracker — for Linear, query it there.
      if (config?.tracker === 'linear') {
        const client = await clientFor(config.linear?.orgId)
        const data = await client.query<{ issues: { nodes: { id: string }[] } }>(
          `query { issues(filter: { labels: { name: { eq: "wayfinder:map" } } }, first: 1) { nodes { id } } }`,
        )
        return data.issues.nodes.length > 0
      }
      const efforts = await listEfforts(repos, (args, cwd) => exec('gh', args, cwd), {
        includeClosed: true,
      })
      return efforts.length > 0
    })

  const app = new Hono()

  app.get('/status', async (c) => {
    const config = await readConfig(workspace.root)
    const status = await computeSetupStatus(workspace, config, {
      exec,
      skillsPaths,
      effortsExist: () => effortsExist().catch(() => false),
      ...deps.statusDeps,
    })
    return c.json(status)
  })

  // Config writes: repos confirm list, tracker choice, team mapping. Tracker
  // flips are rejected once any effort exists (#7 §9).
  app.put('/config', async (c) => {
    const patch = (await c.req.json()) as Partial<WorkspaceConfig>
    const existing = await readConfig(workspace.root)
    if (
      existing &&
      patch.tracker &&
      patch.tracker !== existing.tracker &&
      (await effortsExist().catch(() => false))
    ) {
      return c.json(
        { error: 'tracker is locked: efforts exist — create a new workspace to switch' },
        409,
      )
    }
    const merged: WorkspaceConfig = {
      tracker: patch.tracker ?? existing?.tracker ?? 'github',
      ...((patch.repos ?? existing?.repos) ? { repos: patch.repos ?? existing?.repos } : {}),
      ...((patch.linear ?? existing?.linear)
        ? { linear: { ...existing?.linear, ...patch.linear } }
        : {}),
    }
    await writeConfig(workspace.root, merged)
    return c.json(merged)
  })

  // Paste-a-key auth (#7 §3): validate against viewer, store 0600, remember org.
  app.post('/linear/key', async (c) => {
    const { apiKey } = (await c.req.json()) as { apiKey?: string }
    if (!apiKey?.trim()) return c.json({ error: 'missing apiKey' }, 400)
    try {
      const info = await validateLinearKey(new LinearClient({ apiKey: apiKey.trim() }))
      await storeLinearKey(info.orgId, apiKey.trim(), deps.credentialsPath)
      const existing = await readConfig(workspace.root)
      if (existing?.tracker === 'linear') {
        await writeConfig(workspace.root, {
          ...existing,
          linear: { ...existing.linear, orgId: info.orgId },
        })
      }
      return c.json(info)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  app.get('/linear/teams', async (c) => {
    try {
      const config = await readConfig(workspace.root)
      return c.json(await listTeams(await clientFor(config?.linear?.orgId)))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502)
    }
  })

  app.post('/linear/teams', async (c) => {
    const { name, key } = (await c.req.json()) as { name?: string; key?: string }
    if (!name?.trim()) return c.json({ error: 'missing name' }, 400)
    try {
      const config = await readConfig(workspace.root)
      return c.json(await createTeam(await clientFor(config?.linear?.orgId), name.trim(), key))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502)
    }
  })

  // Vocabulary labels + auto-close automations off (#20/#21) — the approval
  // gate's trust in completed ⇒ approved rests on this having run.
  app.post('/linear/provision', async (c) => {
    const { teamIds } = (await c.req.json()) as { teamIds?: string[] }
    if (!teamIds?.length) return c.json({ error: 'missing teamIds' }, 400)
    try {
      const config = await readConfig(workspace.root)
      await provisionLinear(await clientFor(config?.linear?.orgId), teamIds)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502)
    }
  })

  // Vocabulary labels stamped into every confirmed repo (#43) — symmetric
  // with /linear/provision; idempotent via `gh label create --force`.
  app.post('/github/provision', async (c) => {
    const config = await readConfig(workspace.root)
    const repos = confirmedRepos(workspace, config)
    if (repos.length === 0) return c.json({ error: 'no confirmed repos' }, 400)
    // Always 200 — per-repo failures ride the results' ok/detail, so the
    // panel can show exactly which repos still need provisioning.
    return c.json({ repos: await provisionGitHub(repos, exec) })
  })

  app.post('/skills/install', async (c) => {
    try {
      return c.json(await installSkills(skillsPaths, exec))
    } catch (err) {
      // Plain code failed — the UI offers the "let an agent fix it" escalation (#7 §5).
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502)
    }
  })

  app.get('/docs/plan', async (c) => {
    const repoName = c.req.query('repo')
    const config = await readConfig(workspace.root)
    const repo = confirmedRepos(workspace, config).find((r) => r.name === repoName)
    if (!repo) return c.json({ error: `unknown repo: ${repoName}` }, 404)
    return c.json(await planDocs(config?.tracker ?? 'github', repo.path))
  })

  app.post('/docs/apply', async (c) => {
    const { repo: repoName, files } = (await c.req.json()) as { repo?: string; files?: string[] }
    const config = await readConfig(workspace.root)
    const repo = confirmedRepos(workspace, config).find((r) => r.name === repoName)
    if (!repo) return c.json({ error: `unknown repo: ${repoName}` }, 404)
    if (!files?.length) return c.json({ error: 'missing files' }, 400)
    try {
      return c.json(await applyDocs(repo.path, config?.tracker ?? 'github', files, exec))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502)
    }
  })

  return app
}
