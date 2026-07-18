# Coding standards

How code is written in this repo, derived from what's already here. Match the
surrounding code first; the rules below are the patterns that recur.

## Language & modules

- **TypeScript, strict.** `tsconfig.json` sets `strict`, `noUncheckedIndexedAccess`,
  and `verbatimModuleSyntax`. Honour all three: no implicit `any`, treat indexed
  access as possibly-`undefined`, and use `import type` for type-only imports.
- **ESM only** (`"type": "module"`). Relative imports carry the `.js` extension
  even though the source is `.ts` — e.g. `import { deriveStage } from './derive.js'`.
  `moduleResolution` is `bundler`.
- **Target Node ≥ 20**, package manager **pnpm** (`pnpm@10.x`). Use `node:` prefixes
  for builtins (`node:fs/promises`, `node:path`, `node:child_process`).
- No ESLint/Prettier config is checked in. Keep to the existing style: 2-space
  indent, single quotes, no semicolons, trailing commas in multiline literals.

## Architecture patterns

- **Derive, don't store.** State is computed from artifacts, never written to a
  side database (ADR-0001, ADR-0002). Before adding a field that records state,
  ask whether it can be derived from the tracker or git instead.
- **Pure core, I/O at the edges.** Derivation is a pure function with no I/O and no
  clocks (`src/gating/derive.ts`) so its output can never drift. Push side effects
  to the boundary and keep the decision logic pure and directly testable.
- **Seams for every external dependency.** External commands and services go behind
  a small injectable interface with a `default*` implementation and an optional
  parameter for tests: `Exec` (`src/setup/exec.ts`), `TrackerAdapter`
  (`src/tracker/types.ts`), `PRSource`/`RepoResolver` (`src/gating/types.ts`).
  Tracker-specific quirks live inside adapters and never leak above the seam.
- **Interfaces are question- or verb-shaped.** Reads are phrased as the questions
  the caller asks (the gate questions); writes are named for intent
  (`stamp`/`unstamp`, `attach_pr`, `resolve_issue`), not for the mechanism.

## Comments

- Comments explain **why**, not what. The file header comment states the module's
  job and the constraint it exists to satisfy.
- **Cite the source of a decision** inline: ADRs (`ADR-0002`) and issue/section
  refs (`#7 §6`, `#11`, `#41`). When a rule looks surprising, the comment says which
  issue forced it. Keep this convention when you add non-obvious code.

## Tests

- **Vitest**, run with `pnpm test` (`vitest run`). Type-check separately with
  `pnpm typecheck` (`tsc --noEmit`).
- Two projects (`vitest.config.ts`): `server` (node env, covers
  `server,cli,adapters,tracker,gating,pipeline,setup`) and `ui` (`src/ui/**`).
- **Colocate tests** as `<name>.test.ts` next to the source. Style is
  `describe`/`it` with focused `expect`s.
- **Test through the seams.** Inject a fake `Exec`/adapter rather than mocking
  modules — e.g. `fakeInstaller` in `src/setup/skills.test.ts` records calls and
  materialises fixtures. Use real temp dirs (`mkdtemp` under `tmpdir()`) and clean
  up in `afterEach`.
- Prefer exercising pure functions directly with plain input objects (see the
  gating tests) over end-to-end setup.

## Frontend (`src/ui`)

- **React 19**, no RSC, `.tsx`. Components in `src/ui/components`, primitives under
  `components/ui`. The `@/*` alias maps to `src/ui/*` (tsconfig + vite + vitest).
- **shadcn on Base UI** (`components.json`, style `base-nova`, base color `neutral`,
  CSS variables). Add primitives via the shadcn CLI rather than hand-rolling.
- **Tailwind v4** with the CSS-variable theme in `src/ui/styles.css`. Merge classes
  with the `cn` util (`@/lib/utils`); icons from **lucide-react**.
- Keep view state and derivation out of components: selectors are pure and
  component-free (`src/ui/lib/derive.ts`), mirroring the server's derive-don't-store
  discipline.

## Domain language

Use the vocabulary from [`CONTEXT.md`](../../CONTEXT.md) and
[`glossary.md`](./glossary.md) in names, types, and messages. Respect the _Avoid_
synonyms. If a concept isn't in the glossary, that's a gap to resolve, not a
synonym to invent.
