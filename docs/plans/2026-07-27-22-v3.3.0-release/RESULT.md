# Iteration result: v3.3.0 release and delivery closeout

- Date completed: 2026-07-27 (local acceptance)
- Status: Local acceptance complete; remote delivery pending
- Base commit: `048fd7c8efafb4ac1ee027ac064ab1eddfb82f41`
- Release preparation commit: Pending final local commit
- Release commit: Pending
- Pull request: Pending first push
- Release: Pending

## Delivered locally

- Updated `VERSION` from `v3.2.0` to `v3.3.0`.
- Updated README current-version, exact upstream v3.0.10 relationship, and future GHCR alias guidance.
- Finalized iteration 21 with PR #42, squash SHA `048fd7c8efafb4ac1ee027ac064ab1eddfb82f41`, PR CI, post-merge main CI, CodeQL, and branch-cleanup evidence.
- Added release plan and stable release notes covering upstream v3.0.10, the 58-field settings contract, five settings routes, network layout repair, Lucide governance, and compatibility boundaries.
- Completed the React Router RSC advisory reachability review and recorded the remote alert decision.

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| Iteration 21 remote delivery | Passed | PR #42 passed all 15 checks and squash-merged as `048fd7c8efafb4ac1ee027ac064ab1eddfb82f41`; remote and local feature branches were removed. |
| Post-merge main CI | Passed | CI run `30294101864` and CodeQL run `30294102345` succeeded. |
| pnpm toolchain and frozen install | Passed | Corepack used the repository-local cache for pnpm 11.15.1; the lockfile was already up to date. |
| Dependency audit | Passed with reviewed exception | One High advisory, `GHSA-qwww-vcr4-c8h2`, was ignored by the existing explicit audit boundary because the affected RSC mode is not used. |
| Frontend format, type, lint, unit, build, and audits | Passed | Prettier, TypeScript, ESLint, 14 test files / 39 tests, production build, performance summary, Lucide/UI symbols, bundle, chunks, Knip, code, architecture, and jscpd all passed. |
| Frontend budgets | Passed | CSS 89.76 kB raw; main entry 154.49 kB raw / 52.10 kB gzip; Dashboard charts 339.25 kB raw / 91.59 kB gzip; 86 JavaScript chunks with no cycle. |
| Browser acceptance | Passed | 70 tests passed: Chromium 1440x900, 768x1024, 375x812 plus WebKit smoke. GitHub Linux Firefox remains a required PR gate because the local host has no functional Firefox context. |
| Backend test and vet | Passed | `go test -p 1 ./...` and `go vet ./...` completed successfully with repository-local caches. |
| Reachable Go vulnerabilities | Passed | govulncheck v1.6.0 reported zero affected vulnerabilities and zero vulnerabilities in imported packages; two required-module findings are not called by this code. |
| Swagger | Passed | swag v1.16.6 regenerated Go/JSON/YAML with no tracked drift. |
| Workflow and Markdown lint | Passed | actionlint v1.7.7 completed successfully; Markdown audit passed for all 70 staged Markdown files with valid UTF-8, links, plan pairs, index entries, and completion states. |
| Secret scan | Passed | Gitleaks v8.30.1 scanned an isolated 779-file Git snapshot and found no leaks; local ignored `.cache` artifacts were not treated as source. |
| Diff and conflict markers | Passed | `git diff --cached --check` passed and the staged index contains no merge-conflict markers. |
| Release PR and publication | Pending | No tag, GitHub Release, GHCR image, or upstream tag has been published from this branch. |

## Security advisory review

- GitHub alert #1 / `GHSA-qwww-vcr4-c8h2` targets React Router RSC action handling before 8.3.0.
- Source inspection found only browser imports from `react-router-dom`: `RouterProvider`, `createBrowserRouter`, navigation, route error, link, and blocker hooks.
- Searches found no `react-server-dom`, `createFromFetch`, `createFromReadableStream`, `decodeAction`, `decodeFormState`, React Router server entry point, server action, or RSC endpoint.
- GitHub alert #1 was dismissed as `not_used` at `2026-07-27T18:49:11Z` with an explicit instruction to reopen and upgrade to React Router 8.3.0 or newer before introducing RSC mode.
- The dependency itself was not upgraded in this release because a React Router 8 migration is a separately reviewed major-version change.

## Compatibility and publication boundaries

- No `/v1/*` or `/api/admin/v1/*` endpoint changed.
- No existing configuration key meaning, database field, migration, or Go module path changed.
- No routine dependency update was mixed into the release.
- No credential, cookie, Authorization value, private key, trace, heap snapshot, screenshot, log, or temporary database is tracked.

## Push gate evidence

- First remote push occurred only after final local acceptance: Yes; this staged acceptance record was completed immediately before the first push.
- Final synchronization base: `048fd7c8efafb4ac1ee027ac064ab1eddfb82f41`
- Final local verification: pnpm 11.15.1 frozen install/audit/full verify; 70 browser tests; Go tests/vet/govulncheck; Swagger; actionlint; staged Markdown/diff/conflict scan; isolated Gitleaks.

## Deviations from plan

- Local Gitleaks cannot scan the repository root directly because ignored `.cache` contains downloaded toolchains, dependency test keys, and raw local performance artifacts. The authoritative local scan therefore used an isolated snapshot containing only Git-tracked and intended untracked release files, matching the clean GitHub checkout model.
- Local Firefox remains unavailable. WebKit passed locally, and GitHub Linux Firefox/WebKit is a non-bypassable release PR gate.

## Unresolved and follow-up work

- The release PR, final main checks, annotated tag, GitHub Release, protected environment approvals, GHCR digest, provenance, SBOM, aliases, and smoke evidence remain pending.
- Final immutable Release and GHCR facts will be appended by a post-release documentation closeout PR; the published tag will not move.

## Rollback

- Before publication, revert the release-preparation squash commit through a normal PR if required.
- After publication, deploy the immutable v3.2.0 image digest and create a new patch version; never overwrite or move v3.3.0.

## Final acceptance

- [x] Release metadata and notes are locally complete.
- [x] Local frontend, backend, browser, documentation, and security checks are complete.
- [ ] Release PR and final main checks are complete.
- [ ] Stable Release and GHCR evidence are recorded.
- [ ] Repository state and plan index are finalized.
