// Workspace discovery (CONTEXT.md): the Workspace is the directory threadmap
// runs in; its Repos are auto-discovered — direct child directories containing
// a git clone, plus the root itself when it is one (the single-repo case).

import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

export interface RepoInfo {
  /** Directory name — the workspace-local handle for the repo. */
  name: string
  /** Absolute path; sessions run with cwd = this. */
  path: string
}

export interface Workspace {
  root: string
  repos: RepoInfo[]
}

export async function discoverWorkspace(root: string): Promise<Workspace> {
  const repos: RepoInfo[] = []

  if (await isGitClone(root)) {
    repos.push({ name: basename(root), path: root })
  }

  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const path = join(root, entry.name)
    if (await isGitClone(path)) repos.push({ name: entry.name, path })
  }

  repos.sort((a, b) => a.name.localeCompare(b.name))
  return { root, repos }
}

/** `.git` may be a directory (clone) or a file (worktree/submodule) — both count. */
async function isGitClone(dir: string): Promise<boolean> {
  return stat(join(dir, '.git')).then(
    () => true,
    () => false,
  )
}
