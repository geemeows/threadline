// Branch-naming convention `tm/<type>/<ticket-id>-<context>` (#26, amending
// #11/#19 §6) — the only ticket↔PR linkage that works for every tracker, since
// Linear refs never appear in GitHub PR data. Sessions mint the exact branch
// name (type is session-inferred, context frozen from the ticket title), so
// tooling never recomputes it — it matches by the stable `<ticket-id>` instead.

import type { TicketRef } from '../tracker/types.js'

/** `owner/repo#42` → `owner-repo-42`; Linear UUIDs pass through lowercased. */
export function refSlug(ref: TicketRef): string {
  return ref.id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** The bare issue number for GitHub refs (`owner/repo#42` → 42), null for Linear. */
export function githubIssueNumber(ref: TicketRef): number | null {
  const match = /#(\d+)$/.exec(ref.id)
  return match ? Number(match[1]) : null
}

/**
 * The stable `<ticket-id>` segment of a ticket branch: GitHub's bare issue
 * number (unambiguous within the owning repo) or Linear's display key
 * (`FE-123`, which also triggers Linear's branch auto-attach).
 */
export function ticketIdToken(ref: TicketRef): string {
  return githubIssueNumber(ref)?.toString() ?? ref.display
}

/**
 * Anchored, case-insensitive matcher for the ticket's branches:
 * `^tm/<type>/<id>` followed by `-<context>` or end-of-name. The `(-|$)`
 * boundary keeps ticket 123 from matching branch `tm/feat/1234-...`.
 */
export function ticketBranchPattern(ref: TicketRef): RegExp {
  const id = ticketIdToken(ref).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^tm/[^/]+/${id}(-|$)`, 'i')
}

/**
 * Per-repo effort trunk `tm/effort/<map-number>` (#11, renamed by #26). Falls
 * back to the full ref slug when the display carries no trailing issue number
 * (Linear maps).
 */
export function trunkBranch(effort: TicketRef): string {
  const number = /#(\d+)$/.exec(effort.display)?.[1]
  return `tm/effort/${number ?? refSlug(effort)}`
}
