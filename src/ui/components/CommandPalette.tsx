// ⌘K command palette (#64): search over efforts and sessions, jump on select,
// plus the shell's few global actions. Opened from the sidebar search box or
// the keyboard shortcut; open state lives in the store like the other overlays.

import { useEffect } from 'react'
import { FolderGit2, Inbox, MessageSquare, Moon, Plus, Settings2, Sun } from 'lucide-react'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { sessionLabel, statusOf } from '../lib/derive.js'
import { store, useStore } from '../lib/store.js'
import { StatusDot } from './particles.js'

export function CommandPalette() {
  const state = useStore()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        store.setPaletteOpen(!store.getState().paletteOpen)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const close = () => store.setPaletteOpen(false)
  const run = (action: () => void) => () => {
    close()
    action()
  }

  const sessions = Object.values(state.sessions).sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt))

  return (
    <CommandDialog
      open={state.paletteOpen}
      onOpenChange={(open) => store.setPaletteOpen(open)}
      title="Search"
      description="Search efforts and sessions"
    >
      {/* base-nova's CommandDialog doesn't include the cmdk root — wrap explicitly. */}
      <Command>
        <CommandInput placeholder="Search efforts and sessions…" />
        <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {state.efforts.length > 0 && (
          <CommandGroup heading="Efforts">
            {state.efforts.map((effort) => (
              <CommandItem
                key={effort.ref.id}
                value={`effort ${effort.title} ${effort.ref.display}`}
                onSelect={run(() => store.selectEffort(effort.ref.id))}
              >
                <FolderGit2 />
                <span className="min-w-0 flex-1 truncate">{effort.title}</span>
                <span className="font-mono text-xs text-muted-foreground">{effort.ref.display}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {sessions.length > 0 && (
          <CommandGroup heading="Sessions">
            {sessions.map((view) => (
              <CommandItem
                key={view.meta.id}
                value={`session ${sessionLabel(view)} ${view.meta.prompt}`}
                onSelect={run(() => store.selectSession(view.meta.id))}
              >
                <MessageSquare />
                <span className="min-w-0 flex-1 truncate">{sessionLabel(view)}</span>
                <StatusDot status={statusOf(view)} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Actions">
          <CommandItem value="new session" onSelect={run(() => store.setNewSessionOpen(true))}>
            <Plus />
            New session
          </CommandItem>
          <CommandItem value="open inbox needs you" onSelect={run(() => store.setInboxOpen(true))}>
            <Inbox />
            Open inbox
          </CommandItem>
          <CommandItem value="workspace setup" onSelect={run(() => store.setSetupOpen(true))}>
            <Settings2 />
            Workspace setup
          </CommandItem>
          <CommandItem value="toggle theme dark light" onSelect={run(() => store.toggleTheme())}>
            {state.theme === 'dark' ? <Sun /> : <Moon />}
            Switch to {state.theme === 'dark' ? 'light' : 'dark'} theme
          </CommandItem>
        </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
