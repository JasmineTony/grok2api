# Iteration plan: Grok Build client version sync, accounts page encoding fix, first-account model sync, and 502 remediation

- Date: 2026-08-16
- Sequence: 35
- Owner: JasmineTony
- Status: Planned
- Base commit: `61ed11fb`
- Working branch: `fix/build-client-and-sync-20260816`

## Objective

1. Sync the recommended Grok Build client version used by runtime settings with the newest xAI release (currently above `0.2.119`).
2. Eliminate the mojibake (乱码) seen on the accounts page and audit the remaining administration pages for the same class of defect.
3. Change the models page "sync models" action so only the first account of each of Grok Build / Grok Web / Grok Console is synchronized, instead of every enabled account.
4. Diagnose the 502 responses returned by gateway requests and apply the fixes that follow from the diagnosis.

## Background

- `backend/internal/infra/config/config.go:31` pins `RecommendedBuildClientVersion = "0.2.119"` (set 2026-08-04 by upstream commit `3721babd`). xAI publishes the official CLI as npm package `@xai-official/grok`; its stable line moved to `0.2.120` (2026-08-03), `0.2.121` (2026-08-05), then `1.0.0`–`1.0.4` (2026-08-07 … 2026-08-13). `1.0.5` is currently tagged `alpha`, so `1.0.4` is the newest stable release.
- The `1.0.4` linux-x64 binary was downloaded and inspected: base URL `https://api.x.ai/v1`, paths `v1/responses` / `v1/models`, OAuth endpoints `/oauth2/device/code` + `/oauth2/token`, and the header trio `x-grok-client-version` / `x-grok-client-identifier` / `x-grok-client-mode` (with `headless` mode and `grok-shell` identifier) are all unchanged from what the gateway already sends. A version-constant bump is therefore protocol-safe.
- Accounts page mojibake entry point: `frontend/src/features/accounts/account-page-utils.ts:33-36` reads quick-import token files with `File.text()`, which always decodes as UTF-8. Windows-exported GBK/GB18030 or UTF-16 token files become mojibake that is stored as account names/emails and rendered in the accounts table (`account-name-cell.tsx`). No mojibake exists in the frontend sources themselves (scanned for U+FFFD / GBK-as-UTF-8 patterns); `index.html` declares UTF-8.
- Model sync: `backend/internal/application/model/service.go:431-521` (`syncAllAccounts`) collects every enabled+active account of all three providers and syncs them all (25 workers). `AccountRepository.ListEnabled` orders by `priority DESC, id ASC`, so the "first account" of a provider is simply the first element of that result.
- 502 classification: `backend/internal/application/gateway/failure.go` maps transport errors (`upstream_network_error`), unusable credentials (`upstream_credential_unavailable`), and out-of-range upstream statuses to 502. No local runtime database exists to inspect audit rows; the version staleness is the actionable in-repo cause (xAI deprecating old `x-grok-client-version` values breaks refresh/request paths and surfaces as 502 after retry exhaustion).

## Scope

- Bump `RecommendedBuildClientVersion` to `1.0.4` (User-Agent recomputes automatically) and refresh every test fixture that pins `0.2.119`.
- Make quick-import file reading BOM-aware with strict-UTF-8 validation and GBK/GB18030 fallback in `account-page-utils.ts`, with unit tests.
- Reduce `syncAllAccounts` to at most one account per provider (first by `priority DESC, id ASC`), update affected backend tests and doc comments.
- 502: document the diagnosis, deliver the version fix, and verify no other in-repo regression can be identified statically.
- Update `docs/plans/README.md` index and this iteration's `RESULT.md`.

## Out of scope

- Auto-fetching the client version from the npm registry at runtime (adds an external dependency and supply-chain surface; runtime settings already expose the recommended value for one-click adoption).
- Re-encoding already-corrupted rows stored in deployments' databases (re-import with the fixed reader resolves them).
- `SyncAccount`, `SyncAccounts`, and startup model-catalog catchup paths (they remain per-account by design).
- Creative Console and request-audit base64 rendering (base64 bodies are displayed by design; upstream JSON is UTF-8).

## Implementation steps

1. Verify newest stable `@xai-official/grok` release and protocol compatibility from the published binary (done during planning; record evidence in RESULT.md).
2. Update `RecommendedBuildClientVersion` and dependent tests (`backend` config/settings tests, `frontend` settings-api test fixtures).
3. Implement encoding-aware `readQuickImportFile` plus `account-page-utils` unit tests covering UTF-8 (with/without BOM), UTF-16 LE/BE, and GBK inputs.
4. Change `syncAllAccounts` credential collection to take the first account per provider; update `TestSyncAggregatesCapabilitiesFromAllAccounts` and related tests; adjust comments/SSE semantics as needed.
5. Write the 502 diagnosis into `RESULT.md` including operator follow-ups (audit page filtering, egress node health, runtime settings client version adoption).
6. Run the full verification suite, update `RESULT.md`, sync with `main`, and only then push the branch and open the final pull request.

## Security and compatibility constraints

- No credentials, tokens, or unredacted logs in plan records.
- The version constant is metadata only; request shape, endpoints, and headers stay untouched (verified against the `1.0.4` binary).
- Frontend decoding fallback must never silently alter valid UTF-8 token payloads; strict UTF-8 is attempted first.
- Model sync semantics change is intentional per user request; per-account sync endpoints and startup catchup keep prior behavior.

## Verification

- `cd backend && go test ./...` — all packages pass.
- `cd frontend && pnpm typecheck && pnpm lint && pnpm test --run && pnpm build` — all pass.
- Targeted tests: backend `internal/application/model` and `internal/infra/config`; frontend `account-page-utils` and `settings-api` suites.
- Manual reasoning check: SSE sync progress totals now reflect at most 3 accounts; `PartialSyncError` still reports per-account failures among the selected accounts.

## Risks and rollback

- Risk: xAI enforces behaviors beyond the version header in `1.0.x`. Mitigation: header set/paths verified identical in the binary; runtime settings allow pinning any version without redeploy. Rollback: revert the single constant plus tests.
- Risk: model sync now misses models only visible to lower-priority accounts. Mitigation: per-account sync endpoints still exist; the models page action intentionally trades coverage for cost per the user request. Rollback: revert `syncAllAccounts` selection change.
- Risk: GBK fallback misdetects exotic encodings. Mitigation: only applied when strict UTF-8 decoding fails; tokens are ASCII in practice, so fallback only affects non-ASCII annotation bytes.

## Delivery and push gate

- This PLAN.md is the delivery unit. The branch stays local until all scope items, tests, and acceptance criteria are complete.
- Local checkpoint commits are allowed; no intermediate remote branches or pull requests.
- After final local acceptance: sync with latest `main`, rerun the complete verification suite, update `RESULT.md`, push once, and create the final pull request.

## Assumptions and defaults

- `1.0.4` (dist-tag `latest` as of 2026-08-16) is the correct sync target; `1.0.5` is alpha and excluded.
- "First account" means the first row of `ListEnabled` ordering (`priority DESC, id ASC`) per provider.
- Existing deployments that explicitly saved `provider.build.clientVersion` keep their saved value; the runtime settings page surfaces the new recommendation for adoption.
- The accounts-page mojibake originates from non-UTF-8 quick-import files; in-repo sources are clean.

## Acceptance criteria

- [ ] Objective is delivered.
- [ ] Required checks pass.
- [ ] Documentation is updated.
- [ ] Assumptions and defaults are verified.
- [ ] `RESULT.md` is complete.
- [ ] The plan branch has not been pushed before final acceptance.
