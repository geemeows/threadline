// gh-backed PRSource. PR linkage rides the branch-naming convention and the
// `gh` CLI's auth, regardless of which tracker the workspace uses (#19 §6).

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PRInfo, PRSource } from './types.js'

const execFileAsync = promisify(execFile)

/** Injectable for tests: runs `gh` in a repo dir, resolves stdout. */
export type GhExec = (args: string[], repoDir: string) => Promise<string>

const defaultExec: GhExec = async (args, repoDir) => {
  const { stdout } = await execFileAsync('gh', args, { cwd: repoDir, maxBuffer: 10 * 1024 * 1024 })
  return stdout
}

interface GhPr {
  number: number
  url: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
}

export class GhPrSource implements PRSource {
  constructor(private exec: GhExec = defaultExec) {}

  async ticketPR(repoDir: string, branch: string, trunk: string): Promise<PRInfo | null> {
    const out = await this.exec(
      ['pr', 'list', '--head', branch, '--base', trunk, '--state', 'all', '--json', 'number,url,state', '--limit', '20'],
      repoDir,
    )
    const pr = pickPR(JSON.parse(out) as GhPr[])
    if (!pr) return null
    const state = pr.state === 'MERGED' ? 'merged' : pr.state === 'OPEN' ? 'open' : 'closed'
    // Closed-unmerged PRs are abandoned — thread state is irrelevant.
    const unresolved = state === 'closed' ? 0 : await this.unresolvedThreads(repoDir, pr.number)
    return { url: pr.url, state, unresolvedReviewThreads: unresolved }
  }

  private async unresolvedThreads(repoDir: string, prNumber: number): Promise<number> {
    const query =
      'query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}}'
    const out = await this.exec(
      ['api', 'graphql', '-F', 'owner={owner}', '-F', 'repo={repo}', '-F', `number=${prNumber}`, '-f', `query=${query}`],
      repoDir,
    )
    return countUnresolved(JSON.parse(out))
  }
}

/** One PR per ticket is the convention; if several exist, live beats merged beats abandoned. */
export function pickPR(prs: GhPr[]): GhPr | undefined {
  return (
    prs.find((p) => p.state === 'OPEN') ??
    prs.find((p) => p.state === 'MERGED') ??
    prs[0]
  )
}

export function countUnresolved(graphql: unknown): number {
  const nodes = (graphql as { data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: { isResolved: boolean }[] } } } } })
    .data?.repository?.pullRequest?.reviewThreads?.nodes
  return nodes?.filter((n) => !n.isResolved).length ?? 0
}
