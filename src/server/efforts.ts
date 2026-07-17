// Effort enumeration — derived from the tracker, never stored (ADR-0001).
// An Effort IS its map issue (CONTEXT.md), so enumerating efforts means
// listing `wayfinder:map`-labelled issues across the workspace's repos via gh.
// The full TrackerAdapter (#21) will absorb this read; the ref shape it mints
// (`owner/repo#n`) is already the seam's GitHub spelling (#19).

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { TicketRef } from '../tracker/types.js'
import type { GhExec } from '../gating/index.js'
import type { RepoInfo } from './workspace.js'

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
