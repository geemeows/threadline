// Onboarding wizard (#82): the first-run, full-screen takeover from the Mint
// Workspace design — a 1020×672 card, steps rail on the left, one gated step
// at a time on the right. It replaces the old guided mode of the readiness
// dialog; SetupPanel keeps the always-available readiness view (#83 restyles
// it). Steps: Repos → Tracker → Auth → Teams (Linear) | Labels (GitHub) →
// Skills → Docs → Ready. Rail steps are freely clickable; only Continue is
// gated, with the mockup's amber hint naming what's missing.
//
// Hybrids locked with the human (fold the real behaviors the mockup omits):
// GitHub label provisioning gets its own rail step, the mirror of Linear's
// Teams; the Docs step keeps BOTH the mockup's seed-with-agent button and the
// template plan review, expanded inline; agent escalations (skills fix, doc
// seeding) enter the workspace with the session open — the top-bar gear stays
// amber until setup finishes. Hot interactions are optimistic (#72 perf fix):
// repo toggles and the tracker pick keep local state and PUT without the full
// status recompute — a background refresh runs on step navigation instead.

import { Wand2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { mutateJson, store, useStore } from '../lib/store.js'
import type {
  DocPlanEntry,
  GitHubProvisionResult,
  LinearTeam,
  RepoReadiness,
  SetupStatus,
} from '../lib/types.js'
import { PIPELINE_STAGES } from '../lib/types.js'
import { CodeBlock, DiamondLogo, SectionLabel } from './particles.js'

const DOC_AGENT_PROMPT = [
  'Run /setup-matt-pocock-skills for this repository.',
  'Seed CONTEXT.md at the repo root, docs/agents/glossary.md, and docs/agents/coding-standards.md',
  'from what the codebase actually contains. Do not overwrite docs/agents/issue-tracker.md',
  'or docs/adr/template.md — threadmap stamps those from templates.',
  'Commit the new docs with the message "docs: threadmap setup — agent docs" and push to origin.',
  'If the push is rejected (branch protection), move the commit onto a branch and open a PR instead.',
].join(' ')

const SKILLS_AGENT_PROMPT = [
  'The threadmap skills install failed. Install the official mattpocock/skills at the pinned',
  'version with `npx skills add "mattpocock/skills#<pin>" --global`, then make sure every skill',
  'in ~/.agents/skills is linked (or copied) into ~/.claude/skills. Diagnose whatever is failing',
  '(npx availability, permissions, symlink support) and fix it.',
].join(' ')

type StepKey = 'repos' | 'tracker' | 'auth' | 'teams' | 'labels' | 'skills' | 'docs' | 'ready'

interface StepDef {
  key: StepKey
  label: string
  title: string
  sub: string
}

export function OnboardingWizard() {
  const state = useStore()
  if (!state.setup) return null
  return <WizardCard setup={state.setup} />
}

function WizardCard({ setup }: { setup: SetupStatus }) {
  const state = useStore()
  const discovered = state.workspace?.repos ?? []
  const wsName = state.workspace?.root.split('/').pop() ?? 'this workspace'

  const [stepIdx, setStepIdx] = useState(0)
  // Optimistic local mirrors of the config (#72 perf fix) — the server status
  // snapshot only refreshes on step navigation, not per toggle.
  const [confirmed, setConfirmed] = useState<Set<string>>(() => new Set(setup.repos.map((r) => r.name)))
  const [tracker, setTracker] = useState(setup.tracker)
  const [teamsProvisioned, setTeamsProvisioned] = useState(false)
  const [labelResults, setLabelResults] = useState<GitHubProvisionResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const steps: StepDef[] = [
    {
      key: 'repos',
      label: 'Repos',
      title: 'Confirm workspace repos',
      sub: `Threadmap discovered these git clones in ${wsName}. Uncheck any it should ignore.`,
    },
    {
      key: 'tracker',
      label: 'Tracker',
      title: 'Choose an issue tracker',
      sub: 'Efforts and tickets live in your tracker. This choice locks once the first effort is created.',
    },
    {
      key: 'auth',
      label: 'Auth',
      title: tracker === 'linear' ? 'Connect Linear' : 'Connect GitHub',
      sub:
        tracker === 'linear'
          ? 'Paste a Linear API key so Threadmap can read teams and manage issues.'
          : 'Threadmap drives issues, PRs and gates through the gh CLI.',
    },
    ...(tracker === 'linear'
      ? [
          {
            key: 'teams' as const,
            label: 'Teams',
            title: 'Map repos to Linear teams',
            sub: 'Each repo routes its tickets to one default team. Provision writes the label vocabulary.',
          },
        ]
      : [
          {
            key: 'labels' as const,
            label: 'Labels',
            title: 'Provision tracker labels',
            sub: 'Stamp the threadmap label vocabulary into every confirmed repo — sessions cannot create labelled issues without it.',
          },
        ]),
    {
      key: 'skills',
      label: 'Skills',
      title: 'Install pipeline skills',
      sub: 'The Matt Pocock SDLC slash-skills each session runs. Installed once per machine.',
    },
    {
      key: 'docs',
      label: 'Docs',
      title: 'Seed agent docs',
      sub: 'Every repo needs CONTEXT.md and agent docs so sessions share the same ground truth.',
    },
    {
      key: 'ready',
      label: 'Ready',
      title: "You're ready to work",
      sub: 'A quick readiness recap before you enter the workspace.',
    },
  ]
  const idx = Math.min(stepIdx, steps.length - 1)
  const cur = steps[idx]!

  const gates: Record<StepKey, boolean> = {
    repos: confirmed.size > 0,
    tracker: tracker !== null,
    auth: setup.auth.ok,
    teams: teamsProvisioned && setup.repos.every((r) => r.teamId),
    labels: labelResults !== null && labelResults.every((r) => r.ok),
    skills: setup.skills.ok,
    docs: setup.repos.some((r) => r.ready),
    ready: setup.ready,
  }
  const hints: Record<StepKey, string> = {
    repos: 'Confirm at least one repo',
    tracker: 'Pick a tracker',
    auth: tracker === 'linear' ? 'Save a valid key' : 'Authenticate gh',
    teams: 'Map every repo and provision teams',
    labels: 'Provision labels',
    skills: 'Install skills',
    docs: 'Seed docs in at least one repo',
    ready: 'Finish the amber checks first',
  }
  const canContinue = gates[cur.key]
  const isLastStep = cur.key === 'ready'

  const goTo = (i: number) => {
    setStepIdx(i)
    setError(null)
    // One recompute per navigation instead of per toggle (#72 perf fix).
    void store.refreshSetup()
  }

  const toggleRepo = (name: string) => {
    const next = new Set(confirmed)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setConfirmed(next)
    const repos = discovered.filter((r) => next.has(r.name)).map((r) => r.name)
    void store.saveSetupConfig({ repos }, { refresh: false }).then((err) => err && setError(err))
  }

  const pickTracker = (t: 'github' | 'linear') => {
    if (setup.trackerLocked && setup.tracker !== t) return
    const prev = tracker
    setTracker(t)
    void store.saveSetupConfig({ tracker: t }, { refresh: false }).then((err) => {
      if (err) {
        setTracker(prev)
        setError(err)
      } else {
        // The auth check is tracker-specific — refresh so the Auth step is honest.
        void store.refreshSetup()
      }
    })
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 items-center justify-center">
      <div className="flex h-[min(672px,100%)] w-[min(1020px,100%)] overflow-hidden rounded-[18px] border bg-card shadow-depth">
        {/* steps rail */}
        <div className="flex w-[266px] shrink-0 flex-col border-r bg-[color-mix(in_srgb,var(--panel)_55%,var(--bg))] px-[18px] py-5">
          <div className="mb-1 flex items-center gap-[9px] text-[15px] font-bold tracking-[-0.015em]">
            <DiamondLogo />
            Threadmap
          </div>
          <SectionLabel className="px-1 pb-2 pt-3.5">First-run setup</SectionLabel>
          <div className="flex flex-col gap-0.5" role="list">
            {steps.map((s, i) => {
              const done = i < idx
              const current = i === idx
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => goTo(i)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-[11px] rounded-[9px] px-2.5 py-2 text-left text-[13px]',
                    current
                      ? 'bg-muted font-semibold text-foreground'
                      : done
                        ? 'font-medium text-foreground'
                        : 'font-medium text-[var(--fg3)]',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] font-mono text-[10.5px] font-bold',
                      done
                        ? 'border-primary bg-transparent text-primary'
                        : current
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-[var(--border2)] bg-popover text-[var(--fg3)]',
                    )}
                  >
                    {done ? '✓' : i + 1}
                  </span>
                  {s.label}
                </button>
              )
            })}
          </div>
          <div className="mt-auto border-t pt-3 text-[11.5px] text-[var(--fg3)]">
            The pipeline unlocks once at least one repo is ready.
          </div>
        </div>

        {/* step content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="shrink-0 border-b px-[26px] pb-4 pt-[22px]">
            <div className="font-mono text-[11px] tracking-[0.04em] text-[var(--fg3)]">
              STEP {idx + 1} / {steps.length}
            </div>
            <h1 className="mb-1 mt-1.5 text-[19px] font-semibold tracking-[-0.02em]">{cur.title}</h1>
            <p className="max-w-[560px] text-[13px] text-muted-foreground">{cur.sub}</p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-[26px] py-[22px]">
            <div key={cur.key} className="animate-enter-soft">
              {cur.key === 'repos' && (
                <ReposStep discovered={discovered} confirmed={confirmed} onToggle={toggleRepo} />
              )}
              {cur.key === 'tracker' && (
                <TrackerStep setup={setup} tracker={tracker} onPick={pickTracker} />
              )}
              {cur.key === 'auth' && <AuthStep setup={setup} tracker={tracker} />}
              {cur.key === 'teams' && (
                <TeamsStep setup={setup} provisioned={teamsProvisioned} onProvisioned={() => setTeamsProvisioned(true)} />
              )}
              {cur.key === 'labels' && (
                <LabelsStep setup={setup} results={labelResults} onResults={setLabelResults} />
              )}
              {cur.key === 'skills' && <SkillsStep setup={setup} />}
              {cur.key === 'docs' && <DocsStep setup={setup} />}
              {cur.key === 'ready' && <ReadyStep setup={setup} wsName={wsName} />}
            </div>
            {error && <div className="mt-3 text-[13px] text-destructive">{error}</div>}
          </div>

          <div className="flex shrink-0 items-center gap-3 border-t px-[26px] py-3.5">
            <Button variant="secondary" size="sm" disabled={idx === 0} onClick={() => goTo(idx - 1)}>
              ← Back
            </Button>
            <span className="flex-1" />
            {!canContinue && <span className="text-[11.5px] text-warning">{hints[cur.key]}</span>}
            <Button
              size="sm"
              disabled={!canContinue}
              className={cn(!canContinue && 'opacity-40 grayscale-[0.3]')}
              onClick={() => (isLastStep ? store.setOnboarding(false) : goTo(idx + 1))}
            >
              {isLastStep ? 'Enter workspace →' : 'Continue'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 24px ok-marker circle: mint ✓ when green, amber ! while pending. */
function OkDot({ ok, size = 24, className }: { ok: boolean; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full text-[11px]',
        ok ? 'bg-primary text-primary-foreground' : 'bg-warning/20 text-warning',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {ok ? '✓' : '!'}
    </span>
  )
}

/** Mono status chip — the wizard's skill / doc-file vocabulary pills. */
function FileChip({ on, children, title }: { on: boolean; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'rounded-full border px-2 py-0.5 font-mono text-[10.5px]',
        on ? 'border-[var(--mint-line)] bg-[var(--mint-tint)] text-primary' : 'border-[var(--border2)] bg-popover text-[var(--fg3)]',
      )}
    >
      {on ? '✓' : '·'} {children}
    </span>
  )
}

