import { describe, expect, it } from 'vitest'
import type { TicketRef } from '../tracker/types.js'
import { implementSessionInstructions, trunkToMainPrBody } from './implement-prompt.js'

function ref(id: string, display = id): TicketRef {
  return { id, display, url: `https://example.test/${id}` }
}

const effort = ref('o/home#1', 'o/home#1')

describe('implementSessionInstructions', () => {
  it('instructs the tm/ branch shape, trunk base, and Ticket reference for GitHub', () => {
    const text = implementSessionInstructions(ref('o/repo#42'), effort)
    expect(text).toContain('tm/<type>/42-<context>')
    expect(text).toContain('tm/effort/1')
    expect(text).toContain('Conventional Commits')
    expect(text).toContain('Ticket: #42')
    expect(text).not.toContain('Closes #42')
  })

  it('relies on branch auto-attach for Linear instead of a Ticket line', () => {
    const text = implementSessionInstructions(ref('uuid-abc', 'FE-12'), effort)
    expect(text).toContain('tm/<type>/FE-12-<context>')
    expect(text).not.toContain('Ticket: #')
    expect(text).toContain('auto')
  })
})

describe('trunkToMainPrBody', () => {
  it('aggregates Closes lines for GitHub tickets and lists Linear tickets plainly', () => {
    const body = trunkToMainPrBody(effort, [ref('o/repo#2'), ref('o/repo#3'), ref('uuid-abc', 'FE-12')])
    expect(body).toContain('o/home#1')
    expect(body).toContain('Closes #2')
    expect(body).toContain('Closes #3')
    expect(body).not.toContain('Closes #FE')
    expect(body).toContain('FE-12')
  })
})
