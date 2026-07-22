// Type-only bridges to the server — one package (#9), so the UI compiles
// against the real wire shapes instead of hand-mirrored copies.

export type { PermissionDecision, PermissionMode, SessionOutcome, Usage } from '../../adapters/types.js'
export type { StageSnapshot, Stage, TicketView } from '../../gating/types.js'
export type { CompleteResult, LandResult } from '../../pipeline/orchestrator.js'
export type { EffortSummary } from '../../server/efforts.js'
export type { StartSessionOptions } from '../../server/registry.js'
export type { SessionMeta, TranscriptEvent } from '../../server/transcripts.js'
export type { ClientMessage, ServerMessage } from '../../server/ws.js'
export type { RepoInfo, Workspace } from '../../server/workspace.js'
export type { WorkspaceConfig } from '../../setup/config.js'
export type { GitHubProvisionResult } from '../../setup/github.js'
export type { LinearOrgInfo, LinearTeam } from '../../setup/linear.js'
export type { ApplyResult, DocPlanEntry } from '../../setup/docs.js'
export type { RepoReadiness, SetupStatus } from '../../setup/status.js'

/** Pipeline rail vocabulary: Setup is repo readiness (#6), then the five gated
 *  stages. Labels use the Threadline Workspace design's sentence casing (#80). */
export const RAIL_STAGES = [
  { key: 'setup', label: 'Setup' },
  { key: 'planning', label: 'Planning' },
  { key: 'to-spec', label: 'To spec' },
  { key: 'to-tickets', label: 'To tickets' },
  { key: 'implement', label: 'Implement' },
  { key: 'code-review', label: 'Code review' },
] as const

/** The five gated stages shown in the pipeline rail (#80). Setup is not a rail
 *  stage in the mint design — repo readiness lives in the onboarding wizard and
 *  the top-bar readiness gear — so the stepper renders these five only. */
export const PIPELINE_STAGES = RAIL_STAGES.filter((s) => s.key !== 'setup')

export type SessionStatus = 'running' | 'needs-approval' | 'waiting-human' | 'done'

export const STATUS_META: Record<SessionStatus, { dot: string; label: string; pill: string }> = {
  running: { dot: 'running', label: 'Active', pill: 'mint' },
  'needs-approval': { dot: 'approval', label: 'Needs you', pill: 'amber' },
  'waiting-human': { dot: 'human', label: 'Waiting', pill: 'purple' },
  done: { dot: 'done', label: 'Done', pill: '' },
}
