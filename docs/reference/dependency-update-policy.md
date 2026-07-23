# Dependency update policy

## Release cadence

Routine dependency upgrades are performed during preparation for the next project major release, such as `v4.0.0`. Patch releases on the current `v3.1.x` line do not include routine Go, pnpm, Docker, or GitHub Actions upgrades.

Dependabot version-update entries remain in `.github/dependabot.yml` with `open-pull-requests-limit: 0`. A major-release preparation plan must explicitly raise those limits on a dedicated dependency branch, regenerate lock files, review changelogs, and run the complete backend, frontend, browser, security, and container verification suite.

## Security exception

Dependency graph, Dependabot alerts, and Dependabot security updates remain enabled for the default branch. A compatible security fix does not wait for a major release:

1. Create a dedicated `security/dependency-*` iteration and pull request.
2. Limit changes to the affected dependency and required transitive lock-file updates.
3. For GitHub Actions, pin the reviewed immutable commit SHA and retain the version comment.
4. Run vulnerability, compatibility, protocol, browser, and container checks appropriate to the dependency.
5. Block a release for reachable or direct Critical/High vulnerabilities until fixed or explicitly documented when no compatible fix exists.

Unreachable, indirect, or unpatched findings must record reachability, affected paths, upstream status, mitigation, and the condition for reopening the decision.

## Upstream synchronization

An upstream synchronization does not provide a general dependency-upgrade window. Dependency manifest changes are accepted only when they are inseparable from the exact upstream release being synchronized or are required security fixes. Unrelated dependency changes are deferred to the next major-release dependency plan.
