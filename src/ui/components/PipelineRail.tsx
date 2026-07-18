// Middle pane, rebuilt to the Threadline Workspace mint design (#80). The rail
// is the five-stage pipeline stepper (Setup is no longer a rail stage — repo
// readiness lives in the onboarding wizard + top-bar gear): a mono bubble +
// connector per stage, each a selectable card whose detail expands INLINE in the
// mockup's dashed-top style. The design shows only the current stage's detail;
// we keep every stage selectable (the #79 hybrid) and fold the app's real
// behaviors — gate override, per-ticket implement/reconcile/review, landing,
// completion — into the selected card, restyled into the mint language.
//
// Gate data comes from the gating engine's StageSnapshot served by /api/stage
// (#21); the detail drives the implement/review sessions over /api/pipeline
// (#30/#37), landing, and completion. Behavior is unchanged from the #8 rail —
// only the visual layer and the stage count moved.

import {
  ArrowDownToLine,
  CircleCheck,
  Compass,
  ExternalLink,
  Play,
  RotateCcw,
  Search,
  TriangleAlert,
  Zap,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertDialog, AlertDialogContent, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { effortSessions } from '../lib/derive.js'
import { store, useStore } from '../lib/store.js'
import type { LandResult, StageSnapshot, TicketView } from '../lib/types.js'
import { PIPELINE_STAGES } from '../lib/types.js'
import { MintPill, RefBadge, SectionLabel } from './particles.js'

const STAGE_POLL_MS = 15_000

function useStageSnapshot(effortId: string | null): { snapshot: StageSnapshot | null; refresh: () => void } {
  const [snapshot, setSnapshot] = useState<StageSnapshot | null>(null)
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((t) => t + 1), [])
  useEffect(() => {
    if (!effortId) {
      setSnapshot(null)
      return
    }
    let alive = true
    const pull = () =>
      fetch(`/api/stage?effort=${encodeURIComponent(effortId)}`)
        .then((res) => (res.ok ? (res.json() as Promise<StageSnapshot>) : null))
        .then((snap) => {
          if (alive && snap) {
            setSnapshot(snap)
            // Advisory verdicts (#41): open request-changes PRs ride the Needs-you inbox.
            store.syncVerdictNotices(effortId!, snap.tickets)
          }
        })
        .catch(() => {})
    void pull()
    const timer = setInterval(pull, STAGE_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [effortId, tick])
  // Stale snapshot from the previous effort must not flash — drop it on switch.
  useEffect(() => setSnapshot(null), [effortId])
  return { snapshot, refresh }
}

/** Outer pane shell: fixed frame, its own right border, so header stays put
 *  while only the pipeline body scrolls (mirrors the design's flex column). */
function RailShell({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 min-w-0 flex-col border-r">{children}</div>
}

export function PipelineRail() {
  const state = useStore()
  const effort = state.efforts.find((e) => e.ref.id === state.selectedEffort) ?? null
  const { snapshot, refresh } = useStageSnapshot(effort?.ref.id ?? null)

  if (!effort) {
    if (!state.loaded) {
      // Before the first snapshot lands, show a stepper skeleton — never a
      // false "no effort" on a workspace that actually has efforts loading.
      return (
        <RailShell>
          <RailSkeleton />
        </RailShell>
      )
    }
    return (
      <RailShell>
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Compass />
            </EmptyMedia>
            <EmptyTitle>No effort selected</EmptyTitle>
            <EmptyDescription>
              Pick an effort from the sidebar — or chart a wayfinder map in a workspace repo to start one.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </RailShell>
    )
  }

  const closed = effort.state === 'closed'
  const currentIdx = snapshot ? PIPELINE_STAGES.findIndex((s) => s.key === snapshot.stage) : -1
  const stageIdx = state.selectedStageIdx ?? (currentIdx >= 0 ? currentIdx : 0)
  const sessions = effortSessions(state, effort.ref.id)
  const progressText = closed
    ? 'complete'
    : currentIdx >= 0
      ? `stage ${currentIdx + 1} of ${PIPELINE_STAGES.length}`
      : snapshot
        ? 'not started'
        : 'deriving…'

  return (
    <RailShell>
      {/* Header — title, ref, home breadcrumb, live stage pill (design) */}
      <div className="flex-none border-b px-5 pt-4 pb-3.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2.5">
              <h1 className="text-[17px] font-semibold tracking-[-0.015em]">{effort.title}</h1>
              <RefBadge className="text-[12px]">
                <a href={effort.ref.url} target="_blank" rel="noreferrer" className="hover:text-foreground">
                  {effort.ref.display}
                </a>
              </RefBadge>
            </div>
            <div className="flex items-center gap-2 text-[12px] text-[var(--fg3)]">
              <span>
                home <span className="font-mono text-muted-foreground">{effort.repo.name}</span>
              </span>
              <span>·</span>
              <span>
                {sessions.length} session{sessions.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>
          {closed ? (
            <MintPill className="flex-none">Completed</MintPill>
          ) : currentIdx >= 0 ? (
            <MintPill indicator="pulse" className="flex-none">
              {PIPELINE_STAGES[currentIdx]!.label}
            </MintPill>
          ) : (
            <span className="flex-none rounded-full border border-[var(--border2)] bg-popover px-3 py-1 text-xs font-semibold text-[var(--fg3)]">
              {snapshot ? 'not started' : 'deriving…'}
            </span>
          )}
        </div>
      </div>

      {/* Body — effort-level notices, then the pipeline stepper */}
      <div className="flex-1 overflow-y-auto px-5 pt-5 pb-6">
        {snapshot && snapshot.warnings.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {snapshot.warnings.map((w) => (
              <Badge key={w} variant="outline" className="gap-1 border-transparent bg-warning/12 text-warning">
                <TriangleAlert className="size-3" />
                {w}
              </Badge>
            ))}
          </div>
        )}
        {snapshot?.readyToComplete && !closed && (
          <div className="mb-4">
            <CompleteEffort effortId={effort.ref.id} onDone={refresh} />
          </div>
        )}

        <div className="mb-3.5 flex items-center justify-between">
          <SectionLabel>Pipeline</SectionLabel>
          <span className="font-mono text-[11px] text-[var(--fg3)]">{progressText}</span>
        </div>

        <StageStepper
          effortId={effort.ref.id}
          snapshot={snapshot}
          currentIdx={currentIdx}
          stageIdx={stageIdx}
          sessionCount={sessions.length}
          refresh={refresh}
        />
      </div>
    </RailShell>
  )
}

/** Initial-load placeholder: a muted stepper so the rail has shape before the
 *  first /api/stage snapshot lands, instead of a false-empty. */
function RailSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-5 pt-5" aria-hidden>
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-3 w-1/3" />
      <div className="mt-2 flex flex-col gap-4">
        {PIPELINE_STAGES.map((rail, i) => (
          <div key={rail.key} className="grid grid-cols-[26px_1fr] gap-3.5">
            <div className="flex flex-col items-center">
              <Skeleton className="size-[26px] rounded-full" />
              {i < PIPELINE_STAGES.length - 1 && <div className="my-1 min-h-[26px] w-0.5 flex-1 bg-border" />}
            </div>
            <Skeleton className="h-14 flex-1 rounded-xl" style={{ opacity: 1 - i * 0.14 }} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Stage state at rail index `i` relative to the derived current stage. */
type StageState = 'done' | 'current' | 'locked' | 'pending'

function stageStateAt(i: number, currentIdx: number, hasSnapshot: boolean): StageState {
  if (!hasSnapshot) return 'pending'
  if (currentIdx < 0) return 'locked' // effort still at setup — no gated stage is current yet
  if (i < currentIdx) return 'done'
  if (i === currentIdx) return 'current'
  return 'locked'
}

/** The five-stage vertical stepper (design): a mono bubble + connector line per
 *  stage, each stage a selectable card. The selected card expands its detail
 *  inline in the mockup's dashed-top style. */
function StageStepper({
  effortId,
  snapshot,
  currentIdx,
  stageIdx,
  sessionCount,
  refresh,
}: {
  effortId: string
  snapshot: StageSnapshot | null
  currentIdx: number
  stageIdx: number
  sessionCount: number
  refresh: () => void
}) {
  return (
    <div>
      {PIPELINE_STAGES.map((rail, i) => {
        const st = stageStateAt(i, currentIdx, !!snapshot)
        const gate = snapshot?.gates.find((g) => g.stage === rail.key)
        const selected = i === stageIdx
        const isCurrent = i === currentIdx
        const isLast = i === PIPELINE_STAGES.length - 1
        return (
          <div key={rail.key} className="grid grid-cols-[26px_1fr] gap-3.5">
            <div className="flex flex-col items-center">
              <StageBubble state={st} index={i} />
              {!isLast && (
                <div
                  className="my-1 min-h-[26px] w-0.5 flex-1 rounded-full"
                  style={{ background: st === 'done' ? 'var(--mint-line)' : 'var(--border)' }}
                />
              )}
            </div>
            <div
              className={cn(
                'mb-4 rounded-xl border transition-colors duration-150',
                selected || isCurrent ? 'border-[color:var(--mint-line)] bg-primary/[0.05]' : 'border-border bg-popover',
              )}
            >
              <button
                type="button"
                onClick={() => store.selectStage(i)}
                className="flex w-full flex-col gap-1.5 p-3 text-left"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn('text-[13.5px] font-semibold', st === 'locked' && 'text-[var(--fg3)]')}
                  >
                    {rail.label}
                  </span>
                  <GateStatePill state={st} overridden={gate?.overridden} />
                  {isCurrent && <span className="ml-auto font-mono text-[10.5px] text-primary">active</span>}
                </div>
                <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  <span className="text-[var(--fg3)]">gate</span>
                  <span className="min-w-0 truncate">{gateText(gate)}</span>
                </div>
              </button>

              {selected && (
                <div className="flex flex-col gap-3 border-t border-dashed border-[var(--border2)] px-3 pt-3 pb-3">
                  {(rail.key === 'implement' || rail.key === 'code-review') && snapshot && (
                    <TicketList
                      effortId={effortId}
                      tickets={snapshot.tickets}
                      reviewable={rail.key === 'code-review'}
                      refresh={refresh}
                    />
                  )}
                  {gate && (
                    <OverrideGate
                      effortId={effortId}
                      stage={gate.stage}
                      met={gate.met}
                      overridden={gate.overridden}
                      onDone={refresh}
                    />
                  )}
                  {rail.key === 'code-review' && snapshot && (gate?.met || gate?.overridden) && (
                    <LandEffort effortId={effortId} onDone={refresh} />
                  )}
                  <div className="flex items-center gap-2.5">
                    <span className="text-[11.5px] text-[var(--fg3)]">
                      {sessionCount} session{sessionCount === 1 ? '' : 's'} on this effort — docked on the right.
                    </span>
                    <span className="flex-1" />
                    <Button size="sm" onClick={() => store.setNewSessionOpen(true)}>
                      <Play />
                      Start session
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** The design's 26px mono bubble: done ✓ (transparent, mint ring), current
 *  (mint fill + focus ripple, stage number), locked/pending (surface, number). */
function StageBubble({ state, index }: { state: StageState; index: number }) {
  const base =
    'flex size-[26px] shrink-0 items-center justify-center rounded-full border-[1.5px] font-mono text-[11px] font-bold transition-colors duration-150'
  if (state === 'done') {
    return <span className={cn(base, 'border-primary bg-transparent text-primary')}>✓</span>
  }
  if (state === 'current') {
    return <span className={cn(base, 'tl-ring border-primary bg-primary text-primary-foreground')}>{index + 1}</span>
  }
  return (
    <span className={cn(base, 'border-[var(--border2)] bg-popover text-[var(--fg3)]')}>{index + 1}</span>
  )
}

/** Small gate-state pill on a stage card: passed (mint) / in progress (amber) /
 *  locked (muted), with an `overridden` amber note when the gate was stamped. */
function GateStatePill({ state, overridden }: { state: StageState; overridden?: boolean }) {
  const base = 'rounded-full border px-2 py-px text-[10.5px] font-semibold'
  if (overridden) {
    return (
      <span className={cn(base, 'border-warning/40 bg-warning/10 text-warning')}>overridden</span>
    )
  }
  if (state === 'done') {
    return <span className={cn(base, 'border-[color:var(--mint-line)] bg-accent text-primary')}>passed</span>
  }
  if (state === 'current') {
    return <span className={cn(base, 'border-warning/40 bg-warning/10 text-warning')}>in progress</span>
  }
  if (state === 'pending') {
    return <span className={cn(base, 'border-[var(--border2)] bg-popover font-medium text-[var(--fg3)]')}>unknown</span>
  }
  return <span className={cn(base, 'border-[var(--border2)] bg-popover font-medium text-[var(--fg3)]')}>locked</span>
}

/** Human-readable gate line for a stage card. */
function gateText(gate: StageSnapshot['gates'][number] | undefined): string {
  if (!gate) return 'deriving from the tracker…'
  if (gate.met) return 'exit condition met'
  if (gate.overridden) return 'overridden — stamp on the map issue'
  return gate.unmet.join(' · ') || 'gate not met'
}

/**
 * Gate override (#6/#40): per-stage "I know what I'm doing" with a required
 * reason, on a modal AlertDialog — POSTs /api/pipeline/override, which writes
 * the audit comment then the stamp. An overridden gate offers revoke.
 */
function OverrideGate({
  effortId,
  stage,
  met,
  overridden,
  onDone,
}: {
  effortId: string
  stage: string
  met: boolean
  overridden: boolean
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<string | null>, closeDialog: boolean) => {
    setBusy(true)
    const error = await action()
    setBusy(false)
    if (error) toast.error(error)
    else {
      toast.success(closeDialog ? `${stage} gate overridden` : 'Override revoked')
      if (closeDialog) {
        setOpen(false)
        setReason('')
      }
      onDone()
    }
  }

  if (overridden) {
    return (
      <div className="flex items-center gap-2.5">
        <span className="text-[11.5px] text-[var(--fg3)]">
          Override stamp on the map issue — audit comment holds who/why.
        </span>
        <span className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void run(() => store.revokeOverride(effortId, stage), false)}
        >
          {busy ? <Spinner /> : <RotateCcw />}
          {busy ? 'Revoking…' : 'Revoke override'}
        </Button>
      </div>
    )
  }
  if (met) return null
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[11.5px] text-[var(--fg3)]">Hard gates only unlock on their exit condition.</span>
      <span className="flex-1" />
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger
          render={<Button variant="outline" size="sm" className="text-warning hover:bg-warning/12 hover:text-warning" />}
        >
          <TriangleAlert />
          Override gate…
        </AlertDialogTrigger>
        <AlertDialogContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h3 className="flex items-center gap-2 text-base font-medium">
              <TriangleAlert className="size-4 text-warning" />
              Override the {stage} gate
            </h3>
            <p className="text-sm text-muted-foreground">
              Overriding records an audit comment and stamps the map issue — a reason is required.
            </p>
          </div>
          <Field>
            <FieldLabel htmlFor="override-reason">Reason</FieldLabel>
            <Textarea
              id="override-reason"
              rows={3}
              autoFocus
              placeholder="Why is it safe to pass this gate anyway?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <FieldDescription>Recorded on the audit comment alongside the stamp.</FieldDescription>
          </Field>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy || !reason.trim()}
              onClick={() => void run(() => store.applyOverride(effortId, stage, reason), true)}
            >
              {busy ? <Spinner /> : <TriangleAlert />}
              {busy ? 'Overriding…' : 'I know what I’m doing — override'}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/**
 * Per-ticket rows (#37/#52) in the design's row grammar: a merge-state check, the
 * mono ref, PR/verdict/conflict badges, and the per-stage actions (implement,
 * reconcile, review). A segmented bar shows ticket PRs merged at a glance.
 */
function TicketList({
  effortId,
  tickets,
  reviewable,
  refresh,
}: {
  effortId: string
  tickets: TicketView[]
  reviewable: boolean
  refresh: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)

  const run = async (key: string, action: () => Promise<string | null>, started: string) => {
    setBusy(key)
    const error = await action()
    setBusy(null)
    if (error) toast.error(error)
    else {
      toast.success(started)
      refresh()
    }
  }

  if (tickets.length === 0) {
    return <p className="text-[11.5px] text-[var(--fg3)]">No tickets on this effort yet — to-tickets creates them.</p>
  }
  const merged = tickets.filter((t) => t.pr?.state === 'merged').length
  return (
    <div className="flex flex-col gap-3">
      <MergeBar merged={merged} total={tickets.length} />
      <div className="flex flex-col gap-2">
        {tickets.map((t) => {
          const id = t.ref.id
          const isMerged = t.pr?.state === 'merged'
          return (
            <div key={id} className="flex flex-wrap items-center gap-2 text-[12px]">
              <span
                aria-hidden
                className={cn(
                  'flex size-[15px] shrink-0 items-center justify-center rounded-full text-[9px]',
                  isMerged
                    ? 'bg-primary text-primary-foreground'
                    : 'border-[1.5px] border-[var(--border2)] text-[var(--fg3)]',
                )}
              >
                {isMerged ? '✓' : ''}
              </span>
              <a
                href={t.pr?.url ?? t.ref.url}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11.5px] text-[var(--fg3)] hover:text-foreground"
              >
                {t.ref.display}
              </a>
              {t.closed && <Badge variant="outline">closed</Badge>}
              {t.pr ? (
                <Badge
                  variant="outline"
                  render={<a href={t.pr.url} target="_blank" rel="noreferrer" />}
                  className={cn(
                    'gap-1 border-transparent',
                    t.pr.state === 'merged'
                      ? 'bg-success/12 text-success'
                      : t.pr.state === 'open'
                        ? 'bg-info/12 text-info'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  PR {t.pr.state}
                  <ExternalLink className="size-3" />
                </Badge>
              ) : (
                <Badge variant="outline">no PR</Badge>
              )}
              {t.pr?.agentVerdict && (
                <Badge
                  variant="outline"
                  className={cn(
                    'border-transparent',
                    t.pr.agentVerdict === 'approve' ? 'bg-success/12 text-success' : 'bg-warning/12 text-warning',
                  )}
                >
                  {t.pr.agentVerdict === 'approve' ? 'agent: approve' : 'agent: changes requested'}
                </Badge>
              )}
              {t.pr?.conflicting && <Badge variant="destructive">conflicts with trunk</Badge>}
              <span className="flex-1" />
              {t.pr?.conflicting && (
                <Button
                  variant="destructive"
                  size="xs"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(`reconcile:${id}`, () => store.startReconcile(effortId, id), 'Reconcile session started')
                  }
                >
                  {busy === `reconcile:${id}` ? <Spinner /> : <Zap />}
                  {busy === `reconcile:${id}` ? 'Starting…' : 'Reconcile'}
                </Button>
              )}
              {reviewable && t.pr?.state === 'open' && (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={busy !== null}
                  onClick={() => void run(`review:${id}`, () => store.startReview(effortId, id), 'Review session started')}
                >
                  {busy === `review:${id}` ? <Spinner /> : <Search />}
                  {busy === `review:${id}` ? 'Starting…' : t.pr.agentVerdict ? 'Review again' : 'Review'}
                </Button>
              )}
              {t.pr?.state !== 'merged' && (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(`implement:${id}`, () => store.startImplement(effortId, id), 'Implement session started')
                  }
                >
                  {busy === `implement:${id}` ? <Spinner /> : <Play />}
                  {busy === `implement:${id}` ? 'Starting…' : t.pr ? 'Implement again' : 'Implement'}
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** The design's "Tickets merged" segmented progress bar: full-width segments,
 *  mint filled / surface empty, one per ticket. */
function MergeBar({ merged, total }: { merged: number; total: number }) {
  if (total <= 0) return null
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11.5px] text-muted-foreground">Tickets merged</span>
        <span className="font-mono text-[11.5px] text-foreground">
          {merged} / {total}
        </span>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn('h-1.5 flex-1 rounded-[3px]', i < merged ? 'bg-primary' : 'bg-[var(--surface2)]')}
          />
        ))}
      </div>
    </div>
  )
}

/** Landing flow (#11): one button per effort, per-repo results — PR link, sync session, or in-progress. */
function LandEffort({ effortId, onDone }: { effortId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<LandResult[] | null>(null)

  const land = async () => {
    setBusy(true)
    const res = await store.landEffort(effortId)
    setBusy(false)
    if (res.error) {
      toast.error(res.error)
      return
    }
    const landed = res.results ?? []
    setResults(landed)
    const conflicts = landed.filter((r) => r.status === 'sync_session_started').length
    if (conflicts > 0)
      toast.warning(`Landing hit conflicts — ${conflicts} sync session${conflicts === 1 ? '' : 's'} started`)
    else if (landed.length > 0) toast.success('Effort landed — PRs opened')
    else toast('Nothing to land — no repo grew an effort trunk')
    onDone()
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <span className="text-[11.5px] text-[var(--fg3)]">All ticket PRs are in — land the effort trunk on main.</span>
        <span className="flex-1" />
        <Button size="sm" disabled={busy} onClick={() => void land()}>
          {busy ? <Spinner /> : <ArrowDownToLine />}
          {busy ? 'Landing…' : 'Land effort'}
        </Button>
      </div>
      {results && results.length === 0 && (
        <p className="text-[11.5px] text-[var(--fg3)]">No repo grew an effort trunk — nothing to land.</p>
      )}
      {results?.map((r) => (
        <div key={r.repo} className="flex items-center gap-2 text-xs">
          <span className="font-mono">{r.repo}</span>
          {r.status === 'pr_opened' || r.status === 'pr_exists' ? (
            <Badge
              variant="outline"
              render={<a href={r.prUrl} target="_blank" rel="noreferrer" />}
              className="gap-1 border-transparent bg-success/12 text-success"
            >
              {r.status === 'pr_opened' ? 'landing PR opened' : 'landing PR already open'}
              <ExternalLink className="size-3" />
            </Badge>
          ) : r.status === 'sync_session_started' ? (
            <Badge
              variant="outline"
              render={<button type="button" onClick={() => r.session && store.selectSession(r.session.id)} />}
              className="cursor-pointer border-transparent bg-warning/12 text-warning"
            >
              main→trunk conflicts — sync session started, open chat
            </Badge>
          ) : (
            <Badge variant="outline" className="border-transparent bg-warning/12 text-warning">
              sync session still running
            </Badge>
          )}
        </div>
      ))}
    </div>
  )
}

/** Post-landing sweep (#11): remove worktrees + trunks; a clean sweep closes the map issue (#6). */
function CompleteEffort({ effortId, onDone }: { effortId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [kept, setKept] = useState<number | null>(null)
  const [mapClosed, setMapClosed] = useState(false)

  const complete = async () => {
    setBusy(true)
    const res = await store.completeEffort(effortId)
    setBusy(false)
    if (res.error) {
      toast.error(res.error)
      return
    }
    const keptCount = (res.results ?? []).reduce((n, r) => n + r.keptWorktrees.length, 0)
    setKept(keptCount)
    setMapClosed(res.mapClosed ?? false)
    if (keptCount > 0) {
      store.setInboxOpen(true)
      toast.warning(`Effort completed — ${keptCount} dirty worktree${keptCount === 1 ? '' : 's'} kept`)
    } else {
      toast.success(res.mapClosed ? 'Effort completed — map issue closed' : 'Effort completed')
    }
    onDone()
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-xl bg-success/8 p-2.5 ring-1 ring-success/20">
      <Badge variant="outline" className="border-transparent bg-success/12 text-success">
        All gates pass.
      </Badge>
      <span className="text-xs text-muted-foreground">Sweeps worktrees and trunks, then closes the map issue.</span>
      <span className="flex-1" />
      <Button size="sm" disabled={busy} onClick={() => void complete()}>
        {busy ? <Spinner /> : <CircleCheck />}
        {busy ? 'Completing…' : 'Complete effort'}
      </Button>
      {mapClosed && (
        <Badge variant="outline" className="border-transparent bg-success/12 text-success">
          map issue closed
        </Badge>
      )}
      {kept !== null && kept > 0 && (
        <Badge variant="outline" className="border-transparent bg-warning/12 text-warning">
          {kept} dirty worktree{kept === 1 ? '' : 's'} kept — map left open
        </Badge>
      )}
    </div>
  )
}
