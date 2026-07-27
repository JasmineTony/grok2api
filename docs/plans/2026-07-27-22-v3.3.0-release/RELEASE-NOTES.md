# Grok2API v3.3.0

Grok2API v3.3.0 advances the independently maintained gateway to the exact upstream v3.0.10 protocol baseline while preserving the repository's reliability, security, compatibility, and operational governance.

## Highlights

- Preserves the full upstream `v3.0.10@c27f0545197b3edf41d5deedcc2c3c3597887766` ancestry.
- Restores the complete 58-field runtime settings contract and unlimited-retry behavior.
- Splits settings into General, Media, Network Proxy, About, and Changelog routes while preserving one revision-aware form session.
- Repairs the Network Proxy layout across mobile, tablet, and desktop viewports, including contained Egress table scrolling.
- Standardizes runtime UI icons on Lucide and adds automated checks against emoji, non-Lucide icon dependencies, and unauthorized raw SVG.
- Adds safe-rendered release notes and version/update information without rendering executable HTML.
- Refines the shared OKLCH light/dark visual system and reduced-motion behavior without adding runtime dependencies.
- Retains account-state safety, stable failure codes, request policy, Egress isolation, metrics, notifications, and additive database migrations.

## Security and compatibility

- No reachable Go vulnerability was found by govulncheck v1.6.0.
- React Router advisory `GHSA-qwww-vcr4-c8h2` affects RSC server-action handling; this Vite browser SPA does not expose RSC streaming, server actions, or an RSC endpoint. A React Router 8 major upgrade remains a separately reviewed dependency migration.
- No `/v1/*` or `/api/admin/v1/*` endpoint was removed or renamed.
- Existing configuration semantics, database fields, and the Go module path remain compatible.
- No credential, cookie, token, private key, trace, heap snapshot, screenshot, or temporary database is included.

## Container publication

The protected release workflow publishes and verifies:

- `ghcr.io/jasminetony/grok2api:v3.3.0`
- `ghcr.io/jasminetony/grok2api:3.3.0`
- `ghcr.io/jasminetony/grok2api:3.3`
- `ghcr.io/jasminetony/grok2api:3`
- `ghcr.io/jasminetony/grok2api:latest`

The final workflow builds amd64 and arm64 images, attaches provenance and SBOM metadata, creates the multi-architecture manifest, and runs `/healthz` against the published image.
