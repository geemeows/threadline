import { describe, expect, it } from 'vitest'
import type { TicketRef } from '../tracker/types.js'
import { githubIssueNumber, ticketBranchPattern, ticketIdToken } from './branches.js'

function ref(id: string, display = id): TicketRef {
  return { id, display, url: `https://example.test/${id}` }
}

describe('ticketIdToken', () => {
  it('uses the bare issue number for GitHub, the display key for Linear', () => {
    expect(githubIssueNumber(ref('o/repo#42'))).toBe(42)
    expect(githubIssueNumber(ref('uuid-abc', 'FE-123'))).toBeNull()
    expect(ticketIdToken(ref('o/repo#42'))).toBe('42')
    expect(ticketIdToken(ref('uuid-abc', 'FE-123'))).toBe('FE-123')
  })
})

describe('ticketBranchPattern', () => {
  const gh = ticketBranchPattern(ref('o/repo#123'))
  const linear = ticketBranchPattern(ref('uuid-abc', 'FE-123'))

  it('matches with or without a context slug, any type, case-insensitively', () => {
    expect(gh.test('tm/feat/123-add-thing')).toBe(true)
    expect(gh.test('tm/fix/123')).toBe(true)
    expect(gh.test('TM/Feat/123-X')).toBe(true)
    expect(linear.test('tm/feat/FE-123-add-thing')).toBe(true)
    expect(linear.test('tm/chore/fe-123')).toBe(true)
  })

  it('does not match a longer id sharing the prefix (123 vs 1234)', () => {
    expect(gh.test('tm/feat/1234-add-thing')).toBe(false)
    expect(gh.test('tm/feat/1234')).toBe(false)
    expect(linear.test('tm/feat/fe-1234-x')).toBe(false)
  })

  it('does not cross GitHub/Linear id shapes (fe-123 vs 123)', () => {
    expect(gh.test('tm/feat/fe-123-add-thing')).toBe(false)
    expect(linear.test('tm/feat/123-add-thing')).toBe(false)
  })

  it('anchors to the tm/ namespace and the type segment', () => {
    expect(gh.test('feat/123-add-thing')).toBe(false)
    expect(gh.test('tm/123-add-thing')).toBe(false)
    expect(gh.test('tl/feat/123-add-thing')).toBe(false)
    expect(gh.test('x-tm/feat/123')).toBe(false)
  })
})
