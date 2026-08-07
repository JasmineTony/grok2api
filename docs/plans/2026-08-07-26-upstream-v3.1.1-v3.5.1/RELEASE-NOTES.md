# Grok2API v3.5.1

## Summary

This release integrates the exact `chenyme/grok2api` v3.1.1 tag into the independently maintained JasmineTony repository with true merge ancestry. It preserves the v3.5.0 reliability, settings, Egress, Quality Guard, security, and release-governance layers while adding upstream Console and model-routing improvements.

## Highlights

- **Grok Console DPoP**: bounded LRU session caching, singleflight token exchange, DPoP proof generation, token/key binding checks, and one-time unauthorized refresh.
- **Console media support**: image generation/editing, localized image assets, video generation and polling, trusted-host validation, bounded response reads, and Console asset egress scopes.
- **Console quota lifecycle**: authoritative chat/image/video usage snapshots, distributed refresh coordination, bounded retry jitter, incomplete-snapshot migration, and conservative recovery probes when upstream reset times are absent.
- **Grouped model routing**: capability-aware model groups are paginated in the database, availability is annotated in batches, and the administration UI displays complete route groups without fetching the full model table.
- **Credential import hardening**: batch limits, JSON-document handling, UTF-8 validation, and deterministic Web-to-Console credential conversion reduce malformed or unexpectedly large imports.
- **Dependency stabilization**: 34 compatible frontend direct dependencies and two Go direct dependencies were updated only after a conservative cutoff of `2026-08-04T16:00:00Z`; every selected release predates that cutoff. `@testing-library/jest-dom` remains at 6.9.1 because 6.10.0 was rejected by pnpm as a broken release.
- **Review fixes**: synchronized English/Chinese Egress fallback keys, split the grouped models view into architecture-compliant components, separated Fast Refresh-safe component and utility exports, memoized the form schema, corrected stricter TypeScript ESLint findings, and added grouped-model regression tests.

## Compatibility and migration

Existing `/v1/*` and `/api/admin/v1/*` APIs, configuration semantics, encrypted credentials, SQLite/PostgreSQL data, and the Go module path remain compatible. Startup migrations retain capability-aware managed model-route uniqueness and upgrade existing Console quota/media state in place. Back up production data before deploying any schema-bearing release.

The ignored npm advisory `GHSA-qwww-vcr4-c8h2` affects only React Router's unstable RSC APIs. This Vite SPA does not enable the unstable RSC mode; the existing explicit audit exception remains scoped to that advisory.

## Verification

The release candidate is validated with full frontend format/type/lint/unit-coverage/build/bundle/chunk/icon/unused/code/architecture/duplicate gates, backend tests and vet, focused persistence/provider/account/model tests, dependency timestamp evidence, npm audit review, Swagger drift checks, repository audits, CI, CodeQL, protected release jobs, multi-architecture GHCR manifest checks, and published-image `/healthz` smoke. Final remote evidence is recorded in `RESULT.md` after publication.