/* ---------- 1. Repos: mint checkbox rows over the discovered clones ---------- */

function ReposStep({
  discovered,
  confirmed,
  onToggle,
}: {
  discovered: { name: string; path: string }[]
  confirmed: Set<string>
  onToggle: (name: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {discovered.map((repo) => {
        const on = confirmed.has(repo.name)
        return (
          <label
            key={repo.name}
            className={cn(
              'flex w-full cursor-pointer items-center gap-3 rounded-[11px] border px-3.5 py-3',
              on ? 'border-[var(--mint-line)] bg-[color-mix(in_srgb,var(--mint)_5%,var(--popover))]' : 'bg-popover',
            )}
          >
            <Checkbox
              checked={on}
              onCheckedChange={() => onToggle(repo.name)}
              className="size-[19px] rounded-[6px] border-[1.5px] bg-popover"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[13px]">{repo.name}</span>
              <span className="block truncate text-[11.5px] text-[var(--fg3)]">{repo.path}</span>
            </span>
          </label>
        )
      })}
      {discovered.length === 0 && (
        <span className="text-sm text-muted-foreground">No git clones found in this workspace directory.</span>
      )}
    </div>
  )
}

/* ---------- 2. Tracker: two selectable cards, locked once efforts exist ---------- */

const TRACKERS = [
  {
    key: 'github',
    name: 'GitHub Issues',
    desc: 'Track efforts and tickets as issues across your GitHub repos. Uses the gh CLI you already have.',
    tag: 'recommended',
  },
  {
    key: 'linear',
    name: 'Linear',
    desc: 'Map each repo to a Linear team. Threadmap provisions the label vocabulary and automations.',
    tag: '',
  },
] as const

function TrackerStep({
  setup,
  tracker,
  onPick,
}: {
  setup: SetupStatus
  tracker: 'github' | 'linear' | null
  onPick: (t: 'github' | 'linear') => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3.5" role="radiogroup" aria-label="Issue tracker">
      {TRACKERS.map((t) => {
        const sel = tracker === t.key
        const locked = setup.trackerLocked && setup.tracker !== t.key
        return (
          <button
            key={t.key}
            type="button"
            role="radio"
            aria-checked={sel}
            disabled={locked}
            onClick={() => onPick(t.key)}
            className={cn(
              'flex flex-col rounded-[14px] border-[1.5px] p-4 text-left',
              sel ? 'border-primary bg-[color-mix(in_srgb,var(--mint)_6%,var(--popover))]' : 'bg-popover',
              locked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            )}
          >
            <div className="mb-2.5 flex items-center gap-2.5">
              <span className="flex size-[30px] shrink-0 items-center justify-center rounded-lg border border-[var(--border2)] bg-white">
                {t.key === 'github' ? <GitHubMark /> : <LinearMark />}
              </span>
              <span className="flex-1 text-sm font-semibold text-foreground">{t.name}</span>
              <span
                aria-hidden
                className={cn(
                  'size-4 shrink-0 rounded-full border-[1.5px]',
                  sel ? 'border-primary' : 'border-[var(--border2)]',
                )}
                style={sel ? { background: 'radial-gradient(circle, var(--mint) 0 5px, transparent 5px)' } : undefined}
              />
            </div>
            <p className="m-0 text-[12.5px] text-muted-foreground">{t.desc}</p>
            {t.tag && (
              <span className="mt-2.5 self-start rounded-full border border-[var(--mint-line)] bg-[var(--mint-tint)] px-2 py-0.5 text-[10.5px] text-primary">
                {t.tag}
              </span>
            )}
          </button>
        )
      })}
      <div className="col-span-full mt-0.5 flex items-center gap-[7px] text-[11.5px] text-[var(--fg3)]">
        <span aria-hidden className={cn('size-1.5 rounded-[2px]', setup.trackerLocked ? 'bg-warning' : 'bg-[var(--fg3)]')} />
        {setup.trackerLocked
          ? 'Locked — efforts exist. Create a new workspace to switch trackers.'
          : 'Locked once the first effort exists — create a new workspace to switch trackers.'}
      </div>
    </div>
  )
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="17" height="17" fill="#181717" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

function LinearMark() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="#5E6AD2" aria-hidden>
      <path d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.01c0 3.64-1.62 6.903-4.18 9.105L2.885 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.246-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.28-2.195.313L.008 11.358a12 12 0 0 1 .314-2.195Zm-.19 4.83 9.874 9.875a12.03 12.03 0 0 1-9.874-9.874Z" />
    </svg>
  )
}

