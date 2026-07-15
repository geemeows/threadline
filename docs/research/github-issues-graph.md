# GitHub sub-issues, native dependencies, and cross-repo edges via gh/API

Research for [#3](https://github.com/geemeows/threadline/issues/3), part of the Wayfinder map [#1](https://github.com/geemeows/threadline/issues/1).

**Question:** Which GitHub API operations do artifact-derived state and cross-repo efforts rest on, and what are their limits?

Sources: official GitHub REST/GraphQL docs, GitHub's published GraphQL schema (`docs.github.com/public/fpt/schema.docs.graphql`), the `github/rest-api-description` OpenAPI spec, github.blog changelogs — plus empirical verification with `gh api` (gh 2.92.0) against `geemeows/threadline` issues #1–#11, which are wired with sub-issues and dependencies, on 2026-07-15.

## TL;DR

- Sub-issues and native issue dependencies both have first-class REST and GraphQL APIs. The `gh` CLI has **no native subcommands** for either — everything goes through `gh api`.
- Every REST issue payload embeds `sub_issues_summary` **and** `issue_dependencies_summary`, so a plain `GET /issues` list gives sub-issue progress and **open-blocker counts for free** — no per-issue fan-out.
- `issue_dependencies_summary.blocked_by` counts **open** blockers; `total_blocked_by` counts open + closed (per the GraphQL `IssueDependenciesSummary` field descriptions). "Is this issue blocked?" ⇒ `blocked_by > 0`.
- Cross-repo: sub-issues officially span repos in the same owner (Sept 2025 changelog even says cross-org). Dependency edges carry full repo info in their schema, but cross-repo support for dependencies is **not stated in any primary doc** — treat as works-in-UI, verify-before-relying for API writes.
- Rate limits: 5,000 REST req/hr per user, 5,000 GraphQL points/hr. Authorized **GET conditional requests returning 304 are free** (docs + verified empirically); HEAD-based 304s DO count. Webhooks are recommended over polling.
- Deriving pipeline stage from tracker state + spec files + branches + review comments is **viable** with ~2 API round-trips per repo per poll.

## 1. Sub-issues API

### REST endpoints

Docs: <https://docs.github.com/en/rest/issues/sub-issues>

| Operation | Endpoint |
|---|---|
| Get parent | `GET /repos/{owner}/{repo}/issues/{n}/parent` |
| List sub-issues | `GET /repos/{owner}/{repo}/issues/{n}/sub_issues` (`per_page` max 100) |
| Add sub-issue | `POST /repos/{owner}/{repo}/issues/{n}/sub_issues` — body `sub_issue_id` (the child's **database `id`**, not its number) + optional `replace_parent` |
| Remove sub-issue | `DELETE /repos/{owner}/{repo}/issues/{n}/sub_issue` (singular path) — body `sub_issue_id` |
| Reprioritize | `PATCH /repos/{owner}/{repo}/issues/{n}/sub_issues/priority` — body `sub_issue_id` + one of `after_id`/`before_id` |

Empirical (this repo):

```console
$ gh api repos/geemeows/threadline/issues/1/sub_issues --jq '.[].number'
2 3 4 5 6 7 8 9 10 11
$ gh api repos/geemeows/threadline/issues/1 --jq '.sub_issues_summary'
{"completed":0,"percent_completed":0,"total":10}
```

### Limits and cross-repo scope

Product docs (<https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues>): up to **100 sub-issues per parent**, nesting up to **8 levels**; an issue has at most one parent. These limits appear only in the product docs, not the REST reference.

Cross-repo: yes — a sub-issue can live in a different repository than its parent. The OpenAPI spec's `sub_issue_id` description says the sub-issue "must belong to the **same repository owner** as the parent issue," but the later changelog <https://github.blog/changelog/2025-09-11-a-rest-api-for-github-projects-sub-issues-improvements-and-more/> states sub-issues now support **cross-organization** parents. The two conflict (the OpenAPI text likely predates the Sept 2025 change); for threadline's same-owner workspaces the conservative same-owner contract is sufficient either way.

### GraphQL

`Issue.parent`, `Issue.subIssues` (connection), `Issue.subIssuesSummary { total, completed, percentCompleted }`; mutations `addSubIssue` (accepts `subIssueId` or `subIssueUrl`, plus `replaceParent`), `removeSubIssue`, `reprioritizeSubIssue`; timeline events `SubIssueAddedEvent`/`SubIssueRemovedEvent`. Verified live:

```console
$ gh api graphql -f query='query{ repository(owner:"geemeows", name:"threadline"){
    issue(number:3){ parent{number} subIssuesSummary{total completed percentCompleted} } } }'
{"data":{"repository":{"issue":{"parent":{"number":1},...}}}}
```

Reference: <https://docs.github.com/en/graphql/reference/objects#issue>

## 2. Native issue dependencies (blocked-by / blocking)

GA changelog (2025-08-21): <https://github.blog/changelog/2025-08-21-dependencies-on-issues/> — REST + GraphQL + webhook support, and "you can link up to **50 issues for each relationship type**" (50 blocked-by + 50 blocking per issue).

### REST endpoints

Docs: <https://docs.github.com/en/rest/issues/issue-dependencies>

| Operation | Endpoint |
|---|---|
| List blockers | `GET /repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by` |
| Add blocker | `POST .../dependencies/blocked_by` — body `issue_id` (database id of the blocking issue) |
| Remove blocker | `DELETE .../dependencies/blocked_by/{issue_id}` (id in path) |
| List issues this blocks | `GET .../dependencies/blocking` (read-only) |

**All writes go through the `blocked_by` side** — there is no POST/DELETE on `/blocking`. GraphQL mirrors this: only `addBlockedBy` (`blockingIssueId: ID!`) and `removeBlockedBy` mutations exist, plus `BlockedByAddedEvent`/`BlockedByRemovedEvent` timeline items.

Empirical (this repo — #2 blocks #5, #3 blocks #6):

```console
$ gh api repos/geemeows/threadline/issues/5/dependencies/blocked_by --jq '.[].number'
2
$ gh api repos/geemeows/threadline/issues/3/dependencies/blocking --jq '.[].number'
6
```

### Cross-repo scope

**Not documented.** Neither the REST reference, the GA changelog, nor the product docs (<https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies>) state whether dependencies may cross repositories or owners. The response schema supports it — edges are full issue objects with `repository_url` (REST) / `repository { nameWithOwner }` (GraphQL) — and the UI reportedly allows cross-repo selection, but that is not a primary source. An empirical cross-repo write test was deliberately not run (it would mutate a live issue in another repo). **Recommendation: before building cross-repo efforts on native dependencies, run a one-off reversible `POST`/`DELETE` test between two scratch issues in two same-owner repos.**

### Open-blocker counts: `issue_dependencies_summary`

**The key field for a pipeline UI.** Every REST issue payload includes it (confirmed in GitHub's OpenAPI issue schema and empirically):

```console
$ gh api repos/geemeows/threadline/issues/5 --jq '.issue_dependencies_summary'
{"blocked_by":1,"blocking":1,"total_blocked_by":1,"total_blocking":1}
```

Semantics, from the GraphQL `IssueDependenciesSummary` type's field descriptions:

- `blockedBy` — "Count of issues this issue is blocked by" (open only, by contrast with the next field)
- `totalBlockedBy` — "Total count of issues this issue is blocked by **(open and closed)**"
- `blocking` / `totalBlocking` — same pattern in reverse.

So **`issue_dependencies_summary.blocked_by > 0` ⇒ currently blocked**, readable straight off list responses. GraphQL equivalent: `Issue.issueDependenciesSummary { blockedBy totalBlockedBy blocking totalBlocking }`, plus `blockedBy`/`blocking` connections (orderable by `DEPENDENCY_ADDED_AT`):

```console
$ gh api graphql -f query='...issue(number:5){
    issueDependenciesSummary{ blockedBy totalBlockedBy blocking totalBlocking }
    blockedBy(first:5){ nodes{ number repository{nameWithOwner} } } }...'
{"issueDependenciesSummary":{"blockedBy":1,"blocking":1,"totalBlockedBy":1,"totalBlocking":1},
 "blockedBy":{"nodes":[{"number":2,"repository":{"nameWithOwner":"geemeows/threadline"}}]}}
```

There is no field named `blockedByIssuesCount`; `issueDependenciesSummary` is the mechanism.

## 3. gh CLI support

`gh` 2.92.0 (2026-04-28) has **no native `gh issue` subcommands** for sub-issues or dependencies (verified via `gh issue --help`). All graph operations go through `gh api` / `gh api graphql` — raw endpoint knowledge required; threadline should ship its own thin wrapper.

## 4. Rate limits for a polling web UI

REST: <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>

- PAT / OAuth user token: **5,000 req/hr** (verified live: `gh api rate_limit` → `core.limit: 5000`). Unauthenticated: 60/hr.
- GitHub App installation: 5,000/hr base, scaling +50/hr per repo/user beyond 20, **capped at 12,500/hr**; **15,000/hr** only for installations on GitHub Enterprise Cloud orgs.
- Secondary limits: ≤100 concurrent requests; **900 REST points/min** (GET = 1 pt, mutating = 5 pts); ~80 content-generating requests/min; the dependencies POST doc explicitly warns rapid writes can trip secondary limits.
- Search API: 30 req/min — do not poll it.

GraphQL: <https://docs.github.com/en/graphql/overview/rate-limits-and-node-limits-for-the-graphql-api> — **5,000 points/hr** per user (10,000 for Enterprise Cloud); a typical query = 1 point (connections ÷ 100); secondary limit 2,000 points/min; ≤500,000 nodes/query.

### Conditional requests — verified nuance

Docs (<https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api>): a conditional request returning `304` **does not count against the primary rate limit when correctly authorized**. Verified empirically — but with a catch:

- `GET` + `If-None-Match` + `Authorization` → repeated 304s left `x-ratelimit-remaining` **unchanged** (held at 4951 across 3 calls). Free, as documented.
- `HEAD` + `If-None-Match` + `Authorization` → each 304 **decremented** the limit (4959 → 4958 → 4957). HEAD conditional polling is NOT free.

**Design rule: poll with GET + ETag, never HEAD.** A 304-heavy poll loop then costs near-zero quota; full-cost requests happen only when data actually changed.

`X-Poll-Interval` is documented **only for the Events API** (<https://docs.github.com/en/rest/activity/events>); issues/sub-issues/dependencies endpoints have no poll-interval header — ETag conditional polling (or webhooks, which the docs recommend over polling) is the mechanism there.

### Budget math

One `GET /repos/{o}/{r}/issues?state=all&per_page=100` returns up to 100 issues **with both summary rollups inline**. With ETag-based polling, unchanged ticks are free; a 10-repo workspace polled every 30 s costs at most ~1,200 req/hr worst-case (every tick changed) — comfortably inside 5,000. GraphQL can batch 100 issues × (summaries + parent + linkedBranches + PR refs) for ~1 point, making it the right transport when richer per-issue linkage is needed in the loop.

## 5. Stage derivation from tracker state + artifacts: viability

Signals per issue, all confirmed live on this repo:

| Signal | Source | Cost |
|---|---|---|
| Tracker state, triage labels | issue payload | free with poll |
| Parent/child + progress | `sub_issues_summary` / `subIssuesSummary` | free with poll |
| Blocked? (open blockers) | `issue_dependencies_summary.blocked_by` | free with poll |
| Spec files | repo contents API or local git | free locally |
| Work started (branch) | `Issue.linkedBranches { ref { name } }` (GraphQL) or branch-naming convention vs `git branch -r` | batched |
| PR open / merged | `Issue.closedByPullRequestsReferences`, `timelineItems(itemTypes:[CROSS_REFERENCED_EVENT, CONNECTED_EVENT])` | batched |
| Review in progress | linked PR's `reviewThreads` (unresolved count) / `reviews` via GraphQL | batched |

**Verdict: viable.** A stage function like:

```
closed → done
open PR with unresolved review threads → code-review
linked branch (or convention-named branch) exists → implement
spec file committed, no branch → ready-to-implement
issue_dependencies_summary.blocked_by > 0 → blocked (overlay)
else → label-driven (needs-triage / grilling / research / ...)
```

is computable from ~2 round-trips per repo per poll (issues list + one GraphQL batch), plus local git for spec files. Caveats:

- `linkedBranches` only reflects branches linked via GitHub's Development panel; locally created branches need a naming convention (`research/...`, `feat/{issue}-...`) checked against the branches API or `git branch -r`.
- Review detection requires resolving the PR linkage first; unresolved `reviewThreads` is the most reliable "review pending" signal.
- Rollup `*_summary` fields are server-computed and eventually consistent — treat a poll tick's values as possibly a second or two stale.

## Implications for threadline

1. Model effort graphs on native sub-issues + dependencies; no parallel edge store. Same-owner cross-repo works for sub-issues per official docs; run the one-off reversible dependency cross-repo test before relying on it for dependencies.
2. Poll loop: **GET + ETag conditional requests** (free 304s) for the issues list; **GraphQL batches** for branch/PR/review linkage; REST `gh api` for mutations (writes always on the `blocked_by` side, using database `id`s, never issue numbers).
3. "Blocked" badges come from `issue_dependencies_summary.blocked_by` with zero extra requests; sub-issue progress bars from `sub_issues_summary` likewise.
4. Respect secondary limits when wiring graphs in bulk (dependency POSTs can trip abuse detection) — serialize mutations, don't fan out.
5. gh CLI gives no sub-issue/dependency commands — ship documented `gh api` invocations or a wrapper.
