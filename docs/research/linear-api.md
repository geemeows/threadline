# Linear GraphQL API mapped onto threadline's tracker capability set

Companion to [github-issues-graph.md](./github-issues-graph.md) (branch `research/github-issues-graph`), which established the GitHub mechanism per capability. This document maps each capability onto Linear and flags where the TrackerAdapter seam bends or breaks.

**Question:** Can Linear's GraphQL API support the same TrackerAdapter capability set as GitHub Issues — effort graphs via sub-issues, native blocking, two label namespaces, closed-as-approval gates, multi-repo routing, and cheap derived-state polling — and where do the two trackers diverge?

Sources: official Linear developer docs (`linear.app/developers/*`), Linear product docs (`linear.app/docs/*`), Linear changelog, and Linear's published GraphQL SDL (`github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql`, 49,471 lines, fetched 2026-07-16). Schema claims were cross-checked against live unauthenticated introspection of `https://api.linear.app/graphql` (works without a token — verified 2026-07-16). **No Linear API key was available**, so no authenticated reads/writes were run; anything not verifiable from docs + schema is explicitly marked *unverified empirically*.

## TL;DR

- Every capability threadline needs exists in Linear, but the shapes differ enough that the adapter cannot be a thin field-rename layer. The three real divergences: **no repo concept** (teams own issues), **no server-computed rollup summaries** (no `sub_issues_summary` / `blocked_by` count equivalents — but the filter language compensates), and **no free conditional polling** (no ETag/304 mechanism; every poll costs quota).
- One place Linear is *stronger*: `IssueFilter` supports `parent`, `assignee: {null}`, `hasBlockedByRelations`, and state filters in a single query — the **frontier query (open + unblocked + unassigned children) runs server-side in one call**, which GitHub cannot do.
- Label groups enforce **one label per group per issue** — a perfect fit for `wayfinder:*` (issue kinds are mutually exclusive) and a trap for `threadline:*` (stamps can coexist; must stay flat labels).
- "Closed" is not a boolean: issues live in per-team `WorkflowState`s typed `triage/backlog/unstarted/started/completed/canceled` (+`duplicate` in the schema). Closed-as-approval maps to `state.type == "completed"` / `completedAt != null`; `canceled` is the `wontfix` analog.
- Team-level **auto-close automations** (parent done ⇒ children done, all children done ⇒ parent done) can fire tracker-side state changes threadline didn't make — a gate-integrity hazard GitHub doesn't have.

## Comparison table

| Capability | Linear primitive | GitHub primitive (baseline) | Delta |
|---|---|---|---|
| Effort/child edge | `Issue.parent` / `Issue.children`; `parentId` on create/update | Sub-issues API; `addSubIssue` | Linear: no documented count/depth limits (GitHub: 100/parent, 8 levels); cross-team allowed (GitHub: same-owner/cross-org) |
| Child progress rollup | **None on `Issue`** — count children yourself | `sub_issues_summary {total, completed, percent_completed}` free in every payload | Linear adapter must aggregate |
| Blocking edge | `IssueRelation` with `type: blocks` via `issueRelationCreate` | Dependencies API, writes on `blocked_by` side | Linear accepts human identifiers (`LIN-123`); GitHub demands database ids |
| "Is blocked?" | `IssueFilter.hasBlockedByRelations` (existence only) + docs say resolved blockers recategorize to *Related* | `issue_dependencies_summary.blocked_by > 0` (open-only count, free) | No count field in Linear; semantics shift on resolve |
| Labels | Workspace labels (`team: null`) + team labels + label groups (`isGroup`) | Flat per-repo labels, free-form names | Groups add one-per-issue exclusivity; `:`/`/` in UI creation syntax auto-creates groups |
| Closed-as-approval | `state.type == "completed"` (`completedAt` set) vs `canceled` (`canceledAt`) | `state: closed` + `state_reason: completed / not_planned` | Same two-flavor model, but Linear's "closed" is a per-team state id, not a global verb |
| Repo routing | **No repo concept** — `team: Team!` (exactly one); GitHub repos attach via integration/attachments | Issues live in repos natively | Adapter must map repo → team (or labels) |
| Change detection | Poll `issues(filter: {updatedAt: {gt: $since}})`, or webhooks (public HTTPS URL required) | GET + ETag, 304s free; webhooks | No conditional-request equivalent; polls always cost quota |
| Rate limits | API key: 2,500 req/hr + 3M complexity pts/hr; OAuth: 5,000 req/hr + 2M pts/hr; single query ≤ 10,000 pts | 5,000 REST req/hr; 5,000 GraphQL pts/hr | Comparable headroom; Linear returns **HTTP 400 `RATELIMITED`**, not 429/403 |
| Auth for a local CLI | Personal API key, `Authorization: <key>` (no Bearer); OAuth2 + PKCE with localhost redirect | `gh` CLI stored OAuth token | No official Linear CLI — community tools only |
| Stable issue identity | UUID `id`; `identifier` (ENG-123) **changes on team moves** (`previousIdentifiers`) | `owner/repo#number` stable; database `id` | Adapter must key on UUID |

