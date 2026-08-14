# Grok2API v3.6.1

Grok2API v3.6.1 preserves the independently maintained administration experience and integrates upstream `main` through `86ae605717087c2df479dc8a268219d3ad8fe731` with true merge ancestry.

## Highlights

- Fixed viewport, scrolling, and long-text behavior across filter menus, dropdowns, popovers, selects, and dialogs.
- Made model synchronization observable through heartbeat, progress, and terminal SSE events instead of failing silently.
- Added Egress health filtering, previewed bulk cleanup of unusable proxy nodes, per-subscription upstream proxy settings, and visible subscription synchronization state.
- Preserved the split settings routes while aligning routing, clearance, connection-isolation, segmented-selector, and video-attempt fields with the backend contract.
- Added bounded video create-phase account failover, duplicate-task prevention, safe download filenames/extensions, validated public playback URLs, and safe fallback behavior.
- Enabled bounded segmented selection by default for pools with at least 3,000 eligible accounts while retaining quota/tier priority, sticky sessions, full-planner fallback, and atomic concurrency guards.
- Added precise account-health invalidation for large pools and improved key-copy reliability on LAN deployments.
- Preserved Console video, Voice, TTS, STT, Realtime, API documentation, and deterministic Swagger coverage from the upstream-parity delivery.
- Retained the Go 1.26.6 security baseline and independent repository release controls.

## Upgrade and compatibility

v3.6.1 includes compatible automatic incremental database migrations at startup. Before upgrading, back up `config.yaml`, the database, media directory, and all persistent volumes. Keep the verified v3.6.0 image digest and the pre-upgrade backup available for rollback; do not move the immutable v3.6.1 tag after publication.

Legacy settings responses that omit `routing.videoMaxAttempts`, or persist it as `0`, are normalized to `999`. Explicit `-1` unlimited and positive finite limits remain supported. Existing persisted segmented-selector choices continue to override new-install defaults.

Public API routes, provider identities, Go module paths, split settings routes, and encrypted credential storage remain compatible.

## Container images

After the protected release workflow completes, the same multi-architecture OCI index is published with aliases `3.6.1`, `3.6`, `3`, and `latest`:

- `ghcr.io/jasminetony/grok2api:v3.6.1`
- `ghcr.io/jasminetony/grok2api:3.6.1`
- `ghcr.io/jasminetony/grok2api:3.6`
- `ghcr.io/jasminetony/grok2api:3`
- `ghcr.io/jasminetony/grok2api:latest`

The release workflow verifies Linux amd64 and arm64 manifests and runs the published image `/healthz` smoke check before closeout.
