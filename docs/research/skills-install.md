# Research: global skills install — agent skill dirs, symlinks, and pinning mattpocock/skills

Resolves [#4](https://github.com/geemeows/threadline/issues/4). Part of #1.

Researched 2026-07-15 against primary sources: the [mattpocock/skills](https://github.com/mattpocock/skills) repo (README, `plugin.json`, `scripts/link-skills.sh`, tags/releases via GitHub API), the [Agent Skills spec](https://agentskills.io/specification), [Claude Code skills docs](https://code.claude.com/docs/en/skills), [Codex skills docs](https://developers.openai.com/codex/skills), [Cursor skills docs](https://cursor.com/docs/skills), the [vercel-labs/skills](https://github.com/vercel-labs/skills) installer source (`src/source-parser.ts`, `src/installer.ts`, `src/skill-lock.ts`), and the live install state on this machine.

## 1. The SKILL.md format is a cross-agent standard

The [Agent Skills spec](https://agentskills.io/specification) defines a skill as a directory containing a `SKILL.md` with YAML frontmatter. Required fields: `name` (lowercase/digits/hyphens, must match the parent directory name) and `description`. Optional: `license`, `compatibility`, `metadata`, `allowed-tools`. Optional subdirectories: `scripts/`, `references/`, `assets/`. Claude Code, Codex, and Cursor all state they implement this standard, so **one skill directory works unmodified across all three agents** — Claude Code adds proprietary frontmatter extensions (`disable-model-invocation`, `context: fork`, `hooks`, `paths`), which other agents ignore.

## 2. Where each agent loads user-level (machine-global) skills

| Agent | User-level dir(s) | Follows symlinks? | Source |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/skills/<name>/SKILL.md` | **Yes, explicitly documented**: "A `<skill-name>` entry in the enterprise, personal, or project locations can be a symlink to a directory elsewhere on disk… if the same target is reachable from more than one location, Claude Code loads the skill once." Also live-watches skill dirs for changes. | [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills) |
| OpenAI Codex CLI | `$HOME/.agents/skills` (user), plus `.agents/skills` in repo/parents, `/etc/codex/skills` (admin) | **Yes, explicitly documented**: "Codex supports symlinked skill folders and follows the symlink target when scanning these locations." | [developers.openai.com/codex/skills](https://developers.openai.com/codex/skills) (redirects to learn.chatgpt.com/docs/build-skills) |
| Cursor | `~/.agents/skills/` and `~/.cursor/skills/`; **also reads Claude/Codex dirs for compatibility**: `~/.claude/skills/`, `~/.codex/skills/` (and project equivalents) | Not documented either way; in practice Cursor reads the same symlinked dirs (this machine's `~/.cursor/skills/impeccable` and `~/.agents/skills` symlink farm are picked up). | [cursor.com/docs/skills](https://cursor.com/docs/skills.md) |

**Key convergence point: `~/.agents/skills` is the emerging canonical machine-global location.** Codex reads it natively, Cursor reads it natively, and Claude Code can be pointed at it via per-skill symlinks from `~/.claude/skills` (documented as supported, with dedup when both paths resolve to the same target).

## 3. The mattpocock/skills repo: structure and versioning

Verified against the repo via GitHub API:

- **Structure**: skills live under `skills/engineering/` (17 skills incl. `tdd`, `code-review`, `triage`, `wayfinder`, `research`, `setup-matt-pocock-skills`) and `skills/productivity/` (5 skills), plus `deprecated/`, `in-progress/`, `misc/`, `personal/` subfolders that installers exclude. `.claude-plugin/plugin.json` + `marketplace.json` make the repo a Claude Code plugin marketplace; `plugin.json` (`name: mattpocock-skills`, currently `version: 1.2.0` on main) enumerates the 22 published skills explicitly.
- **Versioning**: releases are cut with changesets. Git tags exist and are usable pin targets: `v1.0.0`, `v1.0.1` (2026-06-17), `v1.1.0` (2026-07-08, latest release), plus `mattpocock-skills@1.0.0`. **There is no npm package** — `npm view mattpocock-skills` and `matt-pocock-skills` both 404; `package.json` is `"private": true`. Distribution is git-only (via the `skills` CLI or the Claude plugin marketplace).
- **Install mechanisms offered by the README**:
  1. `npx skills@latest add mattpocock/skills` (the [vercel-labs/skills](https://github.com/vercel-labs/skills) CLI, npm package `skills`, "The open agent skills ecosystem") — works for any SKILL.md-standard agent.
  2. Claude Code plugin: `claude plugin marketplace add mattpocock/skills && claude plugin install mattpocock-skills@mattpocock` — Claude-only.
  3. For contributors/clones: `scripts/link-skills.sh` symlinks every `skills/**/SKILL.md` parent dir into `~/.claude/skills` and `~/.agents/skills` with `ln -sfn`, so `git pull` updates everything. The script is bash-only — **no Windows handling**.

## 4. The `skills` CLI (vercel-labs/skills): symlinks, pinning, Windows

Verified in the CLI source (v1.5.17):

- **Canonical dir + symlink fan-out**: `getCanonicalSkillsDir()` in `src/installer.ts` puts the real files at `~/.agents/skills/<skill>` for `--global` (project: `./.agents/skills/<skill>`), then symlinks each agent's own dir (e.g. `~/.claude/skills/<skill>`, `~/.cursor/skills/<skill>`) at the canonical copy. "Universal agents" that read `.agents/skills` directly get no redundant symlink.
- **Pinning**: `src/source-parser.ts` parses a `#ref` fragment on git-like sources — `npx skills add 'mattpocock/skills#v1.1.0'` pins to a tag/branch; `#ref@skill-name` also filters to one skill; GitHub tree URLs (`github.com/owner/repo/tree/<ref>/<path>`) work too. A lockfile at `~/.agents/.skill-lock.json` (schema v3, `src/skill-lock.ts`) records per-skill `source`, `ref`, and the GitHub **tree SHA** of the skill folder; `npx skills update` is ref-aware and diffs tree SHAs.
- **Windows fallback**: `createSymlink()` uses `symlink(type: 'junction')` on `win32` — NTFS junctions with absolute targets, which **don't require admin rights or Developer Mode**. If symlink/junction creation fails for any reason, the installer **automatically falls back to copying** (`symlinkFailed: true` in the result); `--copy` forces copy mode ("Use when symlinks aren't supported").

## 5. What `setup-matt-pocock-skills` generates (machine-global vs per-repo split)

Read from the installed skill (`~/.claude/skills/setup-matt-pocock-skills/SKILL.md`):

- **Machine-global**: the skills themselves. They are generic; nothing repo-specific is baked in.
- **Per-repo, generated once by running `/setup-matt-pocock-skills`**: `docs/agents/issue-tracker.md` (GitHub/GitLab/local-markdown/other), `docs/agents/triage-labels.md` (five canonical labels), `docs/agents/domain.md` (single-context `CONTEXT.md` + `docs/adr/`, or multi-context `CONTEXT-MAP.md` for monorepos), and an `## Agent skills` section appended to the existing `CLAUDE.md` **or** `AGENTS.md` (never creates the second one if one exists). This repo (threadline) is itself an example of that output.

So the split is clean: skills are stateless machine-global assets; all repo state lives in `docs/agents/*` + the `## Agent skills` block, committed to the repo.

## 6. Evidence from this machine

- `~/.agents/skills/` holds the canonical copies (31 skills; `~/.agents/.skill-lock.json` v3 records `"source": "mattpocock/skills"` for the Matt skills — installed via the `skills` CLI, unpinned/no `ref` field).
- `~/.claude/skills/` shows **both modes in the wild**: symlinks into `../../.agents/skills/` (`coss`, `find-skills`, `impeccable`, `write-a-skill`) and plain copied directories for the Matt skills (copy fallback / a copy-mode install) — the copies are byte-identical to the canonical dirs but are now **two divergeable copies**, illustrating why symlink mode is preferable.
- `~/.cursor/skills/` exists and is read by Cursor (contains `impeccable`), confirming the per-agent fan-out target.

## 7. Implications for the global-install design

1. **Install canonically to `~/.agents/skills`, symlink into `~/.claude/skills` (and `~/.cursor/skills` if not relying on Cursor's `~/.agents` support).** All three agents either read `~/.agents/skills` natively (Codex, Cursor) or follow symlinks from their own dir (Claude Code, documented, with dedup).
2. **Pin with a git tag via the `skills` CLI**: `npx skills add 'mattpocock/skills#v1.1.0' --global` gives a reproducible install with a lockfile (`~/.agents/.skill-lock.json`) recording ref + tree SHA; upgrade deliberately by re-adding at a new tag or `npx skills update`. Do not rely on an npm package — none exists. The Claude plugin route installs whatever `main` says and is Claude-only, so it can't serve a cross-agent pinned install.
3. **Windows story**: the `skills` CLI is the only mechanism with a Windows path — junctions (no admin needed), auto-fallback to copy, explicit `--copy` escape hatch. `link-skills.sh` is bash-only; don't build on it for Windows.
4. **Copy mode is the fallback, not the default**: copies work everywhere but create N divergeable duplicates per skill (observed on this machine); with copies, updates require re-running the installer for every agent dir.
5. **Keep per-repo config out of the global install**: `/setup-matt-pocock-skills` must still be run once per repo to generate `docs/agents/*` and the `## Agent skills` block — the global install ships only the skills.
