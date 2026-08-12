# Iteration result: responsive administration layout and v3.6.0 release

- Date: 2026-08-12
- Status: Local acceptance complete; remote publication pending
- Base main commit: `39f0db2361ff336f55ab4a804d96c32e1b99e1d3`
- Layout plan commit: `05daab08feb2e6a70eb00521a504262c07a6f734d`
- Layout implementation commit: `7afd3b1a92eb0e06736167e69a0a2756e23cdbf8`
- Accepted release-material commit: `5d34b7ee324a6bba70958fcee1682d9ff11c203d`
- Pull request: Pending
- Release commit: Pending
- Annotated tag object: Pending
- Release workflow: Pending
- GHCR OCI index: Pending
- Documentation closeout: Pending

## Delivered locally

- Unified application shell, content scaffold, page headers, table toolbars, and responsive layout landmarks.
- Improved navigation touch targets, keyboard focus, sidebar scrollbar stability, and active settings-route visibility.
- Standardized Models page title/description hierarchy and reduced Dashboard visual noise.
- Hardened Creative Console width containment on narrow screens.
- Added a mobile layout regression proving tables scroll locally while the document root remains within the viewport.
- Updated canonical release identity, README, browser fixtures, release assertion, and release notes to `v3.6.0`.

## Local verification results

| Check | Result | Notes |
| --- | --- | --- |
| Public remote baseline | Passed | HTTPS `main` is `39f0db2361ff336f55ab4a804d96c32e1b99e1d3`; latest public Release was `v3.5.6`; no open PRs |
| Remote synchronization | Passed | Public remote main is an ancestor of local accepted branch; no unmerged paths |
| Frontend format/type/lint | Passed | Prettier, `tsc -b`, ESLint zero warnings |
| Frontend coverage | Passed | 16 test files, 47 tests |
| Frontend production build | Passed | Vite build completed; bundle budget passed |
| Frontend audits | Passed | Lucide/UI symbols, chunk cycles, Knip, code, architecture, and jscpd audits passed; one informational CSS Knip hint and six pre-existing low-rate clone blocks |
| Chromium focused layout | Passed | Network settings, layout landmarks, settings hierarchy, and `v3.6.0` about identity all passed |
| Backend test | Passed | `go test -p 1 ./...` with repository-local cache/temp paths |
| Backend vet | Passed | `go vet ./...` |
| Swagger drift | Passed | Swag v1.16.6 regeneration produced no tracked diff |
| Release version audit | Passed | `VERSION`, README, fixtures, assertion, and release notes agree on `v3.6.0` |
| Release automation tests | Passed | 10 tests |
| Markdown audit | Passed | 99 tracked Markdown files; no removable files |
| Git hygiene | Passed | `git diff --check`, unmerged-path check, and conflict-marker review passed |

## Environment notes

- Local Playwright assertions complete successfully, but the Windows Playwright webServer teardown remains running after results are printed and is stopped manually.
- `make` is unavailable locally; the equivalent pinned Swagger command was run directly with repository-local Go cache, module cache, GOPATH, TEMP, and TMP.
- Local `origin` SSH fetch currently lacks the repository-local strict known-hosts file. Public HTTPS remote verification works and is used for synchronization; authenticated delivery will use HTTPS plus the existing in-memory Git credential helper without printing credentials.
- Full Windows desktop/tablet/mobile, Firefox/WebKit, backend race, govulncheck, actionlint, Gitleaks, and container matrix remain authoritative GitHub CI gates before merge.

## Publication evidence

Pending PR, merge, annotated tag, Release, protected release workflow, GHCR manifest, and published-image health proof.

## Unresolved

- Remote branch, PR, tag, Release, GHCR aliases, and documentation closeout have not been published yet.
- Existing local untracked `.claude/`, `.gomodcache/`, `.gopath/`, and Python cache directories remain excluded from the release.
