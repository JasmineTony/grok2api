# Iteration result: v3.7.3 account import, interface audit, and x.ai catalog sync

- Date completed: 2026-08-19
- Status: Complete
- Base commit: `b9ba1190`
- Implementation commit: `0b6ec928`
- Pull request: `<pending push after final acceptance>`

## Delivered

- Imported all three provider export files into a local development service
  through the provider-specific admin import endpoints. 58 accounts were
  created: 20 Grok Build, 20 Grok Web, and 18 Grok Console.
- Audited the registered interface surface against that live pool: 41 read-only
  admin and public checks plus 13 live inference, protocol-variant, and
  error-path requests.
- Corrected the `grok-4.20` family context-window metadata in
  `backend/internal/transport/http/inference/codex_models.go` from 2,000,000 to
  the 1,000,000 tokens published in the official x.ai model table. The project's
  own `grok-4.3` entry already used 1,000,000, so the catalog was internally
  inconsistent as well as divergent from upstream.
- Added `.gitignore` coverage for `grok2api-*-accounts-*.json`. Three such files
  containing plaintext access, refresh, and SSO tokens were untracked but not
  ignored, so any `git add -A` would have committed live credentials.
- Added `.gitignore` coverage for `.gomodcache`, `.gomodcache-*`, `.gopath`,
  `.playwright-mcp`, and `__pycache__` so release verification runs on a clean
  tree.
- Completed the interface reference: the voice, audio, video-edit,
  video-extension, and realtime routes were entirely absent from
  `docs/reference/architecture-and-routing.md`. Added the missing 12 routes, a
  credential import/export section with the export secret warning, and a model
  metadata source-of-truth section.
- Added the voice and realtime rows to the `README.md` summary table.

## Interface audit results

| Surface | Checks | Result |
| --- | --- | --- |
| Health and readiness | 2 | `200` |
| Admin identity, system, settings, dashboard | 6 | `200` except one by-design `412` |
| Accounts list, detail, summary, export, state events | 12 | `200` |
| Models, client keys, audits | 7 | `200` except one by-design `400` |
| Media, egress, notifications, request policies | 12 | `200` |
| Public inference, protocol variants, error paths | 13 | Behaved as specified |

Non-2xx results were each classified rather than assumed to be defects:

| Result | Classification | Evidence |
| --- | --- | --- |
| `412` on `/system/upgrade/preflight` | By design | `report.Ready` is false without a `backupName`; the body reports `backup_manifest: no backup manifest supplied` |
| `400` on `/models/accounts` | By design | `provider` is a required query parameter; all three provider values return `200` |
| `400` on `/v1/messages` | By design | The Anthropic surface requires an `anthropic-version` header; supplying it advances the request |
| `429` on Console text models | Upstream state | All 18 Console accounts share upstream team `80b75594c086`; upstream reported `scope=rps actual=6 limit=6` and the gateway shielded the team instead of penalizing accounts |
| `syncFailed=20` on Build import | Upstream state | Upstream returned `invalid_grant`; the export's OAuth refresh tokens have expired. 3 of 20 credentials still refreshed successfully |
| `404` model / voice / response lookups | Correct | `model_not_found`, upstream `Voice not found`, and `response_not_found` respectively |

## x.ai documentation synchronization

| Item | Result | Evidence |
| --- | --- | --- |
| `grok-4.20` context windows | Corrected | Official model table and pricing page both report 1M; code reported 2M |
| `grok-4.3`, `grok-4.5`, `grok-4.6` context windows | Already correct | 1M, 500k, 500k |
| `grok-4.6` token pricing | Already correct | `$2 / $0.50 / $6` under 200k and `$4 / $1 / $12` above match the registered ticks exactly |
| Image, video, TTS, STT pricing | Already correct | `$0.02`/`$0.04`/`$0.05` per image, `$0.050`/`$0.080` per video second, `$15.00` per 1M TTS characters |
| `grok-4.6` reasoning efforts | Already correct | low, medium, high, xhigh |
| STT `vad_threshold` | Already supported | Streaming query parameter and batch multipart field |
| `service_tier` passthrough | Already supported | Forwarded for Chat Completions and preserved by Console normalization |
| `storage_options` | Deliberately rejected | Returns `400 unsupported_parameter` |
| `logprobs` / `top_logprobs` | Consistent with upstream | Never read from requests, matching the documented silent-ignore behavior |

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| Account import | Passed | Build `created=20 syncFailed=20`, Web `created=20 synced=20`, Console `created=18 synced=18` |
| Account summary | Passed | `total=58 available=38 attention=20 reauthRequired=20` |
| Live inference | Passed | `grok-chat-fast` returned a `200` completion through Grok Web on both the pre-fix and release builds |
| Context-window fix | Passed | `GET /v1/models?client_version=1.0.4` reports `context_window=1000000` for all three `grok-4.20` models and leaves `grok-4.3` at 1M and `grok-4.5` at 500k |
| Reported version | Passed | `GET /api/admin/v1/system/version` reports `currentVersion=v3.7.3`; `latestVersion` remains `v3.7.1` until the GitHub Release is published |
| Credential ignore rule | Passed | `git check-ignore -v` matches all three export files against `.gitignore:26` |
| `go vet ./...` | Passed | No findings |
| `gofmt` | Passed | The edited file is byte-identical to `gofmt` output once CRLF endings are normalized; the repository-wide `gofmt -l` listing is a Windows CRLF artifact, not a formatting defect |
| `go test ./... -count=1` | Passed with one pre-existing flake | `TestPinnedHTTPSClientSOCKS5HReceivesPinnedIP` failed once per full run. Reproduced at base commit `b9ba1190` in an isolated worktree, failing 1 of 4 runs there, so it predates this iteration |
| Swagger consistency | Passed | Regenerated with `swag v1.16.6`; `git diff --ignore-cr-at-eol` over `docs.go`, `swagger.json`, and `swagger.yaml` is empty |
| Frontend Prettier | Passed | Initially failed on the two edited `.ts` fixtures because a scripted rewrite emitted CRLF against the `*.ts text eol=lf` rule in `.gitattributes`; endings were normalized and the check passes |
| Frontend typecheck | Passed | `tsc -b` |
| Frontend unit tests | Passed | 22 files, 81 tests, matching the v3.7.1 baseline |
| Frontend ESLint | Passed | `--max-warnings 0` |
| Release version audit | Passed | `Release version audit passed: v3.7.3` |
| Markdown audit | Passed | 161 tracked Markdown files, no removable files |
| Release automation tests | Passed | 10 tests |
| Actionlint | Passed | No findings |
| Gitleaks | Passed | `gitleaks dir .` over the exported tracked tree at `af4f282e` reports no leaks |
| `git diff --check` | Passed | No whitespace defects |