/* ---------- 3. Auth: gh re-check / masked Linear key on the ok-card ---------- */

function AuthStep({ setup, tracker }: { setup: SetupStatus; tracker: 'github' | 'linear' | null }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ok = setup.auth.ok

  const checkGh = async () => {
    setBusy(true)
    await store.refreshSetup()
    setBusy(false)
  }

  const saveLinearKey = async () => {
    setBusy(true)
    setError(null)
    const res = await mutateJson('/api/setup/linear/key', 'POST', { apiKey: key })
    if (res.error) {
      setBusy(false)
      return setError(res.error)
    }
    setKey('')
    await store.refreshSetup()
    setBusy(false)
  }

  const title =
    tracker === 'linear'
      ? ok
        ? 'Linear connected'
        : 'Linear API key'
      : ok
        ? 'GitHub authenticated'
        : 'GitHub CLI not authenticated'

  return (
    <div>
      <div
        className={cn(
          'rounded-xl border px-4 py-[15px]',
          ok ? 'border-[var(--mint-line)] bg-[color-mix(in_srgb,var(--mint)_5%,var(--popover))]' : 'bg-popover',
        )}
      >
        <div className="flex items-center gap-2.5">
          <OkDot ok={ok} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">{title}</div>
            <div className="mt-0.5 truncate font-mono text-[11.5px] text-[var(--fg3)]" title={setup.auth.detail}>
              {setup.auth.detail}
            </div>
          </div>
        </div>
        {tracker === 'linear' ? (
          <div className="mt-3.5 flex items-center gap-[9px]">
            <Input
              type="password"
              placeholder="lin_api_…"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="flex-1 bg-background font-mono"
            />
            <Button size="sm" disabled={!key.trim() || busy} onClick={() => void saveLinearKey()}>
              {busy && <Spinner />}
              {busy ? 'Validating…' : ok ? '✓ Connected' : 'Save key'}
            </Button>
          </div>
        ) : (
          <div className="mt-3.5 flex items-center gap-[9px]">
            <code className="rounded-lg border bg-background px-[11px] py-1.5 font-mono text-xs text-muted-foreground">
              gh auth status
            </code>
            <Button size="sm" disabled={busy} onClick={() => void checkGh()}>
              {busy && <Spinner />}
              {ok ? '✓ Connected' : 'Check gh auth'}
            </Button>
          </div>
        )}
        {error && <div className="mt-2 text-[13px] text-destructive">{error}</div>}
      </div>
    </div>
  )
}

