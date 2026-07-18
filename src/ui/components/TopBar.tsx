// Top bar of the redesigned shell (#64): sidebar trigger, workspace crumb,
// the Needs-you queue as status pills, workspace cost, setup and theme
// controls. Same IA and store wiring as the #8 top bar, Soft Depth visuals.

import { Flag, Moon, Settings2, Sun } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { needsYou, sessionLabel, workspaceCost } from '../lib/derive.js'
import { store, useStore } from '../lib/store.js'
import { StatusBadge } from './particles.js'

export function TopBar() {
  const state = useStore()
  const queue = needsYou(state)
  const total = workspaceCost(state)
  const inboxCount = queue.length + state.notices.length
  const workspaceName = state.workspace ? state.workspace.root.split('/').filter(Boolean).pop() : '…'

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
      <SidebarTrigger />
      <Separator orientation="vertical" className="!h-4" />
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <span aria-hidden className="text-primary">
          ✦
        </span>
        {workspaceName}
      </span>
      {state.conn !== 'open' && (
        <Badge variant="outline" className="border-transparent bg-warning/12 text-warning">
          {state.conn === 'connecting' ? 'connecting…' : 'reconnecting…'}
        </Badge>
      )}
      <span className="flex-1" />
      {queue.slice(0, 3).map(({ view, status }) => (
        <StatusBadge key={view.meta.id} status={status} onClick={() => store.selectSession(view.meta.id)}>
          <span className="max-w-48 truncate">{sessionLabel(view)}</span>
        </StatusBadge>
      ))}
      {inboxCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="text-warning hover:bg-warning/12 hover:text-warning"
          onClick={() => store.setInboxOpen(true)}
        >
          <Flag />
          {inboxCount} needs you
        </Button>
      )}
      {total > 0 && (
        <Badge variant="outline" title="workspace cost" className="font-mono text-muted-foreground">
          Σ ${total.toFixed(2)}
        </Badge>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        title="workspace readiness"
        className={cn(state.setup && !state.setup.ready && 'text-warning hover:bg-warning/12 hover:text-warning')}
        onClick={() => store.setSetupOpen(true)}
      >
        <Settings2 />
        <span className="sr-only">Workspace setup</span>
      </Button>
      <Button variant="ghost" size="icon-sm" title="toggle theme" onClick={() => store.toggleTheme()}>
        {state.theme === 'dark' ? <Sun /> : <Moon />}
        <span className="sr-only">Toggle theme</span>
      </Button>
      <Badge>threadmap dev</Badge>
    </header>
  )
}