## 1. Parent / sub-issues

Schema: `Issue.parent: Issue` and `Issue.children: IssueConnection` (default page size 50); `IssueCreateInput.parentId` / `IssueUpdateInput.parentId` set the edge; `Issue.sortOrder` doc: "The order of the item in the sub-issue list. Only set if the issue has a parent." (SDL, verified by introspection.)

- **Limits:** No sub-issue count or nesting-depth limit appears anywhere in the product docs (<https://linear.app/docs/parent-and-sub-issues>), changelog (<https://linear.app/changelog/2022-06-30-sub-issues-improvements>), or schema. Contrast GitHub's documented 100 sub-issues/parent, 8 levels (baseline §1). *Depth behavior unverified empirically.*
- **Cross-team:** explicitly allowed — "Sub-issues can be assigned to any team or member in the workspace, not just the parent issue's team" (<https://linear.app/docs/teams>). At creation they default to inheriting "the parent issue's team, priority, and project" (<https://linear.app/docs/parent-and-sub-issues>). This is *broader* than GitHub's same-owner contract and covers threadline's multi-repo (multi-team) efforts natively.
- **No rollup:** the `Issue` type has **no** progress/summary field (grepped the full SDL; `progress` exists on `Cycle`/`Project` only). GitHub's free `sub_issues_summary` has no equivalent — the adapter derives progress by querying `children` (filterable, so `children(filter: {completedAt: {null: false}})`-style counting is one call, but not zero calls).
- **Auto-close automations:** optional team settings — "When the parent issue is marked as done, all remaining sub-issues will also be marked as done" and the inverse (parent auto-closes when all children complete) (<https://linear.app/docs/parent-and-sub-issues>, <https://linear.app/changelog/2024-09-06-auto-close-parent-and-sub-issues>). See §9 — this can forge threadline's closed-as-approval signal.

## 2. Blocking relations

Schema: `type IssueRelation { issue: Issue!, relatedIssue: Issue!, type: String! }` with `enum IssueRelationType { blocks, duplicate, related, similar }`. Direction: `issue` *blocks* `relatedIssue` ("The source issue whose relationship is being described. This is the issue from which the relation originates.").

- **Create:** `issueRelationCreate(input: {issueId, relatedIssueId, type: blocks})` — both ids accept "a UUID or issue identifier (e.g., 'LIN-123')" (SDL input docs). Friendlier than GitHub, where writes require the child's database `id` (baseline §2).
- **Query:** `Issue.relations` (outgoing) and `Issue.inverseRelations` ("Inverse relations associated with this issue") — blocked-by = inverse relations of type `blocks`.
- **Open-blocker summary: none.** There is no analog of GitHub's `issue_dependencies_summary.blocked_by` open-blocker count. The closest is the filter predicate `IssueFilter.hasBlockedByRelations: RelationExistsComparator` (SDL lines ~16994/17798) — a boolean existence test usable in queries, not a count, and not documented as open-only.
- **However**, product docs state: "Once the blocking issue has been resolved, the relationship moves under *Related*" (<https://linear.app/docs/issue-relations>). If that recategorization is materialized in the API (relation `type` mutating from `blocks` to `related`), then relation existence ≈ open-blocker existence and `hasBlockedByRelations: {eq: false}` is exactly threadline's "unblocked" predicate. *Whether the API mutates the stored relation type (vs UI-only display) is unverified empirically — test with a key before relying on it; the fallback is joining blocker `state.type` yourself.*
- **Limits:** GitHub caps at 50 per relationship type (baseline §2); no limit documented for Linear.
- **Cross-team relations:** not addressed in docs; the schema imposes no team constraint on `relatedIssueId`, and since sub-issues officially cross teams, relations presumably do too — *unverified empirically*.

## 3. Labels and the two namespaces

Schema: `IssueLabel { name, team: Team, parent: IssueLabel, isGroup: Boolean!, inheritedFrom }`; `issueLabelCreate(input: {name!, teamId?, parentId?, isGroup?, color?, description?})`. "The team that the label is scoped to. If null, the label is a workspace-level label available to all teams" (SDL).

- **Workspace vs team:** workspace labels are visible to all teams; team labels only within the team; sub-teams inherit parent-team labels (<https://linear.app/docs/labels>). For a multi-team (multi-repo) workspace, threadline's vocabulary should be **workspace-level** so every routed ticket sees the same labels.
- **Label groups:** one nesting level; the group label itself "cannot be directly applied to issues" (`isGroup` SDL doc); **"Only one label from a given label group can be applied to an issue at a time"** (<https://linear.app/docs/labels>; groups introduced <https://linear.app/changelog/2022-11-10-label-groups>) — verified as asked. Max 250 labels per group.
- **Colons in names:** the UI's label-creation syntax treats `group/label` **and `group:label`** as "create group + child label" (<https://linear.app/docs/labels>) — so typing `wayfinder:map` in the UI creates group `wayfinder` with child `map`, not a flat label named `wayfinder:map`. Whether `issueLabelCreate(name: "wayfinder:map")` via API stores the literal colon name or is rejected/split is **not documented and unverified empirically**. Reserved names exist (`assignee`, `cycle`, `estimate`, `priority`, `state`, `status`, …) but don't collide with threadline's vocabulary.
- **Fit:**
  - `wayfinder:*` — the kinds (`map`, `research`, `prototype`, `grilling`, `task`) are mutually exclusive per issue, so a **label group `wayfinder`** is the idiomatic model; the one-per-group rule *enforces* the invariant GitHub merely hopes for.
  - `threadline:*` — `spec`, `ticketed`, and `override:<stage>` stamps are not mutually exclusive (an issue can plausibly carry `ticketed` plus an override), so a group would **break writes** with a constraint GitHub doesn't have. Model these as **flat workspace labels**, prefixed in the name only if the API accepts colons (else `threadline-spec` style).

## 4. Workflow states — what "closed" means

Schema: `Issue.state: WorkflowState!`; `WorkflowState.type: String!` — "One of \"triage\", \"backlog\", \"unstarted\", \"started\", \"completed\", \"canceled\", \"duplicate\"" (SDL; note the schema lists `duplicate`, one more than the six the guides mention). States are **per team** ("Each team has its own set of workflow states") with arbitrary names (`In QA`, `Done`, …) and can be inherited from parent teams (`inheritedFrom`).

- **Closed-as-approval** = moving to any state with `type == "completed"`. Detection: `state.type == "completed"` or `Issue.completedAt != null` ("The time at which the issue was moved into completed state." — SDL).
- **Canceled** (`canceledAt != null`) is the analog of GitHub's `state_reason: not_planned` / threadline's `wontfix`. Generic "closed" = `completedAt != null || canceledAt != null` — but threadline's gates should treat only `completed` as approval.
- **Write asymmetry vs GitHub:** GitHub has a global `state: closed` verb; Linear closes by `issueUpdate(input: {stateId})` where `stateId` is a **team-specific UUID**. The adapter must resolve, per team, "the state whose `type` is `completed`" (there can be several — e.g. `Done` and `Shipped`; pick by lowest `position` or by convention) before it can "close" anything.
- Also relevant: `Issue.stateHistory` exposes state transitions over time (SDL) — an audit trail GitHub only offers via timeline events.

## 5. Teams / projects vs repos

"Every issue must belong to exactly one team, which determines the available workflow states, labels, and other team-specific configuration" (SDL `Issue.team` doc). Teams are the container primitive; projects are cross-team groupings; **there is no repository concept**.

- **Mapping for to-tickets routing:** the faithful analog of "owning repo" is **team-per-repo**. This aligns with the GitHub integration's hard constraint — "only one repo can be configured for two-way sync at a time" per team (<https://linear.app/docs/github>) — and with per-team identifiers (`ENG-123`) mirroring per-repo numbering. A project-per-effort overlay is optional (efforts are already modeled as parent issues; Linear's own changelog notes sub-issue trees can be "converted to a project," an alternative shape threadline doesn't need).
- **Referencing external repos:** Linear's GitHub integration links PRs/commits/branches to issues via branch names containing the issue identifier and magic words ("Fixes ENG-123", closing vs non-closing keywords) (<https://linear.app/docs/github>). Linked PRs surface as **`Attachment`s** on the issue (`Attachment { url, title, subtitle, sourceType, metadata }`), and the API exposes purpose-built mutations `attachmentLinkGitHubPR`, `attachmentLinkGitHubIssue`, and generic `attachmentLinkURL` (SDL) — so "every ticket has a PR" is checkable by scanning attachments, and writable without the integration.
- **PR-driven automation:** by default the integration moves linked issues to In Progress when a PR opens and Done when it merges, customizable per team/branch (<https://linear.app/docs/github>) — this can *implement* part of threadline's pipeline, or fight it (§9).

## 6. Webhooks vs polling for a local tool

- **Webhooks** (<https://linear.app/developers/webhooks>): cover issues, comments, labels, attachments, projects, etc.; payloads carry `action` (create/update/remove), `data`, `updatedFrom` (previous values), HMAC-SHA256 `Linear-Signature`; retries 3× (1 min / 1 hr / 6 hr) then possible auto-disable. **They require "a publicly accessible HTTPS, non-localhost URL"** — a localhost npx tool cannot receive them without a tunnel. Same conclusion as GitHub baseline: webhooks are out for threadline's local mode.
- **Polling:** there is **no ETag / conditional-request mechanism** — the GraphQL guide (<https://linear.app/developers/graphql>) documents none, and everything is POST to a single endpoint, so GitHub's free-304 trick (baseline §4) has no Linear equivalent. Every poll tick costs requests + complexity.
- **Recommended pattern** (from the same guide): never poll issues individually ("There should never be a reason to do this and your application might get rate limited"); instead poll a **delta query** ordered/filtered by `updatedAt` — i.e. `issues(filter: {updatedAt: {gt: $lastSync}}, orderBy: updatedAt)`. Since the adapter derives state, a poll loop of one delta query per workspace (not per repo/team — filters span teams) is the shape. `IssueFilter`'s expressiveness helps a lot: `parent`, `assignee: {null: true}`, `hasBlockedByRelations: {eq: false}`, `state: {type: {…}}`, `labels`, `team`, `children`, `completedAt: {null: true}` all verified present in the SDL — the **frontier query is a single server-side call**, something GitHub needs client-side assembly for.
- Budget check: a 100-issue delta query with a handful of objects each is on the order of a few hundred complexity points (0.1/property, 1/object, connections × page size — §7); at a 30 s tick that's ~120 requests/hr and well under the 3M point budget, but unlike GitHub it never rounds down to free.

## 7. Rate limits

Source: <https://linear.app/developers/rate-limiting> (all numbers verbatim).

| Auth mode | Requests/hr | Complexity points/hr |
|---|---|---|
| Personal API key | 2,500 per user | 3,000,000 per user |
| OAuth app | 5,000 per user (or app user) | 2,000,000 per user |
| Unauthenticated | 600 per IP | 100,000 per IP |

- **Single-query hard cap: 10,000 points.** Complexity: each scalar property 0.1 pt, each object 1 pt, connections multiply child complexity by page size (default 50), rounded up. Deeply nested `children { relations { relatedIssue … } }` queries multiply fast — keep pages small and explicit.
- **Headers:** `X-RateLimit-Requests-{Limit,Remaining,Reset}`, per-endpoint `X-RateLimit-Endpoint-*`, and `X-Complexity` / `X-RateLimit-Complexity-{Limit,Remaining,Reset}`.
- **On breach: HTTP 400** with `RATELIMITED` in the error extensions — *not* 429 (GitHub uses 403/429). Adapter retry logic must special-case this.
- Compare GitHub: 5,000 REST req/hr + 5,000 GraphQL pts/hr, with free conditional 304s (baseline §4). Effective polling headroom is similar; Linear's per-query complexity cap replaces GitHub's node limits.

## 8. Auth for a local npx CLI

Source: <https://linear.app/developers/graphql>, <https://linear.app/developers/oauth-2-0-authentication>.

- **Personal API key:** created under Settings → Security & access; sent as `Authorization: <API_KEY>` — **no `Bearer` prefix** (OAuth tokens *do* use `Bearer`). Simplest for a single-user local tool; equivalent to `gh auth login`'s stored token, but threadline must store it itself (env var / keychain) — there is no official CLI providing shared credential storage.
- **OAuth 2:** authorization-code flow with **PKCE support**; localhost redirect URLs are fine (docs use `http://localhost:3000/oauth/callback`). Scopes: `read` (default), `write`, `issues:create`, `comments:create`, `timeSchedule:write`, `admin`, plus agent-oriented `app:assignable`/`app:mentionable` and an `actor=app` mode where resources are created as the app rather than the user. Access tokens last 24 h with refresh tokens (all apps migrated to refresh tokens 2026-04-01); client-credentials tokens (server-to-server) last 30 days. OAuth is what a distributed threadline should ship eventually (`write` scope covers the adapter's needs); an API key is fine for v1.
- **No official `linear` CLI exists** (searched 2026-07-16; only community tools — e.g. [schpet/linear-cli](https://github.com/schpet/linear-cli), [evangodon/linear-cli](https://github.com/evangodon/linear-cli)). Same conclusion as `gh` (baseline §3): threadline ships its own thin client; here it's GraphQL calls rather than `gh api` wrappers, with the upside that unauthenticated introspection makes codegen/typing trivial.

## 9. Adapter implications — where the seam bends or breaks

1. **No repo concept (breaks the routing vocabulary).** The adapter's "owning repo" parameter must become tracker-generic ("routing target"): repo on GitHub, team on Linear. Team-per-repo is the recommended Linear mapping; the repo↔team table lives in threadline config. Ticket→code linkage (branch naming with `ENG-123` identifiers, PR attachments) replaces GitHub's same-graph PR references.
2. **Identity: use UUIDs.** `identifier` (ENG-123) mutates when an issue moves teams (`Issue.previousIdentifiers` exists precisely for this — SDL). GitHub's `owner/repo#number` is stable; Linear's stable key is the UUID `id`. The adapter's issue handle must be an opaque tracker-native id, never a display number.
3. **No rollup summaries; richer filters instead.** GitHub gives `sub_issues_summary` + `issue_dependencies_summary.blocked_by` free in list payloads; Linear gives neither, but its `IssueFilter` runs the frontier predicate (open ∧ unblocked ∧ unassigned ∧ child-of-X) **server-side in one query**. The adapter interface should therefore expose *queries* ("frontier(effort)", "isBlocked(issue)") rather than *summary fields* — GitHub implements them from summaries, Linear from filters.
4. **Closing is a per-team state write, and it comes in two flavors.** `close(issue)` must resolve a team-specific `completed`-type `stateId` first; `completed` = approval, `canceled` = wontfix. Detection: `completedAt`/`canceledAt`, never a boolean `closed`.
5. **Tracker-side automations can forge approval signals.** Linear's team automations (parent done ⇒ children done; all children done ⇒ parent done) and the GitHub integration's PR-merge ⇒ Done can transition issues without a human "approval" act. threadline's gates treat closing as approval — on Linear those automations must be **audited/disabled on threadline-managed teams**, or gates must distinguish actor (webhook `actor` field / `Issue.stateHistory`). GitHub has no equivalent auto-close-children hazard.
6. **Blocked semantics differ.** GitHub: open-blocker *count*, closed blockers still enumerable (`total_blocked_by`). Linear: relation existence, and docs say resolved blocking relations recategorize to *Related* — history of past blockers may be lossy, and "blocked" checks should use `hasBlockedByRelations` (verify the recategorization behavior empirically before shipping; fallback = join blocker state).
7. **Label namespaces need two models.** `wayfinder:*` → label group (gains enforced exclusivity); `threadline:*` → flat workspace labels (a group's one-per-issue rule would reject coexisting stamps). Whether a literal `:` survives in an API-created label name is unverified — the adapter should treat namespace rendering (`wayfinder:map` vs group `wayfinder`→`map`) as tracker-specific presentation over an abstract `(namespace, value)` pair.
8. **Polling always costs quota.** No ETag/304 equivalent; the poll loop is an `updatedAt`-delta query. Cheap in practice (well under 3M pts/hr) but the adapter's "unchanged tick is free" assumption from GitHub does not port; budget and backoff must be per-tracker. Rate-limit breach is HTTP 400 `RATELIMITED`, not 429.
9. **Nicer ergonomics to exploit:** relation/parent writes accept human identifiers (`LIN-123`); unauthenticated introspection enables generated types; `updatedFrom` in webhook payloads and `stateHistory` on issues give audit trails GitHub lacks; no documented sub-issue count/depth or dependency-count limits (GitHub: 100/8/50).
