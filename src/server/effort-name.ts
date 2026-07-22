// Pure, node-free leaf so both the server (mint title) and the UI (read-only
// preview) can import the same derivation without dragging node built-ins into
// the browser bundle. Keep this file dependency-free.

const TITLE_CAP = 60

/**
 * The provisional map title derived from a New-effort idea (decision #100):
 * the first non-empty line, trimmed, capped at ~60 chars with an ellipsis.
 * Shared by the modal's read-only preview and the mint title so they can't
 * drift; the agent may rename the map in-session.
 */
export function provisionalName(idea: string): string {
  const firstLine = idea.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  if (firstLine.length <= TITLE_CAP) return firstLine
  return `${firstLine.slice(0, TITLE_CAP - 1)}…`
}
