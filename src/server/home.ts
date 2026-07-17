// ~/.threadline holds only ephemeral session data — processes, logs,
// transcripts — plus a small effort registry. The tracker stays the database
// (ADR-0001); nothing here is ever authoritative pipeline state.

import { homedir } from 'node:os'
import { join } from 'node:path'

export function threadlineHome(): string {
  return process.env.THREADLINE_HOME ?? join(homedir(), '.threadline')
}

export function transcriptsDir(home = threadlineHome()): string {
  return join(home, 'transcripts')
}
