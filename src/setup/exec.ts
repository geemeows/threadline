// One injectable exec shape for every external command the setup module runs
// (gh, git, npx). Throws on non-zero exit with stderr in the message so
// check functions can surface the real failure text in the readiness panel.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export type Exec = (cmd: string, args: string[], cwd?: string) => Promise<string>

const execFileAsync = promisify(execFile)

// A command must not hang the caller forever. `npx skills add` in particular
// can stall on a slow registry or an interactive prompt with no TTY; without a
// bound the setup route never responds and the wizard sits on "Installing…"
// with no error and no escalation. On timeout the child is killed and the
// rejection flows up as a normal failure, so the UI surfaces it.
const EXEC_TIMEOUT_MS = 120_000

export const defaultExec: Exec = async (cmd, args, cwd) => {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      ...(cwd ? { cwd } : {}),
      maxBuffer: 10 * 1024 * 1024,
      timeout: EXEC_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    })
    return stdout
  } catch (err) {
    // execFile flags a timeout kill as `killed` with no exit code — rewrite it
    // into a legible message instead of the opaque default.
    if (err && typeof err === 'object' && 'killed' in err && (err as { killed?: boolean }).killed) {
      throw new Error(`\`${cmd} ${args.join(' ')}\` timed out after ${EXEC_TIMEOUT_MS / 1000}s`)
    }
    throw err
  }
}
