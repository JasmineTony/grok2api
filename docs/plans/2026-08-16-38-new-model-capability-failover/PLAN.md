# Iteration plan: Restore Grok 4.5/4.6 multi-account failover after first-account model sync

- Date: 2026-08-16
- Sequence: 38
- Owner: JasmineTony
- Status: Complete
- Base commit: `f53bbaae` (main after PR #66)
- Working branch: `fix/new-model-capability-failover-20260816`

## Objective

修复 grok-4.5 / grok-4.6 请求在首个 Build 账号传输失败后无法切换到同等级账号、最终返回 502 的回归，同时保持“模型页每个 Provider 只请求第一个账号”的需求。

## Background

1. 已用受信任本地 HTTPS mock 上游完整复现 Build 请求链：账号导入/模型同步后，grok-4.5 与 grok-4.6 的 Responses 流式和非流式请求均返回 200；实际转发请求体（model、tools、prompt_cache_key、stream）正确，排除请求构造与模型名问题。
2. `backend/internal/infra/provider/cli` 与 `upstream/main` 无差异，排除 Provider 适配器 fork 回归。
3. 迭代 35 将手动模型同步从“所有账号”改为“每 Provider 第一个账号”。`syncAccountCapabilities` 不仅更新公共路由，还只替换第一个账号的能力快照。
4. 选择器把“已有成功快照但缺少该模型”的其他账号视为明确不支持并排除。对新发现的 grok-4.5/4.6，这会把故障切换池缩成首账号；首账号网络失败后即返回 502。上游仍同步全部账号，因此不会出现该退化。
5. 代码只对 Build Super 账号实现了同等级动态模型共享，而且把推断直接标记为支持；combined 与 layered 两条候选路径都缺少按快照时间区分新模型与更新负快照的语义。

## Scope

- 将 Build 动态模型回退扩展为按 entitlement 分组：Super 与非 Super 两组互相隔离。
- 仅当同组支持观测晚于目标账号的成功负快照时，把该负快照降级为“未知”，使账号保留为故障切换候选；更新的负快照继续视为明确不支持。
- 同时修复 `ListRoutingCandidates`（combined）与 `assembleRoutingCandidates`（layered）路径，并保持两者结果一致。
- 对齐模型页明确支持统计与客户端等级范围模型筛选，避免把未知回退计为已确认支持或提前隐藏可路由模型。
- 增加仓储、模型同步、分层选择器和完整请求回归测试。

## Out of scope

- 不恢复全账号手动模型同步，也不增加模型同步上游请求数。
- 不改变 Provider 请求构造、Build BaseURL、客户端版本或部署配置。
- 不扩展通用 400 响应的跨账号重试策略；本次修复目标是当前 502/5xx 可重试路径中的候选池退化。
- 不改变手工绑定路由、Console 静态目录、Web 能力快照或视频任务结构。

## Implementation steps

1. 在 combined 路径加载账号最近成功能力同步时间，并计算 Super/非 Super 组内目标模型的最新支持观测时间。
2. 在 layered overlay 中携带同一时间字段，并在候选组装阶段应用相同的旧负快照降级规则。
3. 调整模型支持统计，只统计明确观测支持；调整等级范围模型投影，使旧负快照回退与网关语义一致。
4. 增加旧快照、更新负快照、Super/非 Super 隔离、combined/layered 一致性和首账号 502 后同请求故障切换测试。
5. 运行目标测试、后端全量测试与 vet、前端完整 verify；完成独立代码审查并修复发现。
6. 更新 `RESULT.md` 和计划索引；同步最新 main 后重新执行完整验证，再首次推送并创建最终 PR。

## Security and compatibility constraints

- 不记录、提交或上传本地 mock 使用的证书、私钥、JWT、账号材料及未脱敏日志。
- 无数据库迁移：复用已有 `account_model_sync_states.last_success_at`，仅扩展运行时领域投影。
- 不跨 Super/非 Super 共享；保留视频 1.5 等付费 entitlement 隔离。
- 手工绑定路由与 Console 静态目录语义不变。
- 实际账号不支持时，更新负快照与现有模型级冷却/故障切换继续生效，不标记整个账号失效。
- SQL 必须同时兼容 SQLite 与 PostgreSQL；PostgreSQL 集成测试在 `TEST_POSTGRES_DSN` 可用时执行。

## Verification

- Targeted model-sync, repository, selector, model-scope, and end-to-end gateway failover tests.
- `go -C backend test ./...`
- `go -C backend vet ./...`
- `pnpm --dir frontend verify`
- `git diff --check`
- 独立代码审查，重点检查时间先后语义、combined/layered 一致性、等级隔离及 SQL 关联表达式。

## Risks and rollback

- 风险：把更新的明确负快照错误降级为未知会造成重复上游拒绝。通过比较 `last_success_at` 并测试旧/新负快照矩阵规避。
- 风险：combined 与 layered 或模型范围查询语义漂移。通过同库结果全量比较与等级筛选测试规避。
- 风险：相关 SQL 在 PostgreSQL 上的关联别名语义不同。保留双方言测试入口，并在 CI/PostgreSQL 环境复核。
- 回滚：revert 本迭代提交即可；无迁移、无配置变更、无持久化数据转换。

## Delivery and push gate

- This `PLAN.md` is the delivery unit. Keep the branch local until scope, verification, acceptance criteria, and assumptions/defaults are complete.
- Local checkpoint commits are allowed; do not create partial remote branches or intermediate pull requests.
- Before the first push, synchronize with latest main, rerun backend test/vet and frontend verify, complete `RESULT.md`, and update the plan index.

## Assumptions and defaults

- 手动模型同步仍按 `priority DESC, id ASC` 每 Provider 选择第一个启用账号。
- `last_success_at` 表示该账号当前完整能力快照的观测时间，`ReplaceAccountCapabilities` 原子替换能力行与成功状态。
- Build Super 的判定继续使用 `account.IsBuildSuper`：付费 Billing 或管理员确认的 `BuildSuperEntitled`。
- 账号未知/普通 Build 归入非 Super 组，但不会提升到 Super 专属模型。
- 当前 502/5xx 响应沿用现有跨账号重试路径；修复只恢复应存在的第二候选。

## Acceptance criteria

- [x] 首账号支持 grok-4.6、同等级第二账号旧快照缺失时，第二账号保持未知回退候选。
- [x] 首账号返回 502 后，同一请求切换到第二账号并成功返回。
- [x] 更新的明确负快照不被降级为未知。
- [x] Super 观测不提升非 Super 账号，反之亦然。
- [x] combined/layered 查询结果与等级范围模型投影一致。
- [x] 全量验证与独立审查通过。
- [x] 文档和计划索引更新完成。
- [x] `RESULT.md` 完整，分支在最终验收前未推送。
