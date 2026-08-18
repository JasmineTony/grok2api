# 2026-08-18-45 Provider Concurrency Guard

## Scope

Continue the P1 high-traffic safeguards by adding a distributed-capable
per-provider semaphore to the Selector's unified lease path.

1. Configure independent limits for Grok Build, Grok Web, and Grok Console.
2. Acquire the provider slot together with every account slot, covering text,
   image, video, voice, and Voice WebSocket operations.
3. Release provider and account slots exactly once through `accountLease`.
4. Reuse the existing runtime `ConcurrencyLimiter`, so memory and Redis
   deployments share the same behavior.
5. Keep capacity-wait and saturated-selection behavior consistent.

## Constraints

- Do not read, copy, or modify the three user-provided `2026-08-17.json`
  credential files.
- Use bounded provider names only; do not create per-account or per-model
  metrics/config keys.
- Do not bypass account `MaxConcurrent`; provider capacity is an additional
  upper bound.
- Preserve existing selector retry, sticky-session, and quota-probe behavior.
- Configuration is startup YAML in this iteration.

## Ordered Work

1. Add typed provider concurrency configuration, defaults, validation, example
   values, and tests.
2. Add a canonical provider concurrency runtime key.
3. Add Selector configuration and combined provider/account acquisition.
4. Wire application startup configuration into the Selector.
5. Add focused lease tests for saturation, provider independence, release, and
   account-limit interaction.
6. Run focused tests, full backend tests, `go vet`, Markdown audit, and diff
   checks.

## Acceptance Criteria

- Exhausting one provider limit yields normal saturated selection without
  consuming another provider's capacity.
- Releasing an account lease releases its provider slot exactly once.
- Account concurrency remains enforced below the provider ceiling.
- Memory and Redis implementations require no new runtime interface.
- All local verification gates pass.

## Rollback

Revert only the iteration 46 source, tests, configuration example, and plan
records. No database or account-data rollback is required.
