// A tiny, purpose-built MCP server exposing ONE tool — `ask_user_questions` —
// so planning agents can ask the human structured multiple-choice questions.
//
// Why this exists: Claude Code's built-in AskUserQuestion tool is unavailable in
// headless/print mode (it needs a TTY dialog — confirmed against the CLI docs and
// an empirical probe). The supported replacement is a custom MCP tool. We host it
// over Streamable HTTP on threadmap's own server, scoped per session by URL path
// (`/mcp/:sessionId`), so the tool handler runs in-process with the registry and
// can BLOCK on the user's UI answer, then return it as the tool result.
//
// The transport is deliberately minimal: request→response JSON only (no SSE
// stream, no batching), which is all the CLI needs for a synchronous tool.

export const QUESTION_MCP_KEY = 'threadmap'
export const QUESTION_TOOL_NAME = 'ask_user_questions'
/** Fully-qualified name the model (and transcript) sees: `mcp__<server>__<tool>`. */
export const QUESTION_TOOL_FULLNAME = `mcp__${QUESTION_MCP_KEY}__${QUESTION_TOOL_NAME}`

const PROTOCOL_VERSION = '2025-06-18'

export type QuestionAnswers = Record<string, string | string[]>

/** The registry's slice this server needs: block for an answer, know liveness. */
export interface QuestionBridge {
  /** Resolve when the user answers this session's pending question. */
  awaitAnswer(sessionId: string): Promise<QuestionAnswers>
  isLive(sessionId: string): boolean
}

const TOOL_SCHEMA = {
  name: QUESTION_TOOL_NAME,
  description:
    'Ask the user one or more clarifying questions with multiple-choice options and WAIT for their answer. ' +
    'Use this in place of AskUserQuestion whenever a decision is genuinely the user\'s to make — the threadmap UI ' +
    'renders each question with selectable options and returns the chosen option labels. Prefer this over asking in ' +
    'plain prose when the answer is one of a small set of choices.',
  inputSchema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: '1-4 questions to ask together.',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The full question text.' },
            header: { type: 'string', description: 'Short label/chip, max ~12 chars.' },
            options: {
              type: 'array',
              description: '2-4 mutually-exclusive options (unless multiSelect).',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Concise choice, 1-5 words.' },
                  description: { type: 'string', description: 'What this choice means.' },
                },
                required: ['label'],
              },
            },
            multiSelect: { type: 'boolean', description: 'Allow selecting multiple options.' },
          },
          required: ['question', 'options'],
        },
      },
    },
    required: ['questions'],
  },
} as const

interface JsonRpcMessage {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

export interface McpHttpResult {
  status: number
  /** Omitted for 202 (notification ack) responses. */
  body?: unknown
  headers?: Record<string, string>
}

function ok(id: JsonRpcMessage['id'], result: unknown): McpHttpResult {
  return { status: 200, body: { jsonrpc: '2.0', id, result } }
}

function rpcError(id: JsonRpcMessage['id'], code: number, message: string): McpHttpResult {
  return { status: 200, body: { jsonrpc: '2.0', id, error: { code, message } } }
}

/**
 * Handle one JSON-RPC message from the CLI's MCP client. `tools/call` blocks on
 * the bridge until the user answers (or the session dies, surfaced as an
 * isError tool result so the agent degrades instead of hanging).
 */
export async function handleMcpMessage(
  sessionId: string,
  msg: JsonRpcMessage,
  bridge: QuestionBridge,
): Promise<McpHttpResult> {
  const { method, id } = msg
  // Notifications carry no id and expect no body — just acknowledge.
  if (method?.startsWith('notifications/') || id === undefined || id === null) {
    return { status: 202 }
  }
  switch (method) {
    case 'initialize': {
      const requested = msg.params?.protocolVersion
      return {
        status: 200,
        headers: { 'Mcp-Session-Id': sessionId },
        body: {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: typeof requested === 'string' ? requested : PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'threadmap-questions', version: '1.0.0' },
          },
        },
      }
    }
    case 'ping':
      return ok(id, {})
    case 'tools/list':
      return ok(id, { tools: [TOOL_SCHEMA] })
    case 'tools/call': {
      const name = msg.params?.name
      if (name !== QUESTION_TOOL_NAME) return rpcError(id, -32602, `unknown tool: ${String(name)}`)
      if (!bridge.isLive(sessionId)) {
        return ok(id, { content: [{ type: 'text', text: 'No live session to ask.' }], isError: true })
      }
      try {
        const answers = await bridge.awaitAnswer(sessionId)
        return ok(id, { content: [{ type: 'text', text: JSON.stringify({ answers }) }] })
      } catch (err) {
        return ok(id, {
          content: [{ type: 'text', text: `Question was not answered: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        })
      }
    }
    default:
      return rpcError(id, -32601, `method not found: ${String(method)}`)
  }
}
