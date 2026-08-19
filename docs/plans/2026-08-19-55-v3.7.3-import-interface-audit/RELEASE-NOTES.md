# Grok2API v3.7.3

## Highlights

- Corrected the `grok-4.20-0309-reasoning`, `grok-4.20-0309-non-reasoning`, and
  `grok-4.20-multi-agent-0309` context-window metadata from 2,000,000 to the
  1,000,000 tokens published in the official x.ai model table. The Codex client
  catalog now agrees with the existing `grok-4.3` entry, which already used
  1,000,000.
- Added `.gitignore` coverage for account credential exports matching
  `grok2api-*-accounts-*.json`. These files are produced by
  `GET /api/admin/v1/accounts/export` and carry plaintext access, refresh, and
  SSO tokens, so they must never reach a commit.
- Extended `.gitignore` to the remaining workspace tool caches
  (`.gomodcache`, `.gopath`, `.playwright-mcp`, `__pycache__`) so release
  verification runs against a clean tree.
- Reverified the account import path for all three providers and the full
  registered interface surface against a live account pool; no interface or
  request defect was found beyond the metadata correction.
- Reconfirmed that token, image, video, speech-to-text, and text-to-speech
  pricing, the `grok-4.6` reasoning-effort levels, the streaming and batch
  `vad_threshold` parameter, and `service_tier` passthrough all still match the
  current x.ai documentation.

Routing, pricing, credential handling, and reasoning-effort behavior are
unchanged by this release.

## Stable Container Tags

- `ghcr.io/jasminetony/grok2api:v3.7.3`
- `ghcr.io/jasminetony/grok2api:3.7.3` (`3.7.3`)
- `ghcr.io/jasminetony/grok2api:3.7` (`3.7`)
- `ghcr.io/jasminetony/grok2api:3` (`3`)
- `ghcr.io/jasminetony/grok2api:latest` (`latest`)

## Known Limitations

- `grok-4.6` is not exposed through the Grok Console pool. Console uses a static
  catalog and cannot discover models remotely, and the shared upstream team was
  rate limited throughout verification, so the route could not be confirmed.
  Grok Build continues to serve `grok-4.6` through remote capability discovery.
- Grok Console accounts that belong to one upstream team share that team's
  request-per-second allowance. A saturated team returns
  `429 upstream_rate_limited` for every account in the pool.
- `grok-4.3` and `grok-4.5` still send `reasoning.effort: medium` when a client
  omits the parameter, while x.ai documents `high` as the upstream default for
  `grok-4.5`. This remains a deliberate project-level default.

## Upgrade and Rollback

Back up configuration, databases, media, and persistent volumes before
upgrading. Reusing an existing database requires the exact original
`credentialEncryptionKey`. Roll back to the verified `v3.7.1` image digest and
the pre-upgrade backup; do not move or overwrite the immutable `v3.7.3` tag.
