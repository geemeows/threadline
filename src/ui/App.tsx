// The pipeline UI shell — locked IA from #8, variant C: IDE-style three-pane
// split (efforts tree | pipeline rail with gates | docked tabbed session
// chat), Needs-you queue in the top bar, approvals inline + global inbox.
// Rebuilt on shadcn (#64): Sidebar shell, resizable rail/chat split, ⌘K palette.

import { useEffect } from 'react'
import { useDefaultLayout } from 'react-resizable-panels'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { CommandPalette } from './components/CommandPalette.js'
import { EffortsTree } from './components/EffortsTree.js'
import { Inbox } from './components/Inbox.js'
import { NewSessionDialog } from './components/NewSessionDialog.js'
import { PipelineRail } from './components/PipelineRail.js'
import { SessionPane } from './components/SessionPane.js'
import { SetupPanel } from './components/SetupPanel.js'
import { TopBar } from './components/TopBar.js'
import { store, useStore } from './lib/store.js'

export function App() {
  const state = useStore()
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'threadmap-split', panelIds: ['rail', 'chat'] })

  useEffect(() => {
    void store.init()
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme
  }, [state.theme])

  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <EffortsTree />
      <SidebarInset className="h-svh min-w-0">
        <TopBar />
        {state.error && (
          <div className="flex shrink-0 items-center gap-2 border-b bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
            {state.error}
            <Button variant="ghost" size="xs" className="ml-auto" onClick={() => store.dismissError()}>
              dismiss
            </Button>
          </div>
        )}
        <ResizablePanelGroup className="min-h-0 flex-1" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
          <ResizablePanel id="rail" minSize={340} className="grid min-w-0">
            <PipelineRail />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="chat" minSize={380} defaultSize="44" className="grid min-w-0">
            <SessionPane />
          </ResizablePanel>
        </ResizablePanelGroup>
      </SidebarInset>
      <CommandPalette />
      <Inbox />
      <NewSessionDialog />
      <SetupPanel />
    </SidebarProvider>
  )
}
