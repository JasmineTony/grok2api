# Grok2API v3.5.2

## Highlights

- **Upstream-aligned runtime settings**: replaces the horizontal settings strip with the upstream hierarchy and a responsive, project-native vertical navigation surface.
- **Focused provider entry**: `/settings` now resolves to Grok Build, followed by Grok Web and Grok Console in the upstream order.
- **Independent delivery controls**: Media and Network proxy remain separate routes and are positioned together without combining their forms or persistence boundaries.
- **Operational grouping without data loss**: Service capacity and batch-task controls formerly shown as General are retained under Runtime policies ahead of routing, audit, and client-key controls.
- **Independent system information**: About now contains release identity and repository lineage, while Changelog owns update checks, release status, timestamps, and release notes.
- **Cleaner interaction model**: redundant always-visible page actions are removed; reset/save controls appear only when an editable form is dirty.
- **Responsive and accessible**: semantic navigation, Lucide-only icons, visible active/focus states, reduced-motion-safe transitions, and narrow-screen overflow coverage are preserved.

## Compatibility

- No public API, authentication, settings DTO, database schema, migration, provider protocol, or Go module path change.
- Revision-aware full settings saves remain intact across every child route.
- The exact synchronized upstream baseline remains `chenyme/grok2api v3.1.1`.
- Historical delivery branches are reconciled by ancestry without reapplying obsolete v3.4.1 file state.

## Verification

The release is gated by frontend formatting, TypeScript, ESLint, Vitest coverage, production build and bundle audits; authenticated desktop/mobile/cross-browser E2E; Go tests and vet; repository, workflow, secret, container, and published-image health checks.

## Upgrade

Use `ghcr.io/jasminetony/grok2api:v3.5.2` after the release workflow completes. The aliases `3.5.2`, `3.5`, `3`, and `latest` are expected to resolve to the same multi-architecture OCI index.
