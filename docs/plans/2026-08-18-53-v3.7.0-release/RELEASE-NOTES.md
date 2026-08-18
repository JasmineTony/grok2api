# Grok2API v3.7.0

## Highlights

- Hardened account lifecycle imports, credential refresh classification, model
  capability synchronization, and provider-specific failure isolation.
- Added WebSocket voice/STT concurrency, active-session, idle-timeout, and
  message-rate safeguards.
- Added non-idempotent upstream replay protection and provider-aware retry
  classification.
- Added media billing reservation lifecycle handling and upstream request,
  WebSocket, and audit queue observability contracts.
- Split configuration/environment boundaries and aligned the admin account API
  DTOs with the maintained frontend.

## Stable Container Tags

- `ghcr.io/jasminetony/grok2api:v3.7.0`
- `ghcr.io/jasminetony/grok2api:3.7.0` (`3.7.0`)
- `ghcr.io/jasminetony/grok2api:3.7` (`3.7`)
- `ghcr.io/jasminetony/grok2api:3` (`3`)
- `ghcr.io/jasminetony/grok2api:latest` (`latest`)

## Upgrade and Rollback

Back up configuration, databases, media, and persistent volumes before
upgrading. Roll back to the verified `v3.6.1` image digest and the pre-upgrade
backup; do not move or overwrite the immutable `v3.7.0` tag.
