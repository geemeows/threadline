import { describe, expect, it } from 'vitest'
import { reviewSessionInstructions } from './review-prompt.js'

describe('reviewSessionInstructions', () => {
  it('instructs a COMMENTED review with the exact Verdict first line', () => {
    const text = reviewSessionInstructions(7)
    expect(text).toContain('gh pr review 7 --comment')
    expect(text).toContain('Verdict: approve')
    expect(text).toContain('Verdict: request-changes')
    expect(text).toContain('first line')
    expect(text).toContain('advisory')
  })

  it('falls back to a placeholder when the PR number is not yet known', () => {
    expect(reviewSessionInstructions()).toContain('gh pr review <pr-number> --comment')
  })
})
