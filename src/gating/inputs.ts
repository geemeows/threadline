// Gathers GateInputs for one effort: gate questions through the tracker seam,
// PR linkage above it via branch convention (#19 §6).

import type { TrackerAdapter, TicketRef } from '../tracker/types.js'
import type { GateInputs, PRSource, RepoResolver, TicketView } from './types.js'
import { trunkBranch } from './branches.js'

export interface GatherDeps {
  tracker: TrackerAdapter
  prSource: PRSource
  resolveRepoDir: RepoResolver
}

export async function gatherGateInputs(deps: GatherDeps, effort: TicketRef): Promise<GateInputs> {
  const { tracker } = deps
  const [openPlanning, spec, stamps, ticketChildren] = await Promise.all([
    tracker.openChildren(effort, 'wayfinder'),
    tracker.specStatus(effort),
    tracker.mapStamps(effort),
    tracker.children(effort, 'ticket'),
  ])
  const trunk = trunkBranch(effort)
  const tickets: TicketView[] = await Promise.all(
    ticketChildren.map(async (child): Promise<TicketView> => {
      const target = await tracker.ticketTarget(child.ref)
      const repoDir = deps.resolveRepoDir(target)
      const pr = await deps.prSource.ticketPR(repoDir, child.ref, trunk)
      return { ref: child.ref, closed: child.state === 'closed', pr }
    }),
  )
  return { openPlanningChildren: openPlanning.length, spec, stamps, tickets }
}
