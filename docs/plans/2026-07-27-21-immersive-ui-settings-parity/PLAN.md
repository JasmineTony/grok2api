# Iteration plan: Immersive UI and settings parity

- Date: 2026-07-27
- Sequence: 21
- Owner: JasmineTony
- Status: In progress
- Base commit: `16d328df1a487afc00b3965d82c9fdc9296629e0`
- Working branch: `feat/immersive-ui-settings-parity`

## Objective

Restore the complete upstream v3.0.10 settings information architecture, fix the network-proxy layout regression, and apply a coherent editorial technology design system across the existing React application without changing API, configuration, database, or module-path semantics.

## Scope

- Add `/settings/about` and `/settings/changelog` while preserving `/settings`, `/settings/media`, and `/settings/network`.
- Keep all editable settings routes inside the same revision-aware `FormProvider`; read-only routes hide save/reset actions but expose dirty-state guidance.
- Fix the network page with a `12rem / minmax(0,1fr)` desktop grid, fixed/sticky section navigation, contained table scrolling, and responsive mobile navigation.
- Preserve the 58-field v3.0.10 settings contract, order, defaults, validation, confirmation flows, and complete DTO updates.
- Add About and rendered release-note pages using the existing safe Markdown boundary.
- Replace runtime custom icons with `lucide-react`, remove `GitHubMark`, and add a CI-enforced UI-symbol audit for raw SVG, emoji, and non-Lucide icon dependencies.
- Introduce OKLCH design tokens, editorial typography, restrained mesh/glow layers, stable motion, reduced-motion support, and shared shell/header/section/card/dialog/empty/loading/error treatments.
- Apply the shared visual language to login, Dashboard, accounts, models, client keys, media, audits, creative console, API docs, and settings without rewriting business behavior.
- Keep expensive routes, charts, dialogs, and Egress operations lazy-loaded and within existing bundle/chunk budgets.

## Out of scope

- Framework migration, React Compiler, a new state-management library, external fonts, or a new animation dependency.
- Backend API, database schema, configuration-key semantics, Go module path, version tag, Release, or GHCR publishing.
- Following upstream commits after `v3.0.10`.

## Implementation steps

1. Close iteration 20 with PR, merge, ancestry, CI, and branch-cleanup evidence.
2. Add settings routes, deferred loaders, prefetch rules, navigation metadata, read-only page behavior, and tests.
3. Fix the network settings grid, Egress containment, lazy dialogs, and responsive navigation.
4. Implement About and Changelog pages with update metadata and safe Markdown rendering.
5. Replace custom runtime icons and add `check:ui-symbols` to `verify` and CI.
6. Refine global tokens and shared shell/header/section/card/dialog/data-state components, then apply page-level composition adjustments.
7. Run full backend, frontend, security, documentation, browser, visual, performance, and container acceptance.
8. Complete `RESULT.md`, push once, create a PR, wait for all required checks, Squash merge, delete the branch, and synchronize local `main`.

## Verification

- Backend: `go test -p 1 ./...`, `go vet ./...`, govulncheck, Swagger no drift.
- Frontend: frozen install, audit, format, typecheck, lint, coverage, build, icons, UI symbols, bundle, chunks, architecture, code, duplicates, unused.
- Settings contract: 58 fields, no duplicates, stable order, locale parity, full DTO behavior, dirty-state preservation, and read-only route behavior.
- Browser: Chromium 1440x900, 768x1024, 375x812 in light/dark; Firefox/WebKit smoke; axe; keyboard navigation; Dialog and table overflow.
- Chrome DevTools: LCP, CLS, long tasks, forced reflow, console, network, and heap summary with no committed raw trace or heap snapshot.
- Repository: Markdown/UTF-8/link/index, conflict markers, Gitleaks, actionlint, Hadolint, Compose config/health, and required GitHub checks.

## Constraints

- No `reset --hard`, force merge, force push, check bypass, upstream tag push, Release, or GHCR action.
- No runtime global mutable state, direct feature `fetch`, direct `localStorage`, dangerous execution API, unhandled Promise/error, duplicated business logic, or route/workspace/container over 500 lines.
- Motion must not shift dense forms, tables, or destructive controls and must respect `prefers-reduced-motion`.
- Settings visual changes must not delete, rename, merge, or reinterpret upstream fields.

## Acceptance criteria

- [ ] Five settings routes work through shared state and direct deep links.
- [ ] Network proxy layout has no document-level horizontal overflow at 375, 768, or 1440 pixels.
- [ ] About and Changelog are read-only, safe-rendered, and dirty-state aware.
- [ ] Runtime UI icons use Lucide and `check:ui-symbols` passes.
- [ ] Shared visual system is visible across all primary routes with reduced-motion support.
- [ ] Settings contract, public interfaces, configuration semantics, database, and Go module remain compatible.
- [ ] Full local and GitHub acceptance passes before Squash merge.