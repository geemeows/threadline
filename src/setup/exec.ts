// One injectable exec shape for every external command the setup module runs
// (gh, git, npx). Throws on non-zero exit with stderr in the message so
// check functions can surface the real failure text in the readiness panel.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export type Exec = (cmd: string, args: string[], cwd?: string) => Promise<string>

const execFileAsync = promisify(execFile)

export const defaultExec: Exec = async (cmd, args, cwd) => {
  const { stdout } = await execFileAsync(cmd, args, {
    ...(cwd ? { cwd } : {}),
    maxBuffer: 10 * 1024 * 1024,
  })
  return stdout
}
