// The readiness snapshot the wizard/panel renders (#7 §2): every check is
// pure observation — config on disk, gh auth, credentials + viewer, skills
// marker/links, per-repo doc files. Fix actions live in their own modules;
// re-running setup is always check-then-fix against this snapshot (#7 §8).

import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Workspace } from '../server/workspace.js'
import { LinearClient, resolveLinearApiKey } from '../tracker/index.js'
import type { WorkspaceConfig } from './config.js'
import { REQUIRED_DOCS } from './docs.js'
import { defaultExec, type Exec } from './exec.js'
import { defaultSkillsPaths, skillsStatus, type SkillsPaths, type SkillsStatus } from './skills.js'
import { validateLinearKey } from './linear.js'

export interface CheckResult {
  ok: boolean
  detail: string
}

export interface RepoReadiness {
  name: string
  path: string
  /** Linear default team, when the tracker is Linear. */
  teamId: string | null
  docs: { path: string; source: 'template' | 'agent'; present: boolean }[]
  ready: boolean
}

export interface SetupStatus {
  configured: boolean
  tracker: 'github' | 'linear' | null
  /** Tracker choice is immutable once efforts exist (#7 §9). */
  trackerLocked: boolean
  auth: CheckResult
  skills: SkillsStatus
  repos: RepoReadiness[]
  /** Main UI unlocks at ≥1 ready repo with workspace-level checks green (#7 §10). */
  ready: boolean
}

export interface StatusDeps {
  exec?: Exec
  skillsPaths?: SkillsPaths
  /** Injectable for tests — real one resolves credentials + queries `viewer`. */
  checkLinearAuth?: (orgId?: string) => Promise<CheckResult>
  /** Injectable for tests — whether any effort exists yet (locks the tracker). */
  effortsExist?: () => Promise<boolean>
}

export async function computeSetupStatus(
  workspace: Workspace,
  config: WorkspaceConfig | null,
  deps: StatusDeps = {},
): Promise<SetupStatus> {
  const exec = deps.exec ?? defaultExec
  const tracker = config?.tracker ?? null

  const [auth, skills, repos, trackerLocked] = await Promise.all([
    tracker === 'linear'
      ? (deps.checkLinearAuth ?? defaultLinearAuth)(config?.linear?.orgId)
      : checkGhAuth(exec),
    skillsStatus(deps.skillsPaths ?? defaultSkillsPaths()),
    Promise.all(confirmedRepos(workspace, config).map((r) => repoReadiness(r, config))),
    config ? (deps.effortsExist ?? (() => Promise.resolve(false)))() : Promise.resolve(false),
  ])

  return {
    configured: config !== null,
    tracker,
    trackerLocked,
    auth,
    skills,
    repos,
    ready: config !== null && auth.ok && skills.ok && repos.some((r) => r.ready),
  }
}

/** Discovery proposes every clone; the config's confirm list wins once written (#7 §1). */
export function confirmedRepos(
  workspace: Workspace,
  config: WorkspaceConfig | null,
): { name: string; path: string }[] {
  if (!config?.repos) return workspace.repos
  return config.repos.map((name) => {
    const known = workspace.repos.find((r) => r.name === name)
    return known ?? { name, path: join(workspace.root, name) }
  })
}

async function repoReadiness(
  repo: { name: string; path: string },
  config: WorkspaceConfig | null,
): Promise<RepoReadiness> {
  const docs = await Promise.all(
    REQUIRED_DOCS.map(async (doc) => ({
      path: doc.path,
      source: doc.source,
      present: await exists(join(repo.path, doc.path)),
    })),
  )
  const teamId = config?.tracker === 'linear' ? (config.linear?.repoTeams?.[repo.name] ?? null) : null
  const teamOk = config?.tracker !== 'linear' || teamId !== null
  return {
    name: repo.name,
    path: repo.path,
    teamId,
    docs,
    ready: teamOk && docs.every((d) => d.present),
  }
}

async function checkGhAuth(exec: Exec): Promise<CheckResult> {
  try {
    await exec('gh', ['auth', 'status'])
    return { ok: true, detail: 'gh authenticated' }
  } catch (err) {
    return {
      ok: false,
      detail: `gh not authenticated — run \`gh auth login\` in a terminal, then re-check. (${trimmed(err)})`,
    }
  }
}

async function defaultLinearAuth(orgId?: string): Promise<CheckResult> {
  try {
    const client = new LinearClient({ apiKey: await resolveLinearApiKey(orgId) })
    const info = await validateLinearKey(client)
    return { ok: true, detail: `Linear key valid — ${info.orgName} (${info.viewerName})` }
  } catch (err) {
    return { ok: false, detail: trimmed(err) }
  }
}

function trimmed(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.split('\n')[0] ?? message
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}
