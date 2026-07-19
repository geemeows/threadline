// Pure reduction of a session's transcript stream into renderable chat items.
// Keeps every rendering rule out of components so it's unit-testable.

import type { PermissionMode, SessionMeta, SessionStatus, TranscriptEvent } from './types.js'

/** The three gating stances the composer switch (#91) offers, in escalating
 *  looseness. `plan` is intentionally omitted — that's still fog on the map. */
export const PERMISSION_MODES: {
  mode: PermissionMode
  label: string
  description: string
}[] = [
  { mode: 'default', label: 'Normal', description: 'Ask before each tool the policy gates.' },
  { mode: 'acceptEdits', label: 'Accept edits', description: 'Auto-approve file edits; still ask for the rest.' },
  { mode: 'bypassPermissions', label: 'Auto', description: 'Run every tool without asking. Use with care.' },
]

/** Human label for a mode; falls back to the raw value for `plan`/unknowns. */
export function permissionModeLabel(mode: PermissionMode): string {
  return PERMISSION_MODES.find((m) => m.mode === mode)?.label ?? mode
}

export type ToolItem = {
  kind: 'tool'
  callId: string
  name: string
  input: unknown
  output?: unknown
  error?: boolean
}

/** One AskUserQuestion prompt (input schema from the Claude Code tool). */
export type QuestionSpec = {
  question: string
  header?: string
  options: { label: string; description?: string }[]
  multiSelect?: boolean
}

/** An AskUserQuestion tool call, surfaced as its own interactive item (#82
 *  follow-up) rather than a raw tool row. `answered` flips once we route the
 *  user's selection back to the agent as the tool_result. */
export type QuestionItem = {
  kind: 'question'
  callId: string
  questions: QuestionSpec[]
  answers?: Record<string, string | string[]>
  answered: boolean
}

export type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'agent'; text: string; streaming?: boolean }
  | ToolItem
  | QuestionItem
  | {
      kind: 'approval'
      id: string
      tool: string
      input: unknown
      resolved?: 'allow' | 'deny'
    }
  | { kind: 'system'; text: string }

export function reduceTranscript(meta: SessionMeta, events: TranscriptEvent[]): ChatItem[] {
  const items: ChatItem[] = [{ kind: 'user', text: meta.prompt }]
  let streaming: { kind: 'agent'; text: string; streaming?: boolean } | null = null
  // A tool call and its result arrive as separate events sharing a callId; the
  // redesigned tool particle shows both, so pair them onto one item.
  const toolsByCall = new Map<string, ToolItem>()
  const questionsByCall = new Map<string, QuestionItem>()

  const closeStream = () => {
    if (streaming) streaming.streaming = false
    streaming = null
  }

  for (const event of events) {
    switch (event.type) {
      case 'assistant_delta':
        if (!streaming) {
          streaming = { kind: 'agent', text: '', streaming: true }
          items.push(streaming)
        }
        streaming.text += event.text
        break
      case 'assistant_message': {
        // The full message supersedes its own accumulated deltas.
        const text = extractText(event.content)
        if (streaming) {
          streaming.text = text || streaming.text
          closeStream()
        } else if (text) {
          items.push({ kind: 'agent', text })
        }
        break
      }
      case 'tool_call': {
        closeStream()
        // The ask_user_questions tool becomes an interactive question item
        // (answered via the MCP round-trip), not a raw tool row.
        if (isQuestionTool(event.name)) {
          const question: QuestionItem = {
            kind: 'question',
            callId: event.callId,
            questions: extractQuestions(event.input),
            answered: false,
          }
          questionsByCall.set(event.callId, question)
          items.push(question)
          break
        }
        const tool: ToolItem = { kind: 'tool', callId: event.callId, name: event.name, input: event.input }
        toolsByCall.set(event.callId, tool)
        items.push(tool)
        break
      }
      case 'tool_result': {
        const question = questionsByCall.get(event.callId)
        if (question) {
          question.answered = true
          const answers = extractAnswers(event.output)
          if (answers) question.answers = answers
          break
        }
        const tool = toolsByCall.get(event.callId)
        if (tool) {
          tool.output = event.output
          tool.error = event.isError
        }
        break
      }
      case 'permission_request':
        closeStream()
        items.push({ kind: 'approval', id: event.id, tool: event.tool, input: event.input })
        break
      case 'permission_response': {
        const approval = items.find(
          (i): i is ChatItem & { kind: 'approval' } => i.kind === 'approval' && i.id === event.id,
        )
        if (approval) approval.resolved = event.decision.behavior
        break
      }
      case 'user_message':
        closeStream()
        items.push({ kind: 'user', text: event.text })
        break
      case 'session_ended':
        closeStream()
        items.push({ kind: 'system', text: `session ended — ${event.outcome}` })
        break
      case 'permission_mode':
        closeStream()
        items.push({ kind: 'system', text: `permission mode → ${permissionModeLabel(event.mode)}` })
        break
      case 'session_started':
      case 'usage_update':
        break
    }
  }
  return items
}

