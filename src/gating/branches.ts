// Branch-naming convention (#11, #19 §6) — the only ticket↔PR linkage that
// works for every tracker, since Linear refs never appear in GitHub PR data.

import type { TicketRef } from '../tracker/types.js'

/** `owner/repo#42` → `owner-repo-42`; Linear UUIDs pass through lowercased. */
export function refSlug(ref: TicketRef): string {
  return ref.id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Ticket implement sessions branch as `tl/<ticket-ref-slug>`. */
export function ticketBranch(ref: TicketRef): string {
  return `tl/${refSlug(ref)}`
}

/**
 * Per-repo effort trunk `tl/effort/<map-number>` (#11). Falls back to the full
 * ref slug when the display carries no trailing issue number (Linear maps).
 */
export function trunkBranch(effort: TicketRef): string {
  const number = /#(\d+)$/.exec(effort.display)?.[1]
  return `tl/effort/${number ?? refSlug(effort)}`
}
