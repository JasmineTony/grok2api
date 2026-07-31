# Result — Upstream v3.0.11 sync, defect fixes, settings split, v3.4.0

- Date: 2026-07-31
- Sequence: 23
- Owner: JasmineTony
- Status: Complete
- Working branch: `sync/upstream-v3.0.11-20260729`
- Release: `v3.4.0`

## Commits

| Commit | Subject |
| --- | --- |
| `6dbb21a` | `sync: merge upstream v3.0.11` |
| `7b55c11` | `fix: batch routing ID queries and report Anthropic reasoning tokens` |
| `d89ce3c` | `feat(settings): give Grok Build, Web, and Console their own pages` |
| `b2e5017` | `fix(console): clamp reasoning effort to what each model accepts` |

Branch: `sync/upstream-v3.0.11-20260729`. `upstream/main` (`0901045`) is a parent of `6dbb21a`.

## Upstream merge

49 upstream commits across 117 files were merged, with 34 conflicting files resolved by hand.
The resolutions kept both sides rather than choosing one:

- `dashboard`: the fork's cost/cache metrics plus upstream's first-token and throughput metrics.
  While reconciling `toUsageDTO`, `tokenCacheHitRate` and `requestCacheHitRate` were found declared
  but never computed, and four cost/cache DTO fields were never populated — both are now fixed.
- `audit`: upstream's billing breakdown and first-token fields plus the fork's request-cache flags.
- `egress`, `selector`, `account_repository`: upstream's batching, invalidation bus, and richer
  refresh diagnostics plus the fork's notifications, account runtime state, and health history.

The merge commit had auto-resolved the frontend conflicts in favour of this fork, which silently
dropped upstream's frontend work. The behavioural additions were recovered deliberately: the
performance/billing fields in the audit and dashboard decoders (these decoders are strict, so a new
backend field would otherwise be rejected), and the cursor-based account export.

## Defects fixed

**#824 — large account pools.** SQLite allows roughly 32766 bound parameters per statement, so a
pool past that size failed with `upstream_unavailable` before reaching the upstream.
`CountProviderAccountsByIDs` now chunks through `forEachAccountIDBatch`. The `attachAccountLinks`
call sites were audited and left alone: all three are already bounded by pagination or a single
record.

**#825 — Anthropic reasoning tokens reported as 0.** Anthropic bills thinking inside
`output_tokens` and sends no reasoning field, while the parser only read
`output_tokens_details.reasoning_tokens` and `completion_tokens_details`. Reasoning is now derived
from `thinking` content blocks and accumulated `thinking_delta` frames, capped at `output_tokens`;
an upstream-reported count still wins.

**#814 — `reasoningEffort` rejected by Console.** `SupportsReasoningEfforts` already described each
model's real levels but had no callers, so any recognized level was forwarded to any
reasoning-capable model and the upstream rejected the whole request. Console now clamps to the
nearest supported level. One existing test asserted `xhigh` passing through for `grok-4.3`, which
encoded this defect — `grok-4.3` publishes only low/medium/high aliases, so the assertion was
corrected. The Build path already clamped `xhigh`/`max`, so only Console was affected.

**Account export above 10000 accounts.** The unpaginated endpoint refuses larger pools outright, so
export was impossible for the pool sizes in #824. The admin UI now walks the cursor endpoint and
merges each page into one document, rejecting a non-advancing cursor.

Not reproduced in this fork: **#792** (video duration is already rejected outside 1–15s) and
**#818** (the fork's audit table differs from the reported layout).

## Settings split

Grok Build, Grok Web, and Grok Console moved from tabs inside 网络代理 to their own routes
(`/settings/build`, `/settings/web`, `/settings/console`); 网络代理 now holds only egress proxy
nodes and operations. 关于, 更新说明, and 媒体 are unchanged. The pages share one form through
`SettingsRouteContext`, so edits survive navigation and still save as a single DTO. The now-unused
`SettingsProviderPanels` and `SettingsPane` were removed.

## Verification

| Check | Result |
| --- | --- |
| `go build ./...` | pass |
| `go vet ./...` | pass |
| `go test ./...` | pass, no failures |
| `pnpm verify` (format, typecheck, lint, coverage, build, bundle, chunks, knip, architecture, duplicates) | exit 0 |
| Frontend tests | 41 passed / 14 files |
| Route ↔ nav ↔ i18n cross-check | 863 keys resolve in both locales; no nav entry points at an unregistered route |

Each fixed defect has a test that failed before its fix: the batching tests exercise a 33000-ID
slice, and the Anthropic and Console tests were confirmed red before the change.

## Deviations

- The upstream frontend diff was adopted selectively rather than file-for-file, because this fork
  has restructured the same files (route-per-section settings, `ApiClient` class). Upstream's
  mobile-drawer and page-level UI changes were not taken; the API contract additions were.
- Feature-request issues (#815, #819, #823, #771, #791) are out of scope for this release.

## Unresolved

- `exportAllAccountsAsBlob` merges pages in memory. That is bounded by the pool size and adequate
  for the ~40k pools in #824, but a streaming download would scale further.
- The Anthropic reasoning count is a 4-chars-per-token estimate, since Anthropic reports no exact
  figure. It is labelled as derived and never exceeds `output_tokens`.

## Rollback

`git revert b2e5017 d89ce3c 7b55c11` reverts the fixes and the settings split while keeping the
upstream merge. Reverting `6dbb21a` as well returns to `v3.3.0`. No migrations run in one
direction only, so a rollback needs no database work.
