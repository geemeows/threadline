// Tracker adapter seam, locked in issue #19 (grilling: TrackerAdapter seam).
// Reads are question-shaped (the gate questions themselves), writes are the
// pipeline's intent verbs. Tracker differences — db-id lookups, stateId
// resolution, label spelling, mutation-rate pacing — live inside adapters and
// never leak above the seam.

export interface TrackerAdapter {
  readonly name: string
  readonly capabilities: TrackerCapabilities

  // reads — the gate questions
  /** Open children of the effort, optionally filtered by label namespace ('wayfinder' | 'ticket'). */
  openChildren(effort: TicketRef, labelNs?: LabelNamespace): Promise<TicketRef[]>
  /**
   * All children (open and closed) with their state. The implement and
   * code-review gates quantify over *every* ticket, closed ones included —
   * openChildren alone cannot answer them. (Interface refinement of #19,
   * surfaced while building the gating engine in #14.)
   */
  children(effort: TicketRef, labelNs?: LabelNamespace): Promise<ChildTicket[]>
  /** Open ∧ unblocked ∧ unassigned children. */
  frontier(effort: TicketRef): Promise<TicketRef[]>
  /**
   * 'approved' means a human closed the spec child; 'auto-closed' means an
   * automation/integration did (Linear parent auto-close, PR-merge → Done) —
   * the to-spec gate holds on 'auto-closed' and the UI says why.
   */
  specStatus(effort: TicketRef): Promise<SpecStatus>
  /** Logical stamp names present on the map issue ('ticketed', 'override:<stage>', …). */
  mapStamps(effort: TicketRef): Promise<string[]>
  /**
   * Title + body of one ticket. Implement/reconcile session prompts embed the
   * ticket verbatim, so this is a content read, not a gate question.
   * (Interface refinement of #19, surfaced by the orchestration work in #30.)
   */
  ticketBody(ref: TicketRef): Promise<TicketBody>
  ticketTarget(ref: TicketRef): Promise<RoutingTarget>
  routingTargets(): Promise<RoutingTarget[]>

  // writes — the pipeline verbs
  createChild(parent: TicketRef, opts: CreateOpts): Promise<TicketRef>
  addBlockedBy(ref: TicketRef, blocker: TicketRef): Promise<void>
  comment(ref: TicketRef, markdown: string): Promise<void>
  stamp(ref: TicketRef, name: string): Promise<void>
  unstamp(ref: TicketRef, name: string): Promise<void>
  resolve(ref: TicketRef, outcome: 'done' | 'wontfix', comment?: string): Promise<void>
  /** Cosmetic write-back so tickets show their PR (Linear attachment / GitHub comment). */
  attachPR?(ref: TicketRef, prUrl: string): Promise<void>

  // change detection — adapter-minted opaque cursors (GitHub: ETag set,
  // Linear: updatedAt watermark); the engine's poll loop paces itself off
  // capabilities.
  changesSince(effort: TicketRef, cursor?: string): Promise<{ changed: boolean; cursor: string }>
}

/**
 * Opaque adapter-minted identity. GitHub mints `owner/repo#42` (stable),
 * Linear mints the issue UUID (`ENG-123` is display-only — it mutates on team
 * moves). Effort id = the ref of its map issue.
 */
export interface TicketRef {
  id: string
  display: string
  url: string
}

export interface TicketBody {
  title: string
  body: string
}

export interface ChildTicket {
  ref: TicketRef
  state: 'open' | 'closed'
}

export type LabelNamespace = 'wayfinder' | 'ticket'

export type SpecStatus = 'none' | 'open' | 'approved' | 'auto-closed'

/**
 * Opaque routing destination for new tickets (GitHub: repo; Linear: team).
 * Setup establishes a repoPath ↔ target map in workspace config; the engine
 * resolves targets to repos above the seam.
 */
export interface RoutingTarget {
  id: string
  display: string
}

export interface CreateOpts {
  title: string
  body: string
  target: RoutingTarget
  /** Logical label names — adapters own tracker-side spelling. */
  labels?: string[]
}

export interface TrackerCapabilities {
  /** github ~5s, linear ~30–60s. */
  minPollIntervalMs: number
  /** Conditional requests cost nothing (GitHub ETag 304s). */
  freePolling: boolean
}
