import { describe, expect, it } from 'vitest'
import {
  handleMcpMessage,
  QUESTION_TOOL_FULLNAME,
  QUESTION_TOOL_NAME,
  type QuestionAnswers,
  type QuestionBridge,
} from './question-mcp.js'

function bridge(over: Partial<QuestionBridge> = {}): QuestionBridge {
  return {
    awaitAnswer: async () => ({ 'Which?': 'A' }),
    isLive: () => true,
    ...over,
  }
}

describe('handleMcpMessage', () => {
  it('answers initialize with a protocol version and a session header', async () => {
    const res = await handleMcpMessage('s1', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, bridge())
    expect(res.status).toBe(200)
    expect(res.headers?.['Mcp-Session-Id']).toBe('s1')
    const body = res.body as { result: { protocolVersion: string; capabilities: unknown } }
    expect(body.result.protocolVersion).toBe('2025-06-18')
    expect(body.result.capabilities).toEqual({ tools: {} })
  })

  it('acks notifications with 202 and no body', async () => {
    const res = await handleMcpMessage('s1', { jsonrpc: '2.0', method: 'notifications/initialized' }, bridge())
    expect(res).toEqual({ status: 202 })
  })

  it('lists the ask_user_questions tool', async () => {
    const res = await handleMcpMessage('s1', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, bridge())
    const body = res.body as { result: { tools: { name: string }[] } }
    expect(body.result.tools.map((t) => t.name)).toContain(QUESTION_TOOL_NAME)
    expect(QUESTION_TOOL_FULLNAME).toBe('mcp__threadmap__ask_user_questions')
  })

  it('blocks tools/call on the bridge and returns the answers as JSON text', async () => {
    const answers: QuestionAnswers = { 'Which Jira?': 'Cloud', Auth: ['token'] }
    const res = await handleMcpMessage(
      's1',
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: QUESTION_TOOL_NAME, arguments: { questions: [] } } },
      bridge({ awaitAnswer: async () => answers }),
    )
    const body = res.body as { result: { content: { type: string; text: string }[]; isError?: boolean } }
    expect(body.result.isError).toBeUndefined()
    expect(JSON.parse(body.result.content[0]!.text)).toEqual({ answers })
  })

  it('returns an isError result when the session is not live', async () => {
    const res = await handleMcpMessage(
      's1',
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: QUESTION_TOOL_NAME, arguments: {} } },
      bridge({ isLive: () => false }),
    )
    const body = res.body as { result: { isError?: boolean } }
    expect(body.result.isError).toBe(true)
  })

  it('rejects an unknown tool name', async () => {
    const res = await handleMcpMessage(
      's1',
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope', arguments: {} } },
      bridge(),
    )
    const body = res.body as { error?: { code: number } }
    expect(body.error?.code).toBe(-32602)
  })
})
