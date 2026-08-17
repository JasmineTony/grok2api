# Iteration plan: Remove gitleaks false positive from gateway test fixture

- Date: 2026-08-17
- Sequence: 39
- Owner: JasmineTony
- Status: Planned
- Base commit: `d04c5ef1`
- Working branch: `fix/new-model-capability-failover-20260816`

## Objective

修复迭代 38 分支在 CI 工作树密钥扫描中的 `generic-api-key` 告警，同时保留网关故障切换测试的行为覆盖。

## Background

CI 使用 gitleaks v8.30.1 扫描工作树时，将
`backend/internal/application/gateway/service_test.go` 第 179 行的测试账号字段组合识别为通用 API 密钥。该值是确定性的测试夹具，不是真实凭据，但应通过更明确的非密钥表达消除误报，而不是扩大 allowlist。

## Scope

- 调整触发告警的测试账号夹具，使其不再呈现 API 密钥形态。
- 保持账号身份、优先级、能力快照和故障切换断言不变。
- 使用 CI 固定的 gitleaks v8.30.1 命令复核。

## Out of scope

- 不修改生产凭据结构、加密或日志脱敏逻辑。
- 不放宽 `.gitleaks.toml` 的默认检测规则或新增该行 allowlist。
- 不改变迭代 38 的路由和故障切换行为。

## Implementation steps

1. 将触发规则的测试凭据替换为明显的非密钥夹具表达。
2. 运行目标网关测试、完整后端测试、gitleaks 和差异检查。
3. 更新 `RESULT.md` 与计划索引，完成本地验收后仅向现有分支推送必要的 CI 修正。

## Security and compatibility constraints

- 不记录或输出真实凭据及未脱敏扫描结果。
- 不用 allowlist 掩盖新增告警。
- 测试夹具变更不得影响持久化字段、候选选择或重试语义。

## Verification

- `go -C backend test ./internal/application/gateway -run TestGatewayFailsOverFromNewModelObserverToStaleBuildPeer`
- `go -C backend test ./...`
- `go run github.com/zricethezav/gitleaks/v8@v8.30.1 dir . --redact --config .gitleaks.toml --verbose`
- `git diff --check`

## Risks and rollback

- 风险：夹具修改意外改变账号选择。通过保持身份、优先级及断言不变并运行目标测试规避。
- 回滚：revert 本迭代提交；无迁移、配置或生产运行时变更。

## Delivery and push gate

- 本计划是迭代 38 首次推送后 CI 发现问题的同分支修正，符合仓库 CI 修正门禁。
- 在目标测试、后端全量测试、gitleaks 与差异检查全部通过前不推送修正提交。
- 最终只向现有 `fix/new-model-capability-failover-20260816` 分支推送一次必要修正。

## Assumptions and defaults

- CI 告警来自确定性测试夹具，而不是仓库中的真实凭据。
- gitleaks 扫描命令与 `.github/workflows/ci.yml` 固定版本和参数一致。
- `EncryptedAccessToken` 的具体测试字符串不参与该测试的行为断言。

## Acceptance criteria

- [ ] gitleaks v8.30.1 工作树扫描无泄漏告警。
- [ ] 目标测试和后端全量测试通过。
- [ ] 未新增 gitleaks allowlist。
- [ ] 文档和计划索引更新完成。
- [ ] 假设与默认值已验证。
- [ ] `RESULT.md` 完整。
- [ ] 修正提交在最终本地验收前未推送。
