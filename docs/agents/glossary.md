# Glossary

The **domain** vocabulary — Workspace, Repo, Effort, Ticket, Spec, Stage, Gate,
Override, Session, and the rest — lives in [`CONTEXT.md`](../../CONTEXT.md) at the
repo root. That is the authoritative source; use its terms (and honour its
_Avoid_ notes) in issue titles, hypotheses, and test names.

This file records the **technical / architectural** terms that appear across the
codebase but aren't domain nouns. When you read code and hit one of these, this
is what it means here.

## Architecture

**Tracker (`TrackerAdapter` seam)**
The one issue backend a Workspace binds to — GitHub Issues or Linear — behind the
`TrackerAdapter` interface (`src/tracker/types.ts`). Reads are question-shaped
(the gate questions themselves); writes are the pipeline's intent verbs. Tracker
differences (db-id lookups, stateId resolution, label spelling, rate pacing) live
inside adapters and never leak above the seam. Trackers are never mixed within an
Effort (ADR-0001).

**Tracker is the database**
There is no state DB. All pipeline state is _derived_ from tracker + git
artifacts. An Effort *is* its map issue; `home-repo#number` is its id. See
ADR-0001. `~/.threadmap` holds only ephemeral session data and a pointer cache,
never authoritative state.

**Derivation (`deriveStage`)**
`src/gating/derive.ts` — pure, no I/O, no clocks. Given `GateInputs`, it computes
the current `StageSnapshot`. Because nothing sets the Stage directly, it can never
drift (ADR-0002).

**GateInputs / StageSnapshot / GateStatus**
The gating value types (`src/gating/types.ts`). `GateInputs` is everything the
pure derivation needs, gathered once per compute. `StageSnapshot` is the result:
current stage, per-gate status, per-ticket view, `readyToComplete`, and
non-blocking `warnings`.

**Label namespace**
Planning children (`wayfinder:*`) and implementation tickets (`threadmap:ticket`)
are distinguished by label prefix so one issues query can count them separately
(ADR-0002).

**Stamp**
A logical label name on the map issue that the pipeline reads or writes —
`ticketed` (the human to-tickets sign-off), `override:<stage>`, etc. Adapters
translate logical names to each tracker's real label spelling.

**Trunk (effort trunk)**
The integration branch a ticket's PR targets — not `main` (#11). PR ↔ ticket
linkage lives _above_ the tracker seam (`PRSource`, `src/gating/types.ts`),
because PRs are on GitHub even in Linear workspaces, and is matched by the
ticket-id branch-naming convention (#26).

**Warning (Needs-you notice)**
An advisory flag surfaced in the UI (pill / inbox item) that never blocks a gate —
e.g. a PR body missing its `Ticket: #<n>` reference (#26), or a PR merged with an
agent verdict still `request-changes` (#41). See `collectWarnings` in
`src/gating/derive.ts`.

**Agent verdict**
The latest advisory review outcome (`approve` | `request-changes`) parsed from a
PR review's first `Verdict:` line (#41). Purely advisory — never consumed by a gate.

**Override**
`override:<stage>` stamp on the map issue that makes a Gate count as passed
without its condition being met, paired with a structured audit comment. See
`overrideStamp` (`src/gating/derive.ts`) and the domain entry in CONTEXT.md.

## Setup

**Readiness / Setup**
Per-repo prerequisites that gate Effort creation: skills installed and per-repo
agent docs present (`src/setup/`). A property of a Repo, not a pipeline stage
(ADR-0002).

**Exec (`Exec` seam)**
The single injectable shape for every external command setup runs — `gh`, `git`,
`npx` (`src/setup/exec.ts`). Throws on non-zero exit with stderr in the message so
checks can surface the real failure; times out so a hung child never wedges the
wizard.

**REQUIRED_DOCS / template-stamped vs agent-seeded**
The docs readiness set (`src/setup/docs.ts`). `issue-tracker.md` and
`docs/adr/template.md` are stamped from string templates by plain code;
`CONTEXT.md`, `docs/agents/glossary.md`, and `docs/agents/coding-standards.md`
are seeded by one Claude Code session per repo (this file is one such output).

**Doc plan (`create` / `unchanged` / `differs`)**
`planDocs` marks each required doc against what's on disk; apply only writes what
the user picked and never overwrites silently. Direct commit to the current
branch, with an automatic PR fallback (`tm/setup/agent-docs`) when a push is
rejected by branch protection.

**Skills pin**
`mattpocock/skills#<SKILLS_PIN>` (`src/setup/skills.ts`) — installed once into the
machine-global `~/.agents/skills`, then symlinked into each agent's user-level
skills dir (copy-fallback where symlinks fail). Baked into the release; upgrading
the package bumps the pin.

## Adding a term

If a domain concept you need isn't in CONTEXT.md's Language section, that's a
signal — either you're inventing vocabulary the project doesn't use, or there's a
real gap for `/domain-modeling` to resolve. Don't quietly coin a synonym.
