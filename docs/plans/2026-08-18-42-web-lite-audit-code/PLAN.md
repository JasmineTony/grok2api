# 2026-08-18-42 Web Lite Audit Code Consistency

## Scope

Close the remaining observability gap from iteration 41:

1. Preserve a validated provider public error code in image failure audit
   records.
2. Keep existing generic upstream and media post-processing audit codes
   unchanged.
3. Add focused regression coverage for valid and invalid provider codes.

## Constraints

- Do not change the three user-provided `2026-08-17.json` files.
- Do not copy credentials, cookies, tokens, proxy values, or raw upstream
  payloads into source, tests, or plan records.
- Only provider codes accepted by `provider.ErrorPublicCode` may reach audit
  records.
- Preserve `media_postprocessing_failed` precedence and existing HTTP status
  behavior.
- No database migration or configuration change is allowed.

## Ordered Work

1. Inspect the image execution failure branch and existing audit assertions.
2. Add a small image audit-code classifier using the provider public-code
   validator.
3. Use the classifier when image generation or editing returns an error.
4. Add focused tests for valid, invalid, and media post-processing errors.
5. Run focused gateway tests, the full backend suite, `go vet`, and patch
   checks.
6. Record verification, deviations, unresolved external dependencies, and
   rollback notes in `RESULT.md`.

## Verification

- `go test ./internal/application/gateway -count=1`
- `go test ./... -count=1`
- `go vet ./...`
- `git diff --check`

## Acceptance Criteria

- Web Lite parser failures are audited as `web_lite_image_parse_failed`.
- Invalid or unclassified provider codes remain `upstream_unavailable`.
- Media post-processing failures remain `media_postprocessing_failed`.
- Existing gateway and backend tests pass.
- Account JSON files and persistent account data remain untouched.

## Rollback

Revert only the iteration 42 changes in the gateway image implementation,
gateway tests, and plan records. No data rollback is required.
