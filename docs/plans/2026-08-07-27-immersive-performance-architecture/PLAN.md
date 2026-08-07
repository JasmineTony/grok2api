# Iteration plan: immersive UI, Lucide governance, and full-stack performance architecture audit

- Date: 2026-08-07
- Sequence: 27
- Owner: JasmineTony
- Status: In progress
- Base commit: `1a332e4`
- Working branch: `codex/immersive-performance-architecture`

## Objective

Raise the current Grok2API operations console to a coherent high-end visual system while preserving accessibility and performance: enforce Lucide-only icons and zero emoji in UI copy, modernize shared shell and high-frequency surfaces with an experimental but usable visual language, remove avoidable frontend render/network costs, inspect backend request/query/serialization hotspots, and document an architecture audit with verified fixes.

## Background

- v3.5.1 is published and must remain immutable.
- The project already contains Lucide, Radix, Tailwind, React Query, architecture/code audits, and performance-summary tooling; this iteration should build on those foundations rather than introduce a second design system.
- The user explicitly requests Awwwards-level visual quality, immersive interaction, no emoji, and full-stack performance/architecture review.

## Scope

- Audit all frontend icon and emoji usage, shared shell/theme/tokens, dense admin pages, loading/error/empty states, and responsive/accessibility behavior.
- Establish a Lucide/icon policy and a small set of reusable visual primitives/tokens for the shell and high-frequency pages.
- Apply a focused visual refresh to shared navigation/header, dashboard or landing surface, and one dense administration surface without sacrificing information density.
- Audit and fix high-confidence frontend render, bundle, image, query-cache, and interaction costs.
- Audit and fix high-confidence backend request parsing, database query, serialization, caching, and response-header opportunities.
- Add regression/audit coverage for no emoji, icon imports, accessibility, and performance-sensitive behavior.
- Update this plan's RESULT.md and plan index after verification.

## Out of scope

- Changing public API contracts, authentication semantics, encryption keys, database migration format, or the immutable v3.5.1 tag.
- Replacing the existing frontend framework or adding a large animation/runtime dependency.
- Decorative motion that blocks keyboard navigation, increases motion for reduced-motion users, or materially worsens bundle/startup cost.

## Implementation steps

1. Capture baseline repository state and run targeted icon/emoji, bundle, architecture, and backend hotspot searches.
2. Define and implement shared visual tokens/primitives and Lucide-only enforcement.
3. Refresh shared shell and selected high-frequency pages with responsive, reduced-motion-safe interaction.
4. Optimize frontend render/query/resource paths identified by the audit.
5. Optimize backend request/query/serialization paths identified by the audit.
6. Run focused tests, full frontend verification, backend tests/vet, audits, and diff checks.
7. Update RESULT.md and docs/plans/README.md only after acceptance; keep the branch local until final acceptance.

## Security and compatibility constraints

- Preserve existing auth/session, API, credential redaction, CSP/egress, persistence, and failure taxonomy behavior.
- Do not render untrusted Markdown/HTML or user-controlled URLs through new visual primitives.
- Keep Lucide imports tree-shakeable and avoid dynamic icon names from untrusted input.
- Respect `prefers-reduced-motion`, keyboard navigation, WCAG contrast/focus requirements, and existing API response schemas.

## Verification

- `cmd /c pnpm verify`
- `cmd /c pnpm test:e2e` or the focused authenticated route suite
- `go test -p 1 ./...`
- `go vet ./...`
- `node frontend/scripts/check-icon-imports.mjs`
- `node frontend/scripts/audit-codebase.mjs`
- `node frontend/scripts/audit-architecture.mjs`
- emoji/unicode audit and `git diff --check`
- document measured bundle/request/query changes and known host-only limitations

## Risks and rollback

- Risk: visual effects regress accessibility or bundle size. Prevention: shared CSS tokens, reduced-motion variants, budgets, and screenshot/a11y checks. Rollback: revert the iteration branch.
- Risk: query optimizations alter pagination or authorization. Prevention: preserve response schemas and add focused regression tests. Rollback: revert only the backend optimization commit.

## Delivery and push gate

- This PLAN.md is the delivery unit. Keep the branch local until all in-scope implementation, tests, and acceptance criteria are complete.
- Do not push a partial redesign or create intermediate PRs.
- Record the final synchronization and verification pass before the first push.

## Assumptions and defaults

- Existing Lucide/Radix/Tailwind primitives are the default implementation path.
- “Awwwards-level” means a coherent visual system, intentional typography/layout, accessible motion, and measured performance—not gratuitous effects.
- Initial implementation prioritizes shared shell plus high-frequency pages; a follow-up plan may cover remaining low-traffic surfaces.

## Acceptance criteria

- [ ] Objective is delivered.
- [ ] Required checks pass.
- [ ] Documentation is updated.
- [ ] Assumptions and defaults are verified.
- [ ] `RESULT.md` is complete.
- [ ] The plan branch has not been pushed before final acceptance.
