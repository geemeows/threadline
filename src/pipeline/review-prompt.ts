// Review-session prompt fragment (#41). Pure composition helper, same pattern
// as implement-prompt.ts — the session-launch pipeline wires it in when it
// starts code-review sessions. Human merge stays the sole formal approval;
// the verdict is a structured advisory carried on a COMMENTED review, which
// GitHub permits even on self-authored PRs.

/**
 * Verdict instructions injected into every code-review-session prompt. The
 * `Verdict:` first line is what gating parses (latest verdict wins), so its
 * shape is exact; the prose review follows it on the same review body.
 */
export function reviewSessionInstructions(prNumber?: number): string {
  const target = prNumber !== undefined ? `${prNumber}` : '<pr-number>'
  return [
    `## Recording your verdict`,
    ``,
    `When the review is complete, post it as one PR review comment:`,
    ``,
    '```',
    `gh pr review ${target} --comment --body "<review>"`,
    '```',
    ``,
    `- The body's **first line** must be exactly \`Verdict: approve\` or \`Verdict: request-changes\` — nothing else on that line.`,
    `- The full prose review follows from the second line onward.`,
    `- The verdict is advisory: it never merges or blocks anything itself — a human clicks every merge.`,
    `- If you re-review after fixes, post a fresh review the same way; the latest verdict supersedes earlier ones.`,
  ].join('\n')
}
