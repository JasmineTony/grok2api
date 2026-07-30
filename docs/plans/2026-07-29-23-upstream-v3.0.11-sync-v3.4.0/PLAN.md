# Iteration plan: upstream v3.0.11 sync, defect fixes, settings page split, v3.4.0 release

- Date: 2026-07-29
- Sequence: 23
- Owner: JasmineTony
- Status: Planned
- Base commit: `49feb91`
- Working branch: `sync/upstream-v3.0.11-20260729`

## Objective

Integrate upstream `chenyme/grok2api` v3.0.11 into the fork, resolve the defects our
fork actually carries (including ones reported in upstream open issues), move the
Grok Build / Grok Web / Grok Console configuration out of the single 网络代理 page
into their own settings pages, and release v3.4.0.

## Background

The fork last synced at upstream v3.0.10 (`c27f054`). Upstream has since tagged
v3.0.11 with 49 commits touching 117 files, mostly backend: deferred credential
hydration for routing, batched account updates, client-key routing scopes, egress
subscription/automation management, response performance metrics, and richer
credential-refresh diagnostics.

Our fork has diverged substantially on the frontend (445 files vs v3.0.10): an
injected `ApiClient` instead of upstream's module-level `apiRequest`, locale files
extracted out of `i18n/index.ts`, and pages refactored into controller/view pairs.
Those choices must survive the merge.

Upstream open issues created after v3.0.10 that we need to triage against our own
code: #824 (unbatched SQL `IN` breaking large pools), #825 (Anthropic Messages
reasoning fields reported as 0), #814 (`reasoningEffort` sent to models that reject
it), #792 (video duration not validated before task creation), #818 (audit time
column too narrow), #815 (per-key upstream model passthrough).

## Scope

- Merge `upstream/main` (v3.0.11) into the fork, preserving fork frontend architecture.
- Resolve every merge conflict, then make backend and frontend gates pass.
- Fix defects found in our own code during the audit, including the pre-existing
  dashboard usage DTO fields that were declared but never populated.
- Restore full i18n key coverage for keys our components reference.
- Split Grok Build / Grok Web / Grok Console out of the 网络代理 page into their own
  settings routes; leave 关于, 更新说明, 媒体, and 网络代理 semantics otherwise unchanged.
- Release v3.4.0.

## Out of scope

- Upstream feature requests that are product decisions rather than defects
  (#823 account risk-control behaviour, #819 model availability, #771 pool capacity
  summaries, #791 automatic Build→Web conversion).
- Rewriting our `ApiClient` abstraction to match upstream's module-level functions.
- Re-authoring upstream's zh-only strings into every future locale beyond zh-CN and en.

## Implementation steps

1. Fetch upstream, create the sync branch, and merge `upstream/main`.
2. Resolve backend conflicts, preferring upstream for routing/persistence hot paths
   and unioning fork-only features (notifications, request-cache metrics, egress
   health history, account state machine).
3. Resolve frontend conflicts, keeping the fork's `ApiClient`, extracted locales, and
   controller/view pages while porting upstream's new capabilities onto them.
4. Propagate upstream's response performance metrics end to end, including the rollup
   table so rollup and raw aggregation agree.
5. Audit our code for the defects behind the upstream issues above and fix what applies.
6. Restore i18n coverage for all referenced keys in both zh-CN and en.
7. Split the provider settings pages and update the settings route/nav wiring.
8. Run the full verification suite; update this plan's `RESULT.md` and the plan index.
9. Bump `VERSION` to v3.4.0 and prepare the release.

## Security and compatibility constraints

- No credentials, tokens, cookies, or unredacted logs in plan records or commits.
- Keep secrets write-only in settings payloads; do not widen any read path.
- Additive database columns only; no destructive migration for existing deployments.
- Preserve existing admin API response shapes; new fields must be additive/optional.
- Settings route changes must keep existing URLs working or redirect them.

## Verification

- `go build ./...` — succeeds.
- `go vet ./...` — no findings.
- `go test ./...` — all packages pass.
- `npx tsc -b` — no type errors.
- `npx eslint . --max-warnings 0` — clean.
- `npx vitest run` — all tests pass.
- `npm run build` — succeeds.
- `npm run check:bundle`, `check:chunks`, `check:icons` — pass.
- i18n audit — zero keys referenced by code but missing from either locale, and zero
  drift between zh-CN and en.

## Risks and rollback

- Risk: a "keep ours" conflict resolution silently drops an upstream fix.
  Prevention: resolve hot-path persistence/routing conflicts toward upstream and
  re-derive fork features on top; verify with the full test suite.
- Risk: rollup and raw dashboard aggregation diverge after adding metrics.
  Prevention: the repository test that compares both paths must pass.
- Risk: settings route split breaks bookmarked URLs.
  Prevention: keep `/settings/network` working and redirect removed tabs.
- Rollback: the merge is a single commit on a dedicated branch; `git revert` the merge
  or reset the branch. Added database columns are additive and safe to leave in place.

## Delivery and push gate

- This PLAN.md is the delivery unit. Keep the branch local until scope, verification,
  acceptance criteria, and assumptions/defaults are complete.
- Local checkpoint commits are allowed; do not create partial remote branches or
  intermediate pull requests.
- Record the final synchronization and verification pass before the first push.

## Assumptions and defaults

- Upstream v3.0.11 is the correct sync target (tag `v3.0.11`, `upstream/main` at `0901045`).
- The fork's `ApiClient`, extracted locales, and controller/view pages are deliberate
  and take precedence over upstream's equivalents.
- Upstream's zh-only new strings need English authored on our side.
- Bundle budgets are regression guardrails, so a justified raise is acceptable when
  the gzip figure that reaches users still has headroom.

## Acceptance criteria

- [ ] Upstream v3.0.11 is merged with no conflict markers remaining.
- [ ] Applicable upstream-reported defects are fixed in our code, with tests.
- [ ] Grok Build / Grok Web / Grok Console have their own settings pages, and
      关于 / 更新说明 / 媒体 / 网络代理 keep their existing behaviour.
- [ ] Every verification command above passes.
- [ ] i18n coverage is complete in both locales.
- [ ] `VERSION` is v3.4.0 and release notes are updated.
- [ ] `RESULT.md` and `docs/plans/README.md` are current.
- [ ] The plan branch has not been pushed before final acceptance.
