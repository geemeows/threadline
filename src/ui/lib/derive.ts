// Selectors over the store's state — pure, component-free.

import type { SessionView, State } from './store.js'
import { sessionStatus } from './transcript.js'
import type { EffortSummary, SessionStatus } from './types.js'

export interface SessionRowView {
  view: SessionView
  status: SessionStatus
}

export function statusOf(view: SessionView): SessionStatus {
  return sessionStatus(view.meta, view.events)
}

/** Sessions for one effort (ref id), newest first. */
export function effortSessions(state: State, effortId: string): SessionRowView[] {
  return Object.values(state.sessions)
    .filter((v) => v.meta.effort === effortId)
    .sort((a, b) => a.meta.createdAt.localeCompare(b.meta.createdAt))
    .map((view) => ({ view, status: statusOf(view) }))
}

/** Sessions not tied to any effort (setup / ad-hoc). */
export function adhocSessions(state: State): SessionRowView[] {
  return Object.values(state.sessions)
    .filter((v) => !v.meta.effort)
    .sort((a, b) => a.meta.createdAt.localeCompare(b.meta.createdAt))
    .map((view) => ({ view, status: statusOf(view) }))
}

/** The Needs-you queue: every session blocked on the human, workspace-wide. */
export function needsYou(state: State): SessionRowView[] {
  return Object.values(state.sessions)
    .map((view) => ({ view, status: statusOf(view) }))
    .filter(({ status }) => status === 'needs-approval' || status === 'waiting-human')
    .sort((a, b) => (a.status === 'needs-approval' ? -1 : 1) - (b.status === 'needs-approval' ? -1 : 1))
}

/** An effort's aggregate status — the dot on its left-pane row. The pipeline
 *  stage is a per-effort snapshot fetched only for the selected effort (#30),
 *  too costly to pull for every row, so the row reads status from the effort's
 *  own sessions instead: running wins, then a human-blocked session, else idle.
 *  A closed effort reads as done regardless of stragglers. */
export type EffortStatus = SessionStatus | 'idle'

export function effortStatus(state: State, effort: EffortSummary): EffortStatus {
  if (effort.state === 'closed') return 'done'
  const rows = effortSessions(state, effort.ref.id)
  if (rows.some((r) => r.status === 'running')) return 'running'
  if (rows.some((r) => r.status === 'needs-approval' || r.status === 'waiting-human')) return 'needs-approval'
  return 'idle'
}

export function costUsd(views: SessionView[]): number {
  return views.reduce((sum, v) => sum + (v.meta.usage?.costUsd ?? 0), 0)
}

export function workspaceCost(state: State): number {
  return costUsd(Object.values(state.sessions))
}

export function effortCost(state: State, effortId: string): number {
  return costUsd(Object.values(state.sessions).filter((v) => v.meta.effort === effortId))
}

export function fmtTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

/** Short tab/session label: stage when known, else the prompt's first words. */
export function sessionLabel(view: SessionView): string {
  const { stage, prompt } = view.meta
  const words = prompt.trim().split(/\s+/).slice(0, 4).join(' ')
  const short = words.length > 32 ? `${words.slice(0, 32)}…` : words
  return stage ? `${stage} · ${short}` : short
}