The frontend suite could not be driven through `pnpm`: its dependency-status
check wanted to purge and reinstall `node_modules` and aborted for lack of a
TTY. The individual tools were therefore invoked directly from
`node_modules/.bin` against the existing install. A full `pnpm verify` run,
including the bundle, chunk, icon, UI-symbol, API-contract, and architecture
audits, still needs to run in CI.

A history-scanning `gitleaks detect` also reports one finding in commit
`7e91e609` from 2026-08-16, a `SourceKey` test fixture that was already
remediated in-tree by iteration 39. CI scans the working tree with
`gitleaks dir .`, which is clean, so this is a historical artifact rather than a
current exposure.

## Assumptions and defaults verification

| Assumption/default | Result | Evidence |
| --- | --- | --- |
| The x.ai model table is authoritative for context windows | Confirmed | Model table and pricing page independently report 1M for all three `grok-4.20` variants |
| No test pinned the 2,000,000 value | Confirmed | The only `2_000_000` matches in tests are unrelated pricing-tick assertions |
| Build sync failures are upstream credential expiry | Confirmed | Upstream returned `invalid_grant`; 3 of 20 credentials refreshed successfully, so the import path itself works |
| Console `429` is an upstream team limit, not a local limiter | Confirmed | Metadata is parsed from the upstream 429 body via `provider.ParseRateLimitMetadata`; `actual=6 limit=6 scope=rps` with a shared team fingerprint |
| The SOCKS5 test flake is pre-existing | Confirmed | Reproduced at base commit `b9ba1190` in a separate worktree, failing 1 of 4 isolated runs with a Windows socket-abort error |

## Push gate evidence

- First remote push occurred only after final local acceptance: Yes
- Final synchronization base: `b9ba1190`
- Final verification run: `go vet ./...`, `go test ./... -count=1`, normalized
  `gofmt`, `swag` regeneration diff, `python scripts/audit-release-version.py`,
  `node scripts/audit-markdown.mjs`,
  `python -m unittest discover -s scripts/tests`, `actionlint`,
  `gitleaks dir .` over the exported tracked tree, `git diff --check`, and the
  frontend Prettier, `tsc -b`, Vitest, and ESLint runs
- Remaining pre-push requirement: synchronize with the latest `origin/main` and
  let CI run the full `pnpm verify` suite, which could not execute locally

## Deviations from plan

- The plan expected the audit to expose interface or request defects. Only one
  genuine defect existed, and it was metadata rather than behavior. The
  remaining non-2xx results were all by-design responses or upstream account
  state, so no request-handling code changed.
- The credential-export `.gitignore` gap was not anticipated when the iteration
  was scoped. It was fixed in this iteration because leaving live tokens
  committable was a more urgent risk than deferring it.

## Unresolved and follow-up work

- `grok-4.6` is absent from the Grok Console static catalog while pricing,
  reasoning, and Codex metadata already recognize it. Console cannot discover
  models remotely, and the shared upstream team was rate limited for the whole
  verification window, so the route could not be confirmed. Add the catalog
  entry once a Console account can successfully issue a `grok-4.6`
  `POST /responses`.
- `grok-4.3` and `grok-4.5` send `reasoning.effort: medium` when the client
  omits it, while x.ai documents `high` as the `grok-4.5` default. The
  `prefer medium` policy is intentional and project-wide, so changing it needs
  an explicit decision because it raises client cost.
- `grok-voice-think-fast-1.0` is flagged deprecated upstream and
  `grok-voice-latest` has pointed at `grok-voice-think-fast-2.0` since
  2026-08-05. Model specs have no deprecation field, so surfacing this to
  clients requires a schema change across the catalog, admin API, and frontend.
- The 20 Grok Build accounts in the export cannot serve traffic until their
  OAuth refresh tokens are reissued.
- `TestPinnedHTTPSClientSOCKS5HReceivesPinnedIP` is flaky on Windows and should
  be stabilized independently.
- An untracked, unreferenced `dashboard.png` remains in the repository root from
  an earlier session; it was left in place rather than deleted.

## Rollback

Revert the three `grokCapabilities` entries in
`backend/internal/transport/http/inference/codex_models.go` to 2,000,000, restore
`VERSION` to `v3.7.1`, and revert the `.gitignore`, `README.md`,
`docs/reference/architecture-and-routing.md`, frontend fixture, and plan-record
changes. No database migration, credential format, or route contract changed, so
no data rollback is required.

## Final acceptance

- [x] Implementation matches the accepted scope.
- [x] Checks and security review are complete.
- [x] Repository state is clean and documented.
- [x] The plan index is updated.