export function pendingApprovals(events: TranscriptEvent[]) {
  const pending = new Map<string, { id: string; tool: string; input: unknown }>()
  for (const event of events) {
    if (event.type === 'permission_request') {
      pending.set(event.id, { id: event.id, tool: event.tool, input: event.input })
    } else if (event.type === 'permission_response') {
      pending.delete(event.id)
    }
  }
  return [...pending.values()]
}

/** AskUserQuestion calls still awaiting the user's answer. The agent is blocked
 *  on the tool_result until we send it, so an unanswered question means the
 *  session is stopped on the human — same "Needs you" state as an approval. */
export function pendingQuestions(events: TranscriptEvent[]) {
  const pending = new Map<string, { callId: string }>()
  for (const event of events) {
    if (event.type === 'tool_call' && isQuestionTool(event.name)) {
      pending.set(event.callId, { callId: event.callId })
    } else if (event.type === 'tool_result') {
      pending.delete(event.callId)
    }
  }
  return [...pending.values()]
}

/**
 * Status vocabulary from the locked visual system (#8): Active / Needs you /
 * Waiting / Done. "Waiting" is a heuristic — the agent's last move was a full
 * message with nothing pending, so the turn is with the human.
 */
export function sessionStatus(meta: SessionMeta, events: TranscriptEvent[]): SessionStatus {
  if (meta.status === 'ended') return 'done'
  // A pending approval or an unanswered question both block the agent on the
  // human — surface either as "Needs you", never a running spinner.
  if (pendingApprovals(events).length > 0 || pendingQuestions(events).length > 0) return 'needs-approval'
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (event.type === 'usage_update' || event.type === 'session_started') continue
    if (event.type === 'assistant_message') return 'waiting-human'
    break
  }
  return 'running'
}

/** The interactive-question tool: the custom MCP one we host (headless), or the
 *  built-in name (kept so older transcripts / tests still resolve). */
function isQuestionTool(name: string): boolean {
  return name === 'AskUserQuestion' || name.endsWith('__ask_user_questions')
}

/** Parse the question tool's `input.questions` defensively — the model controls
 *  this shape, so drop anything that doesn't have a question + option labels. */
function extractQuestions(input: unknown): QuestionSpec[] {
  const raw = (input as { questions?: unknown })?.questions
  if (!Array.isArray(raw)) return []
  const questions: QuestionSpec[] = []
  for (const q of raw) {
    if (typeof q !== 'object' || q === null) continue
    const obj = q as Record<string, unknown>
    if (typeof obj.question !== 'string') continue
    const options = Array.isArray(obj.options)
      ? obj.options
          .filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null && typeof (o as { label?: unknown }).label === 'string')
          .map((o) => ({ label: o.label as string, description: typeof o.description === 'string' ? o.description : undefined }))
      : []
    questions.push({
      question: obj.question,
      header: typeof obj.header === 'string' ? obj.header : undefined,
      options,
      multiSelect: obj.multiSelect === true,
    })
  }
  return questions
}

/** Pull the `answers` map out of the question tool's result. The CLI delivers it
 *  as a text content block carrying `{"answers":{…}}`, but tolerate a direct
 *  object too. Returns undefined (never clobbers) when nothing parses. */
function extractAnswers(output: unknown): Record<string, string | string[]> | undefined {
  const direct = (output as { answers?: unknown })?.answers
  if (direct && typeof direct === 'object') return direct as Record<string, string | string[]>
  const text = pullText(output)
  if (text) {
    try {
      const parsed = JSON.parse(text) as { answers?: unknown }
      if (parsed.answers && typeof parsed.answers === 'object') {
        return parsed.answers as Record<string, string | string[]>
      }
    } catch {
      // not JSON — no structured answers to show
    }
  }
  return undefined
}

/** Flatten a tool_result output (string or MCP content-block array) to text. */
function pullText(output: unknown): string {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) {
    return output.map((b) => (typeof (b as { text?: unknown })?.text === 'string' ? (b as { text: string }).text : '')).join('')
  }
  return ''
}

function extractText(content: unknown[]): string {
  return content
    .map((block) =>
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: string }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
        ? (block as { text: string }).text
        : '',
    )
    .filter(Boolean)
    .join('\n')
}

/** One human-scannable line for a tool call, whatever the tool's input shape. */
export function summarizeInput(input: unknown): string {
  if (typeof input === 'string') return truncate(input)
  if (typeof input !== 'object' || input === null) return ''
  const obj = input as Record<string, unknown>
  for (const key of ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'prompt']) {
    if (typeof obj[key] === 'string') return truncate(obj[key] as string)
  }
  const first = Object.values(obj).find((v) => typeof v === 'string')
  return first ? truncate(first as string) : ''
}

export function summarizeOutput(output: unknown): string {
  if (typeof output === 'string') return truncate(output, 400)
  return truncate(JSON.stringify(output) ?? '', 400)
}

function truncate(text: string, max = 120): string {
  const line = text.split('\n')[0] ?? ''
  return line.length > max ? `${line.slice(0, max)}…` : line
}
