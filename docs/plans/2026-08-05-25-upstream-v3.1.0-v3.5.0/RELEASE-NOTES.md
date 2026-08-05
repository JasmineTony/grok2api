# Grok2API v3.5.0

## Summary

This release integrates the exact `chenyme/grok2api` v3.1.0 release into the independently maintained JasmineTony repository while preserving the independent v3.4.1 compatibility and governance layers.

## Highlights

- **Quality Guard**: optional active probes and passive request audits for Grok Build egress nodes, node quarantine/recovery state, policy hot reload, protected internal client-key access, and the `/quality-guard` administration page.
- **Routing reliability**: same-name model route target pools now preflight account availability, preserve session stickiness, and fail over before sending a physical upstream request.
- **Build failure handling**: improved forbidden/quota/credit classification, exact Build re-auth policy matching, request-scoped 403 handling, and unknown Build 403 traversal without account cooldown penalties.
- **Forced egress probes**: Quality Guard requests carry `ForcedEgressNodeID` through gateway selection, provider requests, CLI transport, and the egress manager.
- **Egress and account isolation**: account/source/node filters, account-isolated upstream connections, bounded cooldown behavior, and quality-prober wiring.
- **Persistence hardening**: PostgreSQL URL validation, fixed-shape large account-pool queries, batched quota recovery reads, and compatible migration from the old global model-route `public_id` unique index to managed-only uniqueness.
- **Provider compatibility**: Console fixed-reasoning behavior, Build client version `0.2.119`, Anthropic thinking-token preservation, and upstream media/provider updates.
- **Independent release governance**: immutable upstream reference, true two-parent merge ancestry, release-only GHCR publication, and multi-architecture image verification.

## Compatibility and migration

Existing `/v1/*` and `/api/admin/v1/*` APIs, configuration semantics, encrypted credentials, SQLite/PostgreSQL data, and Go module path remain compatible. The schema migration removes the obsolete global `model_routes.public_id` uniqueness and adds a managed-only partial unique index so manual route targets may intentionally share a public ID. Back up production data before applying migrations.

Quality Guard is opt-in. Keep `qualityGuard.enabled` false unless the sidecar profile and its protected state directory are configured.

## Verification

The release was validated with focused gateway, persistence, provider, configuration, Quality Guard, frontend typecheck/unit/lint/build, full backend tests/vet, repository audits, CI, CodeQL, protected release jobs, multi-architecture GHCR manifest checks, and `/healthz` smoke. Final commit, PR, annotated tag, workflow, OCI index, alias, platform, and smoke evidence are recorded in `RESULT.md`.
