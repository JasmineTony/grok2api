# Grok2API v3.4.1

## Highlights

- Split the remaining runtime settings into clear **General**, **Runtime policies**, and **Account maintenance** pages.
- Added deep links at `/settings/policies` and `/settings/accounts` while keeping `/settings` backward compatible.
- Preserved the shared revision-aware form: unsaved changes survive navigation inside settings and saves still submit the complete compatible DTO.
- Kept Grok Build, Grok Web, Grok Console, Media, Network proxy, About, and Changelog as independent lazy-loaded pages.
- Expanded route, field-ownership, three-viewport, and WebKit regression coverage for the new settings boundaries.

## Compatibility

- No changes to `/v1/*` or `/api/admin/v1/*` contracts.
- No database migrations, configuration-key renames, dependency upgrades, or Go module path changes.
- Existing `/settings`, provider, media, network, about, and changelog URLs remain valid.

## Upstream lineage

This release remains based on upstream `chenyme/grok2api` v3.0.11 (`090104504b403d65675a01dab9c92b3a235ee832`) and preserves the independent repository reliability, security, Egress, and UI governance layers.
