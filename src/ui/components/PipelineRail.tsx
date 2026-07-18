// Middle pane of the locked IA (#8), rebuilt on shadcn (Base UI) in the Soft
// Depth direction (#65): the six-stage stepper (Item + Separator + Spinner +
// Badge; done/current/locked bubbles), the selected stage's detail Card, the
// per-ticket Item rows, and the gate-override flow on a modal AlertDialog.
// Gate data comes from the gating engine's StageSnapshot served by /api/stage
// (#21); the detail card drives the implement stage over /api/pipeline
// (#30/#37): per-ticket implement/reconcile sessions, landing, and completion.
// Behavior is unchanged from the #8 rail — only the visual layer moved.

import {
  ArrowDownToLine,
  Check,
  CircleCheck,
  ExternalLink,
  Lock,
  Play,
  RotateCcw,
  Search,
  TriangleAlert,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { AlertDialog, AlertDialogContent, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Item, ItemActions, ItemContent, ItemTitle } from '@/components/ui/item'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { effortCost, effortSessions } from '../lib/derive.js'
import { store, useStore } from '../lib/store.js'
import type { LandResult, StageSnapshot, TicketView } from '../lib/types.js'
import { RAIL_STAGES } from '../lib/types.js'
import { Ticks } from './particles.js'

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

export function PipelineRail() {
  const state = useStore()
  const effort = state.efforts.find((e) => e.ref.id === state.selectedEffort) ?? null
  const { snapshot, refresh } = useStageSnapshot(effort?.ref.id ?? null)

  if (!effort) {
    return (
      <div className="flex min-w-0 flex-col items-center justify-center overflow-y-auto border-r">
        <p className="max-w-xs p-6 text-center text-sm text-muted-foreground">
          Select an effort — or start one by charting a wayfinder map in a workspace repo.
        </p>
      </div>
    )
  }

  // Rail index 0 is Setup (repo readiness, #6); gating stages shift by one.
  const currentIdx = snapshot ? RAIL_STAGES.findIndex((s) => s.key === snapshot.stage) : -1
  const stageIdx = state.selectedStageIdx ?? (currentIdx >= 0 ? currentIdx : 1)
  const cost = effortCost(state, effort.ref.id)
  const sessions = effortSessions(state, effort.ref.id)

  return (
    <div className="flex min-w-0 flex-col overflow-y-auto border-r pb-6">
      <div className="flex flex-col gap-3 px-5 pt-4 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-medium">{effort.title}</h2>
          <Badge
            variant="outline"
            render={<a href={effort.ref.url} target="_blank" rel="noreferrer" />}
            className="font-mono text-muted-foreground"
          >
            {effort.ref.display}
          </Badge>
          {effort.state === 'closed' && (
            <Badge variant="outline" className="border-transparent bg-success/12 text-success">
              Completed
            </Badge>
          )}
          <span className="flex-1" />
          {cost > 0 && (
            <Badge variant="outline" title="effort cost" className="font-mono text-muted-foreground">
              ${cost.toFixed(2)}
            </Badge>
          )}
        </div>

        <StageStepper snapshot={snapshot} currentIdx={currentIdx} stageIdx={stageIdx} />

        {!snapshot && <p className="text-xs text-muted-foreground">Deriving gate state from the tracker…</p>}
        {snapshot && snapshot.warnings.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {snapshot.warnings.map((w) => (
              <Badge key={w} variant="outline" className="gap-1 border-transparent bg-warning/12 text-warning">
                <TriangleAlert className="size-3" />
                {w}
              </Badge>
            ))}
          </div>
        )}
        {snapshot?.readyToComplete && effort.state !== 'closed' && (
          <CompleteEffort effortId={effort.ref.id} onDone={refresh} />
        )}
      </div>

      <StageDetail
        effortId={effort.ref.id}
        stageIdx={stageIdx}
        currentIdx={currentIdx}
        snapshot={snapshot}
        sessionCount={sessions.length}
        refresh={refresh}
      />
    </div>
  )
}

/** Stage state at rail index `i` relative to the derived current stage. */
type StageState = 'done' | 'current' | 'locked' | 'pending'

function stageStateAt(i: number, currentIdx: number, hasSnapshot: boolean): StageState {
  if (!hasSnapshot) return 'pending'
  if (i < currentIdx) return 'done'
  if (i === currentIdx) return 'current'
  return 'locked'
}

/** The six-stage vertical stepper: a bubble + connector rail per stage, each
 *  stage an Item button that selects it. Done ✓ / current spinner / locked 🔒. */
