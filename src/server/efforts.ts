// Effort enumeration — derived from the tracker, never stored (ADR-0001).
// An Effort IS its map issue (CONTEXT.md), so enumerating efforts means
// listing `wayfinder:map`-labelled issues across the workspace's repos via gh.
// The full TrackerAdapter (#21) will absorb this read; the ref shape it mints
// (`owner/repo#n`) is already the seam's GitHub spelling (#19).

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { TicketRef } from '../tracker/types.js'
import type { GhExec } from '../gating/index.js'
import { provisionalName } from './effort-name.js'
import type { RepoInfo } from './workspace.js'

export { provisionalName } from './effort-name.js'

const execFileAsync = promisify(execFile)

export interface EffortSummary {
  ref: TicketRef
  title: string
  state: 'open' | 'closed'
  /** Home repo — the workspace repo whose tracker hosts the map issue. */
  repo: RepoInfo
}

interface GhIssue {
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED'
}

// Same injectable gh runner shape as the gating module, so tests fake one
// exec type everywhere.
const defaultExec: GhExec = async (args, repoDir) => {
  const { stdout } = await execFileAsync('gh', args, { cwd: repoDir, maxBuffer: 10 * 1024 * 1024 })
  return stdout
}

export async function listEfforts(
  repos: RepoInfo[],
  exec: GhExec = defaultExec,
  opts: { includeClosed?: boolean } = {},
): Promise<EffortSummary[]> {
  const perRepo = await Promise.all(
    repos.map(async (repo) => {
      try {
        const nameWithOwner = await repoNameWithOwner(repo, exec)
        const out = await exec(
          [
            'issue',
            'list',
            '--label',
            'wayfinder:map',
            '--state',
            opts.includeClosed ? 'all' : 'open',
            '--json',
            'number,title,url,state',
          ],
          repo.path,
        )
        return (JSON.parse(out) as GhIssue[]).map(
          (issue): EffortSummary => ({
            ref: {
              id: `${nameWithOwner}#${issue.number}`,
              display: `${nameWithOwner}#${issue.number}`,
              url: issue.url,
            },
            title: issue.title,
            state: issue.state === 'OPEN' ? 'open' : 'closed',
            repo,
          }),
        )
      } catch {
        return [] // repo without gh auth / GitHub remote contributes no efforts
      }
    }),
  )
  return perRepo.flat()
}

async function repoNameWithOwner(repo: RepoInfo, exec: GhExec): Promise<string> {
  const out = await exec(['repo', 'view', '--json', 'nameWithOwner'], repo.path)
  return (JSON.parse(out) as { nameWithOwner: string }).nameWithOwner
}

/**
 * Mint a brand-new effort: create a `wayfinder:map`-labelled issue in the home
 * repo, titled with the provisional name derived from the idea, and return its
 * EffortSummary (same ref shape as `listEfforts`). This is a top-level
 * effort-creation write — the map exists *before* any session, which is what
 * lets a bound planning session derive `stage=planning` (#98). It is distinct
 * from the in-session, child-only, stage-gated `create_issue` tracker tool, so
 * `assertCreatable` is not involved. The map is seeded with a provisional title
 * only; the bound planning session charts Destination/Notes in-session (#110).
 */
export async function mintEffort(
  repo: RepoInfo,
  idea: string,
  exec: GhExec = defaultExec,
): Promise<EffortSummary> {
  const title = provisionalName(idea)
  const nameWithOwner = await repoNameWithOwner(repo, exec)
  const out = await exec(
    ['issue', 'create', '--title', title, '--label', 'wayfinder:map', '--body', ''],
    repo.path,
  )
  // `gh issue create` prints the new issue's URL (last non-empty line).
  const url = out.trim().split('\n').pop()?.trim() ?? ''
  const number = Number(url.match(/\/(\d+)\s*$/)?.[1])
  const ref = `${nameWithOwner}#${number}`
  return {
    ref: { id: ref, display: ref, url },
    title,
    state: 'open',
    repo,
  }
}
