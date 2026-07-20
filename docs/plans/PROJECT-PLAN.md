# grok2api project plan

## Purpose

Maintain `JasmineTony/grok2api` as an independent, security-conscious derivative of `chenyme/grok2api` while preserving upstream attribution, license obligations, compatibility, and a reviewable synchronization history.

## Repository model

- `origin`: `git@github.com:JasmineTony/grok2api.git`
- `upstream`: `https://github.com/chenyme/grok2api.git`
- Primary branch: `main`
- Preserved legacy branch: `legacy-initial`
- Upstream synchronization: dedicated `sync/upstream-YYYYMMDD` branch and pull request
- No direct automatic force-push synchronization to `main`
- No upstream tags are copied automatically

## Delivery principles

1. Compatibility before namespace or architecture migration.
2. Every behavior fix receives a regression test when practical.
3. Pull requests and `main` always run backend, frontend, Swagger, security, and container verification.
4. A normal branch push never publishes a container image.
5. GHCR publication requires an explicit GitHub Release, a protected `v*` tag, version validation, and approval through the `release` environment.
6. Credentials and sensitive runtime data are never placed in repository documentation.
7. Every future implementation cycle must have an iteration directory under `docs/plans/` containing `PLAN.md` and `RESULT.md`.

## Completed phases

- Independent repository initialization and legacy history preservation.
- Compatibility-oriented README, security, CI, Dependabot, and audit baseline.
- Separation of verification and release workflows.
- GHCR cleanup and protected Release-only publication.
- Final remote, local, workflow, environment, tag, and package verification.
- Durable plan and iteration documentation standard.

## Continuing roadmap

- Review routine Dependabot minor/patch pull requests independently.
- Synchronize upstream only through reviewed pull requests.
- Address unreachable or compatibility-breaking vulnerability findings in dedicated iterations.
- Consider module-path migration only as an explicitly breaking, separately planned release.
- Create release notes and a release iteration before the first new `v*` tag is published.
