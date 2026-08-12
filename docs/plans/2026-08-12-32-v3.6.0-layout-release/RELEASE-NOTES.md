# Grok2API v3.6.0

## Responsive administration layout

- Unified the application shell, page scaffold, page headers, and data-table toolbars so operational pages use a consistent content width, hierarchy, spacing rhythm, and responsive action layout.
- Improved mobile navigation with larger touch targets, visible keyboard focus, stable sidebar scrolling, and automatic visibility of the active settings route.
- Standardized the Models page heading with the shared title and description structure used by other core administration pages.
- Hardened Creative Console flex sizing so model selectors, status messages, and media/chat panels remain contained on narrow screens.
- Reduced Dashboard visual noise while preserving gateway status, period selection, refresh behavior, charts, and deferred rendering.
- Added layout regression landmarks and a mobile test proving that wide data tables scroll inside their own container without causing page-root horizontal overflow.

## Compatibility

- Public APIs, provider routing, authentication, settings semantics, persistence contracts, and the Go module path are unchanged.
- The release remains based on the preserved upstream `v3.1.2` integration delivered in `v3.5.6`.
- Existing desktop behavior, light/dark themes, reduced-motion handling, and release governance remain supported.

## Container images

Use `ghcr.io/jasminetony/grok2api:v3.6.0` after the release workflow completes. The aliases `3.6.0`, `3.6`, `3`, and `latest` are expected to resolve to the same multi-architecture OCI index for `linux/amd64` and `linux/arm64`.

## Upgrade

Back up configuration and persistent data before upgrading. This release does not add a database migration or require new configuration fields. Deployments may remain pinned to the verified `v3.5.6` image until the `v3.6.0` release workflow and published-image health check are complete.