/* ---------- 4a. Teams (Linear): repo → team mapping + provision ---------- */

function TeamsStep({
  setup,
  provisioned,
  onProvisioned,
}: {
  setup: SetupStatus
  provisioned: boolean
  onProvisioned: () => void
}) {
  const [teams, setTeams] = useState<LinearTeam[] | null>(null)
  const [newTeam, setNewTeam] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!setup.auth.ok) return
    void fetch('/api/setup/linear/teams')
      .then((r) => r.json())
      .then((data: LinearTeam[] | { error: string }) => (Array.isArray(data) ? setTeams(data) : setError(data.error)))
      .catch((err: unknown) => setError(String(err)))
  }, [setup.auth.ok])

  const taken = new Set(setup.repos.map((r) => r.teamId).filter(Boolean))

  const assign = async (repoName: string, teamId: string) => {
    const repoTeams: Record<string, string> = {}
    for (const r of setup.repos) {
      const v = r.name === repoName ? teamId : r.teamId
      if (v) repoTeams[r.name] = v
    }
    // Team mapping feeds repo readiness — worth the one recompute per pick.
    setError(await store.saveSetupConfig({ linear: { repoTeams } }))
  }

  const create = async () => {
    setBusy(true)
    const res = await mutateJson<LinearTeam>('/api/setup/linear/teams', 'POST', { name: newTeam.trim() })
    setBusy(false)
    if (res.error) return setError(res.error)
    if (res.data) setTeams((prev) => [...(prev ?? []), res.data as LinearTeam])
    setNewTeam('')
  }

  const provision = async () => {
    setBusy(true)
    const teamIds = [...taken].filter((id): id is string => typeof id === 'string')
    const res = await mutateJson('/api/setup/linear/provision', 'POST', { teamIds })
    setBusy(false)
    if (res.error) return setError(res.error)
    onProvisioned()
  }

  return (
    <div className="flex flex-col gap-2.5">
      {setup.repos.map((repo) => {
        const options = teams ?? (repo.teamId ? [{ id: repo.teamId, key: '…', name: 'assigned team' }] : [])
        const items = options.map((t) => ({ value: t.id, label: `${t.name} (${t.key})` }))
        return (
          <div key={repo.name} className="flex items-center gap-3 rounded-[10px] border bg-popover px-3.5 py-[11px]">
            <span className="w-[120px] shrink-0 truncate font-mono text-[12.5px]">{repo.name}</span>
            <Select
              items={items}
              value={repo.teamId ?? ''}
              onValueChange={(v) => void assign(repo.name, String(v ?? ''))}
              disabled={!teams}
            >
              <SelectTrigger size="sm" className="w-full bg-background">
                <SelectValue placeholder="— pick default team —" />
              </SelectTrigger>
              <SelectContent>
                {options.map((t) => (
                  <SelectItem key={t.id} value={t.id} disabled={taken.has(t.id) && repo.teamId !== t.id}>
                    {t.name} ({t.key})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )
      })}
      <div className="mt-0.5 flex items-center gap-2.5">
        <Input
          placeholder="new team name"
          value={newTeam}
          onChange={(e) => setNewTeam(e.target.value)}
          className="w-52"
        />
        <Button variant="secondary" size="sm" disabled={!newTeam.trim() || busy} onClick={() => void create()}>
          + Create team
        </Button>
        <span className="flex-1" />
        <Button size="sm" disabled={taken.size === 0 || busy || provisioned} onClick={() => void provision()}>
          {busy && <Spinner />}
          {provisioned ? '✓ Provisioned' : 'Provision teams'}
        </Button>
      </div>
      <span className="text-[11.5px] text-[var(--fg3)]">
        Creates the label vocabulary + disables auto-close automations.
      </span>
      {error && <div className="text-[13px] text-destructive">{error}</div>}
    </div>
  )
}

/* ---------- 4b. Labels (GitHub): own rail step, the mirror of Teams (#82 hybrid) ---------- */

function LabelsStep({
  setup,
  results,
  onResults,
}: {
  setup: SetupStatus
  results: GitHubProvisionResult[] | null
  onResults: (r: GitHubProvisionResult[]) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const allOk = results !== null && results.every((r) => r.ok)

  const provision = async () => {
    setBusy(true)
    setError(null)
    const res = await mutateJson<{ repos: GitHubProvisionResult[] }>('/api/setup/github/provision', 'POST', {})
    setBusy(false)
    if (res.data?.repos) onResults(res.data.repos)
    else if (res.error) setError(res.error)
  }

  return (
    <div
      className={cn(
        'rounded-xl border px-4 py-[15px]',
        allOk ? 'border-[var(--mint-line)] bg-[color-mix(in_srgb,var(--mint)_5%,var(--popover))]' : 'bg-popover',
      )}
    >
      <div className="flex items-center gap-2.5">
        <OkDot ok={allOk} />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[12.5px]">wayfinder:* · threadmap:*</div>
          <div className="mt-0.5 text-[11.5px] text-[var(--fg3)]">
            {allOk ? 'label vocabulary stamped into every confirmed repo' : 'gh label create, idempotent per repo'}
          </div>
        </div>
        <Button
          size="sm"
          variant={allOk ? 'secondary' : 'default'}
          disabled={busy || setup.repos.length === 0 || !setup.auth.ok || allOk}
          onClick={() => void provision()}
        >
          {busy && <Spinner />}
          {busy ? 'Stamping…' : allOk ? '✓ Provisioned' : 'Provision labels'}
        </Button>
      </div>
      {results && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-dashed border-[var(--border2)] pt-3">
          {results.map((r) => (
            <FileChip key={r.name} on={r.ok} title={r.detail}>
              {r.name}
            </FileChip>
          ))}
        </div>
      )}
      {error && <div className="mt-2 text-[13px] text-destructive">{error}</div>}
    </div>
  )
}

/* ---------- 5. Skills: install card + slash-skill chips, agent escalation ---------- */

function SkillsStep({ setup }: { setup: SetupStatus }) {
  const state = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ok = setup.skills.ok

  const install = async () => {
    setBusy(true)
    setError(null)
    const res = await mutateJson('/api/setup/skills/install', 'POST', {})
    if (res.error) {
      setBusy(false)
      return setError(res.error)
    }
    await store.refreshSetup()
    setBusy(false)
  }

  // Locked hybrid (#82): the rescue session enters the workspace — the wizard
  // is a takeover with nothing behind it; the gear stays amber until finished.
  const escalate = () => {
    const cwd = state.workspace?.root
    if (!cwd) return
    store.startSession({
      cwd,
      prompt: SKILLS_AGENT_PROMPT,
      permissionPolicy: { mode: 'default', intercept: true },
      stage: 'setup',
    })
    store.setOnboarding(false)
  }

  return (
    <div
      className={cn(
        'rounded-xl border px-4 py-[15px]',
        ok ? 'border-[var(--mint-line)] bg-[color-mix(in_srgb,var(--mint)_5%,var(--popover))]' : 'bg-popover',
      )}
    >
      <div className="flex items-center gap-2.5">
        <OkDot ok={ok} />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[12.5px]">mattpocock/skills#{setup.skills.pin}</div>
          <div className="mt-0.5 text-[11.5px] text-[var(--fg3)]">{setup.skills.detail}</div>
        </div>
        <Button size="sm" variant={ok ? 'secondary' : 'default'} disabled={busy || ok} onClick={() => void install()}>
          {busy && <Spinner />}
          {busy ? 'Installing…' : ok ? 'Installed' : 'Install + link'}
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-dashed border-[var(--border2)] pt-3">
        {PIPELINE_STAGES.map((s) => (
          <FileChip key={s.key} on={ok}>
            {s.key}
          </FileChip>
        ))}
      </div>
      {error && (
        <div className="mt-3 flex items-center gap-2.5">
          <span className="min-w-0 flex-1 text-[13px] text-destructive">{error}</span>
          <Button variant="secondary" size="sm" onClick={escalate} title="spawn a Claude Code session to fix the install">
            <Wand2 />
            Let an agent fix it
          </Button>
        </div>
      )}
    </div>
  )
}

/* ---------- 6. Docs: per-repo seed cards; templates expand inline (#82 hybrid) ---------- */

function DocsStep({ setup }: { setup: SetupStatus }) {
  return (
    <div className="flex flex-col gap-3">
      {setup.repos.map((repo) => (
        <RepoDocsCard key={repo.name} repo={repo} />
      ))}
      {setup.repos.length === 0 && (
        <span className="text-sm text-muted-foreground">Confirm at least one repo first.</span>
      )}
    </div>
  )
}

function RepoDocsCard({ repo }: { repo: RepoReadiness }) {
  const [plan, setPlan] = useState<DocPlanEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [landed, setLanded] = useState<string | null>(null)

  const templatesMissing = repo.docs.some((d) => d.source === 'template' && !d.present)
  const agentMissing = repo.docs.some((d) => d.source === 'agent' && !d.present)
  const seeded = repo.docs.every((d) => d.present)

  const loadPlan = async () => {
    setBusy(true)
    const res = await fetch(`/api/setup/docs/plan?repo=${encodeURIComponent(repo.name)}`)
    const data = (await res.json()) as DocPlanEntry[] | { error: string }
    setBusy(false)
    if (Array.isArray(data)) setPlan(data)
    else setError(data.error)
  }

  const apply = async (files: string[]) => {
    setBusy(true)
    setError(null)
    const res = await mutateJson<{ mode: string; prUrl?: string }>('/api/setup/docs/apply', 'POST', {
      repo: repo.name,
      files,
    })
    if (res.error) {
      setBusy(false)
      return setError(res.error)
    }
    setLanded(res.data?.mode === 'pr' ? `PR opened: ${res.data.prUrl}` : 'committed')
    setPlan(null)
    await store.refreshSetup()
    setBusy(false)
  }

  // Same locked hybrid as the skills rescue: seeding runs as a real session,
  // so the wizard hands over to the workspace to watch it.
  const seedWithAgent = () => {
    store.startSession({
      cwd: repo.path,
      prompt: DOC_AGENT_PROMPT,
      permissionPolicy: { mode: 'default', intercept: true },
      stage: 'setup',
    })
    store.setOnboarding(false)
  }

  return (
    <div className="rounded-xl border bg-popover px-3.5 py-3">
      <div className="mb-2 flex items-center gap-2.5">
        <OkDot ok={seeded} size={20} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{repo.name}</span>
        {templatesMissing && !plan && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void loadPlan()}>
            {busy && <Spinner />}
            Review templates
          </Button>
        )}
        <Button variant={agentMissing ? 'default' : 'secondary'} size="sm" disabled={!agentMissing} onClick={seedWithAgent}>
          {agentMissing ? (
            <>
              <Wand2 />
              Seed with agent
            </>
          ) : (
            '✓ Seeded'
          )}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {repo.docs.map((d) => (
          <FileChip key={d.path} on={d.present} title={d.path}>
            {d.path.split('/').pop()}
          </FileChip>
        ))}
      </div>
      {landed && <div className="mt-2 text-[12.5px] text-muted-foreground">{landed}</div>}
      {plan && (
        <div className="mt-2.5 flex flex-col gap-2">
          {plan.map((entry) => (
            <CodeBlock key={entry.path} title={entry.path} meta={entry.action}>
              {entry.proposed}
            </CodeBlock>
          ))}
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || plan.every((e) => e.action === 'unchanged')}
              onClick={() => void apply(plan.filter((e) => e.action !== 'unchanged').map((e) => e.path))}
            >
              Write + commit
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPlan(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && <div className="mt-2 text-[13px] text-destructive">{error}</div>}
    </div>
  )
}

/* ---------- 7. Ready: recap rows + the mint ready-to-work card ---------- */

function ReadyStep({ setup, wsName }: { setup: SetupStatus; wsName: string }) {
  const seededRepos = setup.repos.filter((r) => r.docs.every((d) => d.present))
  const rows = [
    {
      label: 'Repos',
      ok: setup.repos.length > 0,
      detail: `${setup.repos.length} confirmed · ${setup.repos.map((r) => r.name).join(', ')}`,
    },
    {
      label: 'Tracker',
      ok: setup.tracker !== null,
      detail: setup.tracker === 'linear' ? 'Linear' : setup.tracker === 'github' ? 'GitHub Issues' : 'not set',
    },
    { label: 'Auth', ok: setup.auth.ok, detail: setup.auth.detail },
    {
      label: 'Skills',
      ok: setup.skills.ok,
      detail: setup.skills.ok ? `mattpocock/skills ${setup.skills.pin} linked` : setup.skills.detail,
    },
    {
      label: 'Docs',
      ok: seededRepos.length > 0,
      detail:
        seededRepos.length === setup.repos.length && seededRepos.length > 0
          ? 'agent docs seeded in every repo'
          : seededRepos.length > 0
            ? `seeded in ${seededRepos.map((r) => r.name).join(', ')}`
            : 'pending',
    },
  ]
  return (
    <div>
      <div className="mb-5 flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-[11px] rounded-[10px] border bg-popover px-3.5 py-[11px]">
            <OkDot ok={row.ok} />
            <span className="w-[92px] shrink-0 text-[13px] font-medium">{row.label}</span>
            <span className="min-w-0 truncate text-[12.5px] text-muted-foreground" title={row.detail}>
              {row.detail}
            </span>
          </div>
        ))}
      </div>
      {setup.ready && (
        <div className="rounded-xl border border-[var(--mint-line)] bg-[var(--mint-tint)] px-[18px] py-4">
          <div className="text-sm font-semibold text-primary">Ready to work</div>
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">
            {wsName} has a ready repo. Create your first effort and the pipeline takes it from planning to
            code-review.
          </p>
        </div>
      )}
    </div>
  )
}
