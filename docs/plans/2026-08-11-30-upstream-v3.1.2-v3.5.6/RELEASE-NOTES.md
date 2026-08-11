# Grok2API v3.5.6

## Upstream v3.1.2 integration

- Integrated the exact upstream `v3.1.2` commit through a true merge so upstream ancestry remains auditable.
- Added Web Gateway citation handling and Responses streaming improvements while preserving the independent provider routing and reliability layers.
- Added Build bot-risk scheduling exclusion, provider stream-idle timeouts, Console clock-skew tolerance, and expanded request-audit filtering and error classification.
- Added transient image ingestion for video workflows from local uploads and approved remote URLs, retaining SSRF protections and existing media contracts.
- Added Egress subscription-proxy configuration and hardened subscription synchronization without replacing the independent Egress operations UI.
- Preserved the independent split settings routes, revision-aware saves, Lucide-only interface contract, Quality Guard, release automation, and public API compatibility.
- Corrected dashboard and usage-rollup success accounting so any request with an error code is classified as failed even when its HTTP status is 2xx.

## Compatibility

- Existing public API routes and established response contracts remain compatible.
- Runtime settings receive additive fields for stream-idle timeouts, Build bot-risk scheduling, and subscription proxy behavior.
- Persistence upgrades are additive and covered by upgrade tests; existing data remains supported.
- The independent settings navigation and Go module path remain unchanged.

## Container images

Use `ghcr.io/jasminetony/grok2api:v3.5.6` after the release workflow completes. The aliases `3.5.6`, `3.5`, `3`, and `latest` are expected to resolve to the same multi-architecture OCI index for `linux/amd64` and `linux/arm64`.

## Upgrade

Back up configuration and persistent data as usual before upgrading. Existing deployments may continue with their current configuration; review the new optional stream-idle, Build scheduling, and subscription-proxy settings when those controls are needed.