function StageStepper({
  snapshot,
  currentIdx,
  stageIdx,
}: {
  snapshot: StageSnapshot | null
  currentIdx: number
  stageIdx: number
}) {
  return (
    <div className="flex flex-col">
      {RAIL_STAGES.map((rail, i) => {
        const st = stageStateAt(i, currentIdx, !!snapshot)
        const gate = snapshot?.gates.find((g) => g.stage === rail.key)
        const selected = i === stageIdx
        const isLast = i === RAIL_STAGES.length - 1
        return (
          <div key={rail.key} className="flex items-stretch gap-3">
            <div className="flex flex-col items-center">
              <StageBubble state={st} />
              {!isLast && <Separator orientation="vertical" className="my-1 min-h-3 flex-1" />}
            </div>
            <Item
              size="sm"
              variant={selected ? 'muted' : 'default'}
              render={<button type="button" onClick={() => store.selectStage(i)} />}
              className={cn('mb-1 flex-1 text-left', selected && 'ring-1 ring-primary/25')}
            >
              <ItemContent>
                <ItemTitle className={cn(st === 'locked' && 'text-muted-foreground')}>
                  {rail.label}
                  {gate?.overridden && (
                    <Badge variant="outline" className="border-transparent bg-warning/12 text-warning">
                      overridden
                    </Badge>
                  )}
                </ItemTitle>
                {st === 'current' && gate && gate.unmet.length > 0 && (
                  <p className="text-xs text-muted-foreground">{gate.unmet.join(' · ')}</p>
                )}
              </ItemContent>
            </Item>
          </div>
        )
      })}
    </div>
  )
}

function StageBubble({ state }: { state: StageState }) {
  const base = 'flex size-6 shrink-0 items-center justify-center rounded-full'
  if (state === 'current') {
    return (
      <span className={cn(base, 'bg-primary/15 text-primary ring-1 ring-primary/30')}>
        <Spinner className="size-3.5" />
      </span>
    )
  }
  if (state === 'done') {
    return (
      <span className={cn(base, 'bg-primary text-primary-foreground')}>
        <Check className="size-3.5" />
      </span>
    )
  }
  if (state === 'locked') {
    return (
      <span className={cn(base, 'bg-muted text-muted-foreground')}>
        <Lock className="size-3" />
      </span>
    )
  }
  return (
    <span className={cn(base, 'bg-muted text-muted-foreground')}>
      <span className="size-1.5 rounded-full bg-current" />
    </span>
  )
}

