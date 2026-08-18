# Grok2API v3.7.1

## Highlights

- Corrected saved-credential decryption failures that were previously
  classified as upstream network `502` errors.
- Public OpenAI- and Anthropic-compatible inference endpoints now return a
  sanitized `503 upstream_unavailable`, while audits retain the stable
  `credential_decryption_failed` diagnostic code.
- Preserved the actionable admin quota-sync `409` response instructing
  operators to restore the original `credentialEncryptionKey` or re-import the
  affected account.
- Applied the same credential classification and audit behavior to REST voice
  and realtime voice WebSocket setup paths.
- Reverified `grok-4.6` same-provider account failover and confirmed that the
  v3.5.1-to-v3.7.1 Compose mount, persistent-data, and encryption-key contracts
  have no material deployment change.

## Stable Container Tags

- `ghcr.io/jasminetony/grok2api:v3.7.1`
- `ghcr.io/jasminetony/grok2api:3.7.1` (`3.7.1`)
- `ghcr.io/jasminetony/grok2api:3.7` (`3.7`)
- `ghcr.io/jasminetony/grok2api:3` (`3`)
- `ghcr.io/jasminetony/grok2api:latest` (`latest`)

## Upgrade and Rollback

Back up configuration, databases, media, and persistent volumes before
upgrading. Reusing an existing database requires the exact original
`credentialEncryptionKey`; this release cannot recover ciphertext encrypted
with a different key. If that key is unavailable, re-import the affected
accounts. Roll back to the verified `v3.7.0` image digest and the pre-upgrade
backup; do not move or overwrite the immutable `v3.7.1` tag.
