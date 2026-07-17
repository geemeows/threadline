// Implement-session prompt fragments and the trunk→main PR body (#26).
// Pure composition helpers — the session-launch pipeline wires them in when
// it starts implement sessions and opens the effort's landing PR. GitHub
// closing keywords only fire on default-branch merges, so ticket PRs carry a
// plain `Ticket: #<n>` reference and the trunk→main PR aggregates the
// `Closes #<n>` lines that actually close tickets.

import type { TicketRef } from '../tracker/types.js'
import { githubIssueNumber, ticketIdToken, trunkBranch } from '../gating/branches.js'

/**
 * Branch/commit/PR instructions injected into every implement-session prompt.
 * The session infers `<type>` and freezes `<context>` — tooling never reads
 * either; only the `<ticket-id>` segment is matched by gating.
 */
export function implementSessionInstructions(ticket: TicketRef, effort: TicketRef): string {
  const trunk = trunkBranch(effort)
  const id = ticketIdToken(ticket)
  const issue = githubIssueNumber(ticket)
  const ticketLine =
    issue !== null
      ? `- The PR body must include the line \`Ticket: #${issue}\` so the ticket links to its PR.`
      : `- The branch name carries the ticket key (\`${id}\`) — Linear attaches the PR automatically.`
  return [
    `## Branch & PR conventions`,
    ``,
    `- Work on a branch named \`tm/<type>/${id}-<context>\`:`,
    `  - \`<type>\`: infer from the ticket — one of feat, fix, chore, docs, refactor, test, ci.`,
    `  - \`<context>\`: a short lowercase-kebab slug of the ticket title, chosen once at branch creation.`,
    `- Write commits in Conventional Commits format (\`<type>(<scope>): <subject>\`).`,
    `- Open the pull request against \`${trunk}\` (the effort trunk), never the default branch.`,
    ticketLine,
    `- Do not put \`Closes #<n>\` in the PR body — tickets close when the effort lands on main.`,
  ].join('\n')
}

/**
 * Body of the threadmap-composed trunk→main landing PR: one `Closes #<n>` per
 * GitHub ticket (fires on the default-branch merge), a plain listing for
 * Linear tickets (their closure is human approval, per #18/#19).
 */
export function trunkToMainPrBody(effort: TicketRef, tickets: TicketRef[]): string {
  const lines = tickets.map((t) => {
    const issue = githubIssueNumber(t)
    return issue !== null ? `Closes #${issue}` : `- ${t.display} (${t.url})`
  })
  return [`Lands effort ${effort.display} (${effort.url}).`, ``, ...lines].join('\n')
}
