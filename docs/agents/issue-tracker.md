# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`.
- **List issues**: `gh issue list --state open --json number,title,labels` with appropriate `--label` filters.
- **Comment**: `gh issue comment <number> --body "..."`
- **Labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically inside a clone.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: one issue labelled `wayfinder:map`. Child tickets are GitHub sub-issues of it.
- **Blocking**: GitHub native issue dependencies; `issue_dependencies_summary.blocked_by` counts open blockers.
- **Frontier**: open, unblocked, unassigned children — first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` before any work.
- **Resolve**: comment the answer, close the issue, append a pointer to the map's Decisions-so-far.
