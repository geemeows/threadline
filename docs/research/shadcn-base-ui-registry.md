# shadcn + Base UI: init path, registry choice, and component coverage for threadmap

> Research for issue #57 · 2026-07-18
> Question: how does shadcn with **Base UI** primitives install into this repo (Vite + React 19 + Tailwind v4, no `components.json`), and which registry — canonical shadcn's Base UI support or the **coss** registry — best covers the UI's component inventory?

## Summary

- **Init is a three-step path**: add a `@/*` path alias (tsconfig + vite `resolve.alias`), run `pnpm dlx shadcn@latest init --preset base-nova` (the `base-` preset prefix selects Base UI primitives; `components.json` gets `"base": "base"`), then merge the generated Tailwind v4 CSS tokens into `src/ui/styles.css`. No `tailwind.config` — Tailwind v4 is CSS-first (`@theme inline`) and the CLI already detects this repo correctly (framework `vite`, `tailwindVersion: v4`, css `src/ui/styles.css`).
- **Recommendation: canonical shadcn with `base: "base"` as the primary registry; coss as a secondary pattern source.** Since the [January 2026 Base UI changelog](https://ui.shadcn.com/docs/changelog/2026-01-base-ui), every canonical shadcn component ships for both Radix and Base UI with identical import surface, and Base UI is now the default for new projects. Canonical uniquely covers threadmap's hardest surface — the session chat — with first-party `MessageScroller`/`Message`/`Bubble`/`Attachment`/`Marker` components, plus `Sidebar`, `Item`, `Field`, `Empty`, `Kbd`, `Spinner`. coss (53 Base UI primitives, 484 copy-paste "particles") is excellent and installs through the same CLI (`@coss/*`), but lacks a sidebar, chat components, and resizable panes; its particles are best used as **reference patterns**, not direct installs, to avoid maintaining two parallel primitive sets.
- **Coverage**: every overlay, form, pill, tab, and menu in the current UI maps to a stock component. **Gaps needing custom particles**: the efforts tree, the pipeline stage rail (stepper), tool-call rendering inside chat, the approval card, the cost pill, the `Ticks` micro-progress, and the status dot vocabulary.

---

## 1. Verified current stack (ground truth from this repo)

| Fact | Value | Source |
| --- | --- | --- |
| Framework | Vite 6 (`vite: ^6.3.0`), `root: 'src/ui'` | `package.json`, `vite.config.ts` |
| React | 19 (`react: ^19.1.0`), plain SPA — no RSC | `package.json` |
| Tailwind | v4 via `@tailwindcss/vite` plugin (`tailwindcss: ^4.1.0`), **no `tailwind.config.*`** | `package.json`, `vite.config.ts` |
| CSS entry | `src/ui/styles.css` — starts `@import 'tailwindcss';`, hand-rolled token system (`--bg`, `--panel`, `--mint`, …) with `[data-theme='light']` overrides | `src/ui/styles.css` |
| Package manager | `pnpm@10.33.2` → use `pnpm dlx shadcn@latest` | `package.json` |
| `components.json` | **none** | repo scan |
| Import alias | **none** — no `baseUrl`/`paths` in `tsconfig.json`, no `resolve.alias` in vite | `tsconfig.json`, `vite.config.ts` |
| UI code | `src/ui/components/*.tsx` + `src/ui/lib/*`, styled by global CSS classes (`pill`, `btn`, `overlay-panel`, …) + Tailwind utilities | repo scan |

`npx shadcn@latest info` (run against this repo via the /shadcn skill context) confirms the CLI detects: `framework: vite`, `srcDirectory: true`, `tailwindVersion: v4`, `tailwindConfig: null`, `tailwindCss: "src/ui/styles.css"`, `importAlias: null`, `config: null` (no components.json). So the only real precondition the CLI can't fix itself is the **import alias**.

Theming caveat: this repo toggles light mode with `[data-theme='light']` (see `store.toggleTheme()` in `src/ui/components/TopBar.tsx`), while shadcn's generated CSS assumes a `.dark` class. Reconcile with a Tailwind v4 `@custom-variant` (below).

## 2. Exact init path for this repo

Sources: [shadcn Vite installation](https://ui.shadcn.com/docs/installation/vite), [Tailwind v4 docs](https://ui.shadcn.com/docs/tailwind-v4), [components.json docs](https://ui.shadcn.com/docs/components-json), [Base UI changelog](https://ui.shadcn.com/docs/changelog/2026-01-base-ui), [Base UI quick start](https://base-ui.com/react/overview/quick-start), local `/shadcn` skill CLI reference.

### Step 1 — path alias (required before init)

`tsconfig.json` (this repo has a single tsconfig; alias into `src/ui` since that's the Vite root and where all UI code lives):

```jsonc
{
  "compilerOptions": {
    // …existing options…
    "baseUrl": ".",
    "paths": { "@/*": ["./src/ui/*"] }
  }
}
```

`vite.config.ts`:

```ts
import path from 'node:path'

export default defineConfig({
  root: 'src/ui',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src/ui') } },
  // …build/server unchanged…
})
```

(`@types/node` is already a devDependency, so `path` resolves in the config.)

### Step 2 — init with Base UI

```bash
pnpm dlx shadcn@latest init --preset base-nova
```

- Named presets combine a base library + style; the `base-` prefix selects **Base UI** primitives (`base-nova`, `base-vega`, …). The CLI's `--defaults` is `--template=next --preset=base-nova` — do **not** use `--defaults` here (it targets Next.js); run plain `init` in the repo root so the CLI detects the existing Vite project. ([changelog](https://ui.shadcn.com/docs/changelog/2026-01-base-ui); /shadcn skill `cli.md`)
- The primitive library lands in `components.json` as the `base` field (`"base"` vs `"radix"`) — this is what flips component APIs (e.g. `render` instead of `asChild`). Verify after init with `pnpm dlx shadcn@latest info`. ([components.json docs](https://ui.shadcn.com/docs/components-json); /shadcn skill)
- Alternative: pick a theme visually at ui.shadcn.com/create and run `pnpm dlx shadcn@latest init --preset <code>`. Preset codes do **not** encode the base — keep the base-prefixed named preset or answer the prompt.

### Step 3 — expected `components.json`

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "base": "base",
  "style": "nova",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/ui/styles.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks",
    "utils": "@/lib/utils"
  }
}
```

Key Tailwind v4 specifics ([docs](https://ui.shadcn.com/docs/tailwind-v4), [components.json](https://ui.shadcn.com/docs/components-json)):

- `tailwind.config` **stays empty** — "For Tailwind CSS v4, leave this blank." All theme config is CSS-first.
- Components are v4/React 19 native: no `forwardRef`, `data-slot` attributes on every part, `tw-animate-css` replaces the deprecated `tailwindcss-animate`.
- The CLI appends to `src/ui/styles.css`: `:root`/`.dark` CSS variables in plain color values and an `@theme inline` block mapping them to Tailwind tokens (`--color-background: var(--background);` …).

### Step 4 — merge the theme with the existing visual system

The repo's locked visual system (`--bg`, `--panel`, `--mint`, 12px radii) should become the values of shadcn's semantic tokens rather than live alongside them, e.g. `--background: #0b0c0e; --card: #131417; --primary: #4ade9c; --radius: 0.75rem;` in `:root`, with the light palette under the theme attribute. Because the app uses `data-theme` instead of a `.dark` class, add a v4 custom variant so `dark:` utilities and the generated `.dark`-scoped vars both key off it:

```css
@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));
```

(Method per [shadcn Tailwind v4 docs](https://ui.shadcn.com/docs/tailwind-v4); the repo already defaults to dark and stamps `data-theme`.)

### Step 5 — Base UI runtime prerequisites

Base UI is `@base-ui/react` (stable, currently 1.6.0). It needs a stacking-context root so popups layer correctly — add to `styles.css` ([Base UI quick start](https://base-ui.com/react/overview/quick-start)):

```css
#root { isolation: isolate; }
```

(Plus `body { position: relative; }` for iOS 26 Safari backdrops.)

### Step 6 — add components

```bash
pnpm dlx shadcn@latest add button badge tooltip dialog sheet select tabs textarea \
  field input-group kbd separator collapsible scroll-area empty spinner item \
  checkbox radio-group progress alert sidebar command
```

Base-flavoured docs per component: `https://ui.shadcn.com/docs/components/base/<component>.md`. Remember the Base API deltas (from the /shadcn skill's base-vs-radix rules): triggers use `render={<Button/>}` not `asChild`; `Select` takes an `items` prop and supports `multiple`/object values; `ToggleGroup`/`Accordion` use `multiple` + array `defaultValue`; single-thumb `Slider` takes a plain number.

## 3. Registry comparison: canonical shadcn (Base UI) vs coss

| Axis | Canonical shadcn (`base: "base"`) | coss (`@coss`) |
| --- | --- | --- |
| Base UI maturity | Base support shipped [Jan 2026](https://ui.shadcn.com/docs/changelog/2026-01-base-ui); as of July 2026 Base UI is the **default** for new projects, every component ships for both primitive layers, docs default to the Base tab ([changelog](https://ui.shadcn.com/docs/changelog), [shadcnblocks announcement](https://www.shadcnblocks.com/changelog/new-feature-base-ui-support), [byteiota](https://byteiota.com/shadcn-ui-base-ui-default-what-react-devs-must-know-now/)) | Base UI-first since inception — never had a Radix layer, so no migration seams; the /coss skill encodes mature Base idioms (trigger/popup hierarchies, `*Primitive` exports) |
| Base UI version | `@base-ui/react` (stable 1.x line, [quick start](https://base-ui.com/react/overview/quick-start)) | Same package — `@coss/dialog` registry item declares `"@base-ui/react"` in `dependencies` ([coss.com/ui/r/dialog.json](https://coss.com/ui/r/dialog.json)) |
| Component breadth | Full shadcn inventory on Base: overlays, forms (`Field`/`FieldGroup`, `InputGroup`), `Sidebar`, `Command`, `Resizable`, `Chart`, `Table`, `Item`, `Empty`, `Kbd`, `Spinner`, **chat set: `MessageScroller`, `Message`, `Bubble`, `Attachment`, `Marker`** (/shadcn skill component table + chat rules) | 53 primitives + hooks ([llms.txt](https://coss.com/ui/llms.txt)) incl. some shadcn lacks as primitives (`Autocomplete`, `NumberField`, `Meter`, `Frame`, `PreviewCard`) — but **no Sidebar, no chat components, no Resizable, no Chart** |
| Patterns / examples | Per-component example files (`.../examples/[component]-example.tsx`) | **484 particles** across 52 types ([particles catalog](https://coss.com/ui/particles), /coss-particles skill) — incl. directly relevant ones: chat composer (`p-input-group-28/29`), command palette (`p-command-1/2`), status badges (`p-badge-16..18`), avatar status dots (`p-avatar-7..9`), kbd shortcuts |
| Tailwind v4 | Native ([Tailwind v4 docs](https://ui.shadcn.com/docs/tailwind-v4)) | Native — coss examples/setup assume v4 (/coss skill) |
| Install ergonomics | First-party: `init` presets, `add`, `docs`, `info`, `--dry-run/--diff`; zero registry config | Same CLI via namespace: `pnpm dlx shadcn@latest add @coss/dialog`; bootstrap `init @coss/style` or `add @coss/ui @coss/colors-neutral` (/coss skill `cli.md`). Third-party namespaces are configured in `components.json` `registries` (`"@coss": "https://coss.com/ui/r/{name}.json"`) — there is **no `--registry` flag**; namespacing is the mechanism ([registry namespace docs](https://ui.shadcn.com/docs/registry/namespace)). Requires coss's extra theme tokens (`info`/`success`/`warning` families) |
| Ecosystem alignment | This machine's `/shadcn` skill and `migrate-radix-to-base` skill both target canonical base APIs; huge third-party block ecosystem | `/coss` + `/coss-particles` skills installed locally; smaller ecosystem |

### Recommendation

**Adopt canonical shadcn with Base UI primitives (`init --preset base-nova`, `base: "base"`) as the primary registry.** Reasons, in order of weight:

1. **Chat coverage.** `SessionPane` is the most complex surface in threadmap — a streaming transcript with stick-to-bottom scrolling, tool rows, and a composer. Canonical shadcn ships `MessageScroller` (owns streaming follow/anchoring/jump-to-latest), `Message`, `Bubble`, `Attachment`, `Marker`. coss has no chat components; we'd hand-roll exactly the code shadcn now provides (including replacing the manual `stickToBottom` ref in `SessionPane.tsx`).
2. **Layout coverage.** `Sidebar` (+ `Collapsible`) is the natural skeleton for `EffortsTree`; `Resizable` fits the three-pane IA. coss offers neither.
3. **Default + first-party.** Base UI is now shadcn's default; both primitive layers get every new component simultaneously, and the CLI/preset/docs/info toolchain needs zero registry configuration.
4. **coss stays valuable as a secondary source** — same `@base-ui/react` underneath, same Tailwind v4 conventions. Use its 484 particles as *reference patterns* (chat composer, status badges, avatar status dots, command palette) and re-express them on the canonical primitives. Avoid `add @coss/<primitive>` for primitives canonical already provides: coss registry items pull in `@coss/button` etc. as `registryDependencies` ([dialog.json](https://coss.com/ui/r/dialog.json)), which would fork the design system into two button/dialog implementations. If a coss-only primitive is ever needed (`autocomplete`, `number-field`, `meter`), install it explicitly via the `@coss` namespace and rewrite its imports to this repo's aliases (per /shadcn skill workflow rule 6).

## 4. Component coverage map (current surfaces → shadcn base components)

All surfaces live in `src/ui/components/`. "shadcn" = canonical Base UI variant; "(coss ref)" = a coss particle worth copying as a pattern.

### `primitives.tsx`
| Current | Needs | Maps to |
| --- | --- | --- |
| `Pill` (tone variants: mint/amber/blue/red/solid) | status/label chip | `Badge` with variants; extend with custom tone variants in the one owned `badge.tsx` (coss ref: `p-badge-16..18` status badges) |
| `StatusDot` (per-status colored dot) | tiny status indicator | **custom particle** — no stock dot; pattern in coss `p-avatar-7..9`/`p-button-34` (animated status dot) |
| `CostBadge` ($ + tokens in▸out, mono) | cost pill | **custom particle** composed from `Badge` + mono text |
| `Ticks` (28-segment micro progress) | segmented progress | **custom particle**; nearest stock: `Progress` (or coss `Meter`) — keep segmented look custom |

### `TopBar.tsx`
| Element | Maps to |
| --- | --- |
| bar itself | plain flex div (or future `Menubar`) |
| workspace crumb | `Breadcrumb` (overkill now — text ok) |
| connection / cost / "needs you" pills | `Badge` + `Button` (clickable pills: `Badge` render prop or `Button variant="outline" size="sm"` pill-shaped; coss ref `p-button-29`, `p-button-32` notification badge) |
| queue quick-jump buttons | `Button` + `StatusDot` particle + `Tooltip` |
| setup gear / theme toggle | `Button variant="ghost" size="icon"` + `Tooltip`; theme toggle could be `Toggle` |

### `EffortsTree.tsx`
| Element | Maps to |
| --- | --- |
| left pane shell + sections ("Efforts", "Ad-hoc", "Needs you") | `Sidebar` (SidebarHeader/Group/GroupLabel/Menu) — shadcn only, no coss equivalent |
| expandable effort → sessions | `Collapsible` inside `SidebarMenu`; **tree view itself is a custom particle** (no stock tree in shadcn or coss) |
| search box with ⌘K | `InputGroup` + `Kbd` (coss ref `p-input-group-11`); actual palette → `Command` in a `Dialog` (coss ref `p-command-1`) |
| "+" new session | `Button size="icon" variant="ghost"` + `Tooltip` |
| session rows w/ status dot | `SidebarMenuItem`/`Item` + `StatusDot` particle |
| empty copy | `Empty` |

### `PipelineRail.tsx`
| Element | Maps to |
| --- | --- |
| six-stage vertical rail with bubbles/✓/🔒/spinner | **custom particle (stepper)** — neither registry ships a Stepper; compose from `Item` + `Separator` + `Spinner` + `Badge` |
| effort header pills (ref link, cost, completed) | `Badge` (+ `Button render={<a/>}` for links) |
| warnings | `Alert` or `Badge variant` amber |
| stage detail card | `Card` (full CardHeader/Title/Content composition) |
| status pill (Done/In Progress/Locked) | `Badge` variants |
| override flow (reveal + textarea + reason-required destructive confirm) | `Collapsible` or `AlertDialog`; `Field` + `Textarea`; `Button variant="destructive"` — approval semantics stay a **custom particle** |
| ticket rows (mono ref, PR state pill, verdict pill, per-row actions) | `Item` rows + `Badge` + `Button size="sm"`; at scale: `Table` |
| land/complete result rows | `Item` + `Badge` + toast via `sonner` for outcomes |
| busy states on buttons | `Spinner` + `data-icon` + `disabled` (no `isLoading` prop) |

### `Inbox.tsx`
| Element | Maps to |
| --- | --- |
| overlay-bg/overlay-panel (click-outside close) | `Dialog` (or `Sheet` for a right-docked inbox) — `DialogTitle` required |
| notice + session rows | `Item` (+ `ItemActions` for dismiss) |
| status pill, cost badge | `Badge`, `CostBadge` particle |
| empty state | `Empty` |

### `SessionPane.tsx`
| Element | Maps to |
| --- | --- |
| session tabs (`vc-tabs`) | `Tabs`/`TabsList`/`TabsTrigger` with count/status (coss ref `p-tabs-10` count badge) |
| chat scroll + manual stick-to-bottom ref | `MessageScroller` (+ `MessageScrollerButton` jump-to-latest) — replaces the hand-rolled `useEffect` scroll logic |
| user/agent messages | `Message` + `Bubble` (streaming spinner: `Spinner`) |
| tool rows | `Message` variant + **custom tool-call particle** (collapsible input/output, error tone) |
| system dividers ("— text —") | `Marker` |
| approval card (Allow/Deny) | **custom particle**: `Card`/`Alert` + `Badge` + `Button` pair + code block (see Gaps) |
| chat head (cwd pill, stage, status, cost, ⏸/✕) | `Badge` + `Button size="icon"` + `Tooltip` |
| composer (textarea, ⏎ hints, send/resume) | `InputGroup` + `InputGroupTextarea` + `InputGroupAddon` buttons + `Kbd` hints (coss ref `p-input-group-28/29` chat composer) |

### `NewSessionDialog.tsx`
| Element | Maps to |
| --- | --- |
| overlay | `Dialog` + `DialogHeader/Title/Footer` |
| repo + stage selects | `Select` (Base API: `items` prop; placeholder = `{ value: null }` item) inside `Field` |
| prompt textarea | `Field` + `Textarea` |
| form layout | `FieldGroup` + `Field` (never bare divs — /shadcn forms rules) |
| Cancel/Start | `DialogFooter` `Button`s, disabled-until-valid |

### `SetupPanel.tsx`
| Element | Maps to |
| --- | --- |
| wide overlay panel (720px, scrollable, forced-open in guided mode) | `Dialog` (non-dismissable when `!setup.ready`) or `Sheet`; `ScrollArea` |
| check-then-fix sections with ✓/• pill | `Card` or `FieldSet`+`FieldLegend` per section + `Badge` (coss ref: `Frame`/`CardFrame` panels, `p-frame-3`) |
| repo checkboxes | `Field` + `Checkbox` (group → `CheckboxGroup` pattern) |
| tracker radios (with locked state) | `RadioGroup` + `Badge` "locked" |
| Linear API key input | `Field` + `Input type="password"` + `InputGroup` button (coss ref `p-input-9`) |
| team selects + create-team input row | `Select` + `Group` of input+button (coss ref `p-group-16`) |
| provision buttons + per-repo result pills | `Button` + `Spinner`, `Badge` results; errors → `Alert` / `FieldError` |
| docs plan `<details><pre>` diff viewer | `Collapsible` + **custom code/diff block particle** |
| ErrorLine | `FieldError` / `Alert variant="destructive"` |

## 5. Gaps — custom "particles" to build

No stock equivalent in either registry; build once as composed components (own directory, e.g. `src/ui/components/particles/`):

1. **Chat tool-call rendering** — tool rows with summarized input, expandable raw JSON, error tone; compose `Message` + `Collapsible` + code block. (shadcn chat set covers the stream/bubbles, not tool-call semantics.)
2. **Approval card** — inline permission request: tool name, summarized command, Allow/Deny, resolved state. Compose `Alert`/`Card` + `Badge` + `Button` pair. Canonical for threadmap's whole "needs you" loop.
3. **Pipeline stage rail (stepper)** — six vertical stages with done/current/locked bubbles, unmet-gate captions, selection. No Stepper in shadcn or coss; compose `Item` + `Spinner` + `Badge` + `Separator`.
4. **Tree view** — efforts → sessions hierarchy with disclosure carets; compose `Sidebar` + `Collapsible`; no first-class Tree in either registry.
5. **Cost pill** — `$0.42 · 12k▸3k` mono badge (`CostBadge`); trivial `Badge` composition, but a shared particle keeps the token vocabulary consistent.
6. **Status dot + status pill vocabulary** — the `SessionStatus` → color/pulse mapping (`STATUS_META`); wrap `Badge` + dot span (coss `p-avatar-7..9` shows the dot pattern).
7. **Ticks micro-progress** — 28-segment done/total meter; keep custom (`Progress`/`Meter` are continuous bars).
8. **Code/diff block** — for setup doc plans (`<pre>` proposed content) and approval command display; compose `ScrollArea` + mono styling (coss ref `p-input-group-27` code snippet input is adjacent, not equivalent).

## Sources

**Primary (live docs, checked 2026-07-18)**
- https://ui.shadcn.com/docs/installation/vite — Vite install steps (alias, vite config, `init`)
- https://ui.shadcn.com/docs/tailwind-v4 — v4 CSS-first support, `@theme inline`, `tw-animate-css`, no-forwardRef/`data-slot`
- https://ui.shadcn.com/docs/components-json — schema; `tailwind.config` blank on v4; `registries` field
- https://ui.shadcn.com/docs/changelog/2026-01-base-ui — Base UI support announcement; `npx shadcn create`, per-component Base docs
- https://ui.shadcn.com/docs/registry/namespace — namespaced registries; `@namespace/component`; **no `--registry` flag**
- https://base-ui.com/react/overview/quick-start — `@base-ui/react` 1.6.0 stable, `isolation: isolate`, iOS 26 note
- https://coss.com/ui/llms.txt — coss docs map (60+ component docs, hooks, shadcn/Radix migration guide)
- https://coss.com/ui/r/dialog.json — coss registry item: depends on `@base-ui/react`, `registryDependencies: @coss/button, @coss/scroll-area`
- https://coss.com/ui/particles — particles catalog (484 across 52 types)

**Secondary (July 2026 default-flip corroboration)**
- https://www.shadcnblocks.com/changelog/new-feature-base-ui-support · https://byteiota.com/shadcn-ui-base-ui-default-what-react-devs-must-know-now/ — Base UI now the default for new shadcn projects; Radix not deprecated; both layers get every new component

**Local skills (ground truth for coss + CLI behavior)**
- `~/.claude/skills/shadcn/` — SKILL.md (live `info` output for this repo; component table incl. chat set), `cli.md` (init/preset flags, `base-nova`, `base` field), `rules/base-vs-radix.md` (render vs asChild, Select `items`, ToggleGroup/Slider/Accordion deltas)
- `~/.claude/skills/coss/` — SKILL.md + `references/cli.md` (`init @coss/style`, `add @coss/ui`, theme-token requirements)
- `~/.claude/skills/coss-particles/` — full particle index (counts and JSON URLs cited above)

**Repo files read**
- `package.json`, `vite.config.ts`, `tsconfig.json`, `src/ui/styles.css`
- `src/ui/components/{primitives,TopBar,EffortsTree,PipelineRail,Inbox,SessionPane,NewSessionDialog,SetupPanel}.tsx`