function StageStatusBadge({ state }: { state: StageState }) {
  if (state === 'pending') return <Badge variant="outline">unknown</Badge>
  if (state === 'done') {
    return (
      <Badge variant="outline" className="border-transparent bg-success/12 text-success">
        Done
      </Badge>
    )
  }
  if (state === 'current') {
    return (
      <Badge variant="outline" className="border-transparent bg-info/12 text-info">
        In progress
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1 bg-muted text-muted-foreground">
      <Lock className="size-3" />
      Locked
    </Badge>
  )
}

function StageDetail({
  effortId,
  stageIdx,
  currentIdx,
  snapshot,
  sessionCount,
  refresh,
}: {
  effortId: string
  stageIdx: number
  currentIdx: number
  snapshot: StageSnapshot | null
  sessionCount: number
  refresh: () => void
}) {
  const rail = RAIL_STAGES[stageIdx]!
  const gate = snapshot?.gates.find((g) => g.stage === rail.key)
  const st = stageStateAt(stageIdx, currentIdx, !!snapshot)

  return (
    <div className="px-5 pt-2">
      <Card size="sm">
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <b className="text-sm">{rail.label}</b>
            <StageStatusBadge state={st} />
            <span className="flex-1" />
            <Button size="sm" onClick={() => store.setNewSessionOpen(true)}>
              <Play />
              Start session
            </Button>
          </div>
          <p className="text-[13px] text-muted-foreground">
            {rail.key === 'setup'
              ? 'Repo readiness — skills installed, docs generated, tracker connected. Managed by the onboarding wizard (#22).'
              : gate
                ? gate.met
                  ? 'Exit condition met — artifacts recorded on the tracker.'
                  : gate.overridden
                    ? 'Gate overridden — an override stamp with audit comment is on the map issue.'
                    : gate.unmet.join(' · ')
                : 'Gate state pending — deriving from the tracker.'}
          </p>
          <p className="text-xs text-muted-foreground/80">
            {sessionCount} session{sessionCount === 1 ? '' : 's'} on this effort — docked on the right.
          </p>
          {gate && (
            <OverrideGate
              effortId={effortId}
              stage={gate.stage}
              met={gate.met}
              overridden={gate.overridden}
              onDone={refresh}
            />
          )}
          {(rail.key === 'implement' || rail.key === 'code-review') && snapshot && (
            <TicketList
              effortId={effortId}
              tickets={snapshot.tickets}
              reviewable={rail.key === 'code-review'}
              refresh={refresh}
            />
          )}
          {rail.key === 'code-review' && snapshot && (gate?.met || gate?.overridden) && (
            <LandEffort effortId={effortId} onDone={refresh} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Gate override (#6/#40): per-stage "I know what I'm doing" with a required
 * reason, now on a modal AlertDialog — POSTs /api/pipeline/override, which
 * writes the audit comment then the stamp. An overridden gate offers revoke.
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
    if (error) store.setError(error)
    else {
      if (closeDialog) {
        setOpen(false)
        setReason('')
      }
      onDone()
    }
  }

  if (overridden) {
    return (
      <>
        <Separator className="mt-1" />
        <div className="flex items-center gap-2.5">
          <span className="text-xs text-muted-foreground">
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
      </>
    )
  }
  if (met) return null
  return (
    <>
      <Separator className="mt-1" />
      <div className="flex items-center gap-2.5">
        <span className="text-xs text-muted-foreground">
          Gate not met — hard gates only unlock on their exit condition.
        </span>
        <span className="flex-1" />
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger
            render={
              <Button variant="outline" size="sm" className="text-warning hover:bg-warning/12 hover:text-warning" />
            }
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
    </>
  )
}

/**
 * Per-ticket rows with the per-stage actions (#37/#52): start a session,
 * reconcile a conflicted PR, and — on the code-review rows only — launch a
 * review session against the ticket's open PR. A Ticks strip shows how many
 * ticket PRs have merged at a glance.
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

  const run = async (key: string, action: () => Promise<string | null>) => {
    setBusy(key)
    const error = await action()
    setBusy(null)
    if (error) store.setError(error)
    else refresh()
  }

  if (tickets.length === 0) {
    return (
      <>
        <Separator className="mt-1" />
        <p className="text-xs text-muted-foreground">No tickets on this effort yet — to-tickets creates them.</p>
      </>
    )
  }
  const merged = tickets.filter((t) => t.pr?.state === 'merged').length
  return (
    <div className="mt-1 flex flex-col gap-2">
      <Separator />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {merged}/{tickets.length} merged
        </span>
        <Ticks done={merged} total={tickets.length} />
      </div>
      {tickets.map((t) => {
        const id = t.ref.id
        return (
          <Item key={id} variant="outline" size="sm">
            <ItemContent className="flex-row flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{t.ref.display}</span>
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
            </ItemContent>
            <ItemActions>
              {t.pr?.conflicting && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void run(`reconcile:${id}`, () => store.startReconcile(effortId, id))}
                >
                  {busy === `reconcile:${id}` ? <Spinner /> : <Zap />}
                  {busy === `reconcile:${id}` ? 'Starting…' : 'Reconcile'}
                </Button>
              )}
              {reviewable && t.pr?.state === 'open' && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void run(`review:${id}`, () => store.startReview(effortId, id))}
                >
                  {busy === `review:${id}` ? <Spinner /> : <Search />}
                  {busy === `review:${id}` ? 'Starting…' : t.pr.agentVerdict ? 'Review again' : 'Review'}
                </Button>
              )}
              {t.pr?.state !== 'merged' && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void run(`implement:${id}`, () => store.startImplement(effortId, id))}
                >
                  {busy === `implement:${id}` ? <Spinner /> : <Play />}
                  {busy === `implement:${id}` ? 'Starting…' : t.pr ? 'Implement again' : 'Implement'}
                </Button>
              )}
            </ItemActions>
          </Item>
        )
      })}
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
    if (res.error) store.setError(res.error)
    else {
      setResults(res.results ?? [])
      onDone()
    }
  }

  return (
    <>
      <Separator className="mt-1" />
      <div className="flex items-center gap-2.5">
        <span className="text-[13px] text-muted-foreground">All ticket PRs are in — land the effort trunk on main.</span>
        <span className="flex-1" />
        <Button size="sm" disabled={busy} onClick={() => void land()}>
          {busy ? <Spinner /> : <ArrowDownToLine />}
          {busy ? 'Landing…' : 'Land effort'}
        </Button>
      </div>
      {results && results.length === 0 && (
        <p className="text-xs text-muted-foreground">No repo grew an effort trunk — nothing to land.</p>
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
    </>
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
    if (res.error) store.setError(res.error)
    else {
      const keptCount = (res.results ?? []).reduce((n, r) => n + r.keptWorktrees.length, 0)
      setKept(keptCount)
      setMapClosed(res.mapClosed ?? false)
      if (keptCount > 0) store.setInboxOpen(true)
      onDone()
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-lg bg-success/8 p-2.5 ring-1 ring-success/20">
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
