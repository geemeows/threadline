// Shared Soft Depth particles (#64): the session-status vocabulary rendered
// as dots and Badge pills, plus the cost badge. The redesigned surfaces use
// these; the legacy panes keep primitives.tsx until their own rebuild.

import type { MouseEventHandler, ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { fmtTokens } from '../lib/derive.js'
import type { SessionStatus, Usage } from '../lib/types.js'

/** Status → Soft Depth styling: dot classes + tinted Badge pill classes. */
export const STATUS_UI: Record<SessionStatus, { label: string; dot: string; pill: string }> = {
  running: {
    label: 'Active',
    dot: 'bg-success animate-pulse',
    pill: 'bg-success/12 text-success',
  },
  'needs-approval': {
    label: 'Needs you',
    dot: 'bg-warning animate-pulse',
    pill: 'bg-warning/12 text-warning',
  },
  'waiting-human': {
    label: 'Waiting',
    dot: 'bg-info',
    pill: 'bg-info/12 text-info',
  },
  done: {
    label: 'Done',
    dot: 'bg-muted-foreground/60',
    pill: 'bg-muted text-muted-foreground',
  },
}

export function StatusDot({ status, className }: { status: SessionStatus; className?: string }) {
  return <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', STATUS_UI[status].dot, className)} />
}

/** Rounded status pill: dot + label (or custom children), tinted per status.
 *  Pass `onClick` to render it as a clickable pill. */
export function StatusBadge({
  status,
  children,
  className,
  onClick,
  title,
}: {
  status: SessionStatus
  children?: ReactNode
  className?: string
  onClick?: MouseEventHandler<HTMLButtonElement>
  title?: string
}) {
  return (
    <Badge
      variant="outline"
      render={onClick ? <button type="button" onClick={onClick} /> : undefined}
      title={title}
      className={cn(
        'gap-1.5 border-transparent',
        STATUS_UI[status].pill,
        onClick && 'cursor-pointer transition-opacity hover:opacity-80',
        className,
      )}
    >
      <StatusDot status={status} />
      {children ?? STATUS_UI[status].label}
    </Badge>
  )
}

export function CostBadge({ usage, className }: { usage?: Usage; className?: string }) {
  if (!usage) return null
  const cost = usage.costUsd !== undefined ? `$${usage.costUsd.toFixed(2)}` : ''
  const tokens = `${fmtTokens(usage.inputTokens)}▸${fmtTokens(usage.outputTokens)}`
  return (
    <Badge variant="outline" title="cost · tokens in▸out" className={cn('font-mono text-muted-foreground', className)}>
      {[cost, tokens].filter(Boolean).join(' · ')}
    </Badge>
  )
}
