// Right pane of the locked IA (#8), rebuilt on shadcn (Base UI) in the Soft
// Depth direction (#66): sessions on Tabs, the transcript on MessageScroller
// (autoscroll replaces the hand-rolled stick-to-bottom), agent replies as flat
// marker-led text with user turns as end-aligned Bubbles, a collapsible
// tool-call particle (input/output, error tone), an inline approval-card
// particle, and the composer on InputGroup + Kbd hints. Behavior is unchanged
// from the #8 pane — approvals still resolve inline, the global inbox links here.

import { ChevronRight, Pause, Terminal, TriangleAlert, X } from 'lucide-react'
import { useState } from 'react'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import { Marker, MarkerContent } from '@/components/ui/marker'
import { Message } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { adhocSessions, effortSessions, sessionLabel, statusOf } from '../lib/derive.js'
import { store, useStore } from '../lib/store.js'
import type { SessionView } from '../lib/store.js'
import { reduceTranscript, summarizeInput, summarizeOutput } from '../lib/transcript.js'
import type { ChatItem, ToolItem } from '../lib/transcript.js'
import { CostBadge, StatusBadge, StatusDot } from './particles.js'

export function SessionPane() {
  const state = useStore()
  const rows = state.selectedEffort ? effortSessions(state, state.selectedEffort) : adhocSessions(state)
  const selected =
    (state.selectedSession && state.sessions[state.selectedSession]) || rows[rows.length - 1]?.view || null

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      {rows.length > 0 && (
        <Tabs
          value={selected?.meta.id}
          onValueChange={(id) => store.selectSession(String(id))}
          className="min-w-0 shrink-0 border-b px-2 pt-2"
        >
          <TabsList variant="line" className="max-w-full flex-nowrap overflow-x-auto">
            {rows.map(({ view, status }) => (
              <TabsTrigger key={view.meta.id} value={view.meta.id} className="gap-2">
                <StatusDot status={status} />
                <span className="truncate">{sessionLabel(view)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      {selected ? (
        <Chat key={selected.meta.id} view={selected} />
      ) : (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Terminal />
            </EmptyMedia>
            <EmptyTitle>No sessions yet</EmptyTitle>
            <EmptyDescription>Start a session from the pipeline rail — it docks here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}

function Chat({ view }: { view: SessionView }) {
  const { meta } = view
  const status = statusOf(view)
  const items = reduceTranscript(meta, view.events)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <StatusBadge status={status} />
        <span className="font-mono text-xs text-muted-foreground" title={meta.cwd}>
          {meta.cwd.split('/').filter(Boolean).pop()}
        </span>
        {meta.stage && <span className="text-xs text-muted-foreground">· {meta.stage}</span>}
        <span className="flex-1" />
        <CostBadge usage={meta.usage} />
        {meta.status === 'running' && (
          <>
            <Button variant="ghost" size="icon-sm" title="interrupt the agent" onClick={() => store.interrupt(meta.id)}>
              <Pause />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="kill the session"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => store.kill(meta.id)}
            >
              <X />
            </Button>
          </>
        )}
      </div>

      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-4 p-4">
              {items.map((item, i) => (
                <MessageScrollerItem key={i} scrollAnchor={i === items.length - 1}>
                  <ChatMessage item={item} sessionId={meta.id} />
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <Composer view={view} />
    </div>
  )
}

function ChatMessage({ item, sessionId }: { item: ChatItem; sessionId: string }) {
  switch (item.kind) {
    case 'user':
      return (
        <Message align="end">
          <Bubble variant="tinted" align="end">
            <BubbleContent className="whitespace-pre-wrap">{item.text}</BubbleContent>
          </Bubble>
        </Message>
      )
    case 'agent':
      return (
        <Marker className="items-start text-foreground">
          <MarkerContent className="flex gap-2.5 whitespace-pre-wrap">
            <span aria-hidden className="shrink-0 pt-px text-primary">
              ✦
            </span>
            <span className="min-w-0">
              {item.text}
              {item.streaming && <Spinner className="ml-1.5 inline size-3 align-middle text-muted-foreground" />}
            </span>
          </MarkerContent>
        </Marker>
      )
    case 'tool':
      return <ToolCall item={item} />
    case 'system':
      return (
        <Marker variant="separator" className="text-xs">
          <MarkerContent>{item.text}</MarkerContent>
        </Marker>
      )
    case 'approval':
      return <ApprovalCard item={item} sessionId={sessionId} />
  }
}

/** Collapsible tool-call particle: a one-line summary that expands to the full
 *  input and (once it lands) output. Error results tint the row red. */
function ToolCall({ item }: { item: ToolItem }) {
  const summary = summarizeInput(item.input)
  return (
    <Collapsible className="ml-6">
      <CollapsibleTrigger
        className={cn(
          'group/tool flex w-full min-w-0 items-center gap-2 rounded-lg border bg-muted/50 px-2.5 py-1.5 text-left font-mono text-xs text-muted-foreground transition-colors hover:bg-muted',
          item.error && 'border-destructive/30 text-destructive hover:bg-destructive/10',
        )}
      >
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[panel-open]/tool:rotate-90" />
        <Terminal className="size-3.5 shrink-0" />
        <span className="shrink-0 font-medium text-foreground">{item.name}</span>
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        {item.error && <TriangleAlert className="size-3.5 shrink-0" />}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 flex flex-col gap-2 rounded-lg border bg-card/50 p-2.5">
          <ToolBlock label="input" value={item.input} />
          {item.output !== undefined && <ToolBlock label="output" value={item.output} error={item.error} />}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ToolBlock({ label, value, error }: { label: string; value: unknown; error?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      <pre
        className={cn(
          'max-h-48 overflow-auto rounded-md bg-background px-2.5 py-2 font-mono text-xs whitespace-pre-wrap text-foreground',
          error && 'text-destructive',
        )}
      >
        {formatValue(value)}
      </pre>
    </div>
  )
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** Inline approval-card particle (#8's canonical surface): the requested tool,
 *  a code block of the input, and Allow/Deny — resolved once answered. */
function ApprovalCard({ item, sessionId }: { item: Extract<ChatItem, { kind: 'approval' }>; sessionId: string }) {
  const tinted = !item.resolved
  return (
    <Card
      size="sm"
      className={cn(tinted && 'border-warning/40 bg-warning/8')}
    >
      <CardContent className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusDot status={item.resolved ? 'done' : 'needs-approval'} />
          <b className="text-sm">Permission request — {item.tool}</b>
          {item.resolved && (
            <StatusBadge status={item.resolved === 'allow' ? 'running' : 'done'}>
              {item.resolved === 'allow' ? 'allowed' : 'denied'}
            </StatusBadge>
          )}
        </div>
        <pre className="max-h-44 overflow-auto rounded-md border bg-background px-2.5 py-2 font-mono text-xs whitespace-pre-wrap text-foreground">
          {summarizeInput(item.input) ? formatValue(item.input) : summarizeOutput(item.input)}
        </pre>
        {!item.resolved && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => store.respondPermission(sessionId, item.id, { behavior: 'allow' })}>
              Allow
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() =>
                store.respondPermission(sessionId, item.id, { behavior: 'deny', message: 'denied from threadmap UI' })
              }
            >
              Deny
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Composer({ view }: { view: SessionView }) {
  const [text, setText] = useState('')
  const { meta } = view
  const ended = meta.status === 'ended'
  const resumable = ended && !!meta.resumeToken
  const disabled = ended && !resumable

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    if (ended) {
      if (!resumable) return
      store.resumeSession(meta.id, trimmed)
    } else {
      store.sendMessage(meta.id, trimmed)
    }
    setText('')
  }

  return (
    <div className="shrink-0 px-4 pt-2 pb-3.5">
      <InputGroup className="h-auto flex-col rounded-xl">
        <InputGroupTextarea
          rows={2}
          value={text}
          disabled={disabled}
          placeholder={
            ended
              ? resumable
                ? 'Session ended — sending resumes it…'
                : 'Session ended and is not resumable.'
              : 'Message the agent…'
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <InputGroupAddon align="block-end" className="gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Kbd>⏎</Kbd> send
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Kbd>⇧⏎</Kbd> new line
          </span>
          <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
            <Kbd>/</Kbd> grilling
          </span>
          <InputGroupButton
            size="sm"
            variant="default"
            className="ml-auto"
            disabled={disabled}
            onClick={submit}
          >
            {ended && resumable ? 'Resume' : 'Send'}
            <Kbd className="bg-primary-foreground/15 text-primary-foreground">⏎</Kbd>
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}
