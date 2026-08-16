# Iteration result: Upstream parity merge, interface/code audit, and UI polish

- Date completed: 2026-08-16
- Status: Complete
- Base commit: `8a8ea96c` (main after PR #64)
- Final commit: `f91e5395`
- Pull request: branch `sync/upstream-20260816-parity-audit`

## Delivered

### 1. 接口审核与上游对齐（任务 1）

**合并**：`git merge upstream/main`（`86ae6057..369de6fd`，约 30 个上游修复），提交 `b7daa496`。吸收的上游修复包括：

- Grok Build 1.0.4 协议兼容（`e0a82d50`）：web_search 工具域过滤冲突校验、可见推理摘要保留、Chat/Responses/Messages 归一化——补齐了迭代 35 纯常量升级缺失的协议部分。
- 媒体 403 后安全重取 Cloudflare clearance（`ba975f8c`/`2a624ac5`）。
- Console 视频参考图张数/时长入队前校验（`f36e7c10`/`6304c2ae`）。
- 探测 profile / 双探测恢复 / thinking 守卫（`71517cc6`/`2428f17d`，后端 + `probe-profiles-panel.tsx`）。
- 语义流空闲超时在工具进度期间保持（`db2db0c7`）。
- 媒体输入时保留审计 token 用量（`b8cc2ec5`/`6a838cb3`，`audit-usage.ts`）。
- SSO→Build 设备流规避 Cloudflare 严格域（`2ae101f4`/`ecf070ba`）。
- Clash 订阅解析与 Reality 隧道 ALPN（`75212231`）。

**冲突解决中"保留正确的地方"**（14 个文件）：

| 差异点 | 决策 | 理由 |
| --- | --- | --- |
| `visibleTokensPerSecond` 上游映射为 `OutputTokensPerSecond` | 保留本仓库正确映射 | 上游结构缺该字段所做的妥协；本仓库有真实字段（`egress/handler.go` 两处） |
| `QualityProbeResult` 结构 | 双方字段并集 | 我方 `VisibleTokensPerSecond` + 上游 `ThinkingRequired` |
| video.go 路由选择 | 采纳上游"参数校验前置+新选择函数"，保留我方 `ForcedProvider` 过滤 | 上游修复入队前校验；ForcedProvider 是 fork 独立特性 |
| i18n 词典 | 保留模块化 locale 文件，程序化移植缺失 key | 上游为 1960 行内联单块 |
| 前端组件 | 保留 audits/quality-guard 模块化拆分 | 上游为页面内单体 |
| API 调用 | 保留 client 注入架构（`useApiClient`） | 上游用全局 `apiRequest` |
| 测试 | 保留 vitest，`audit-usage.test.ts` 从 node:test 转换 | 上游用 `node --test` |
| tsconfig | 恢复测试文件纳入 app 项目 | 与 eslint project service 配套 |
| config.example.yaml | 我方 requestSnapshots 扩展 + backup 段保留，qualityGuard 去重（字段并集+上游新注释） | 双方独立功能并存 |
| package.json scripts | 保留我方完整 verify 脚本链 | — |

**路由面审计**（脚本对比 `git grep` 路由注册）：本地 159 条 vs 上游 140 条；**上游缺失 0 条**（完全对齐），本地多出的 19 条全部为 fork 有意保留的独立管理 API（notifications、request-policies、request-snapshots/replay、protocol/conversions/preview、accounts/:id/state-events、egress-nodes/:id/health-checks、system/upgrade/preflight 等）。

### 2. 代码审计与优化重构（任务 2）

**仓库内乱码修复**（随合并提交）：`zh-CN.ts` 账号检测对话框 17 个 key（此前页面显示 `????`）、`config.example.yaml` 6 处注释。均自引入即损坏（历史提交同样乱码），按 en 语义重写。

**后端审计发现 11 项（Explore agent），落地 5 项**（提交 2）：

| 发现 | 处置 |
| --- | --- |
| [高] `recordGatewayUsageMetrics` 零调用方 → Prometheus token/cost 指标永远为空 | 已接线至 `createResponseAt` finalize 闭包 |
| [中] `Selector.MarkPaidQuotaExhausted` 死代码 | 已删除 |
| [中] `selectSchedulableMediaRouteWithQuotaMode` 合并后成纯透传 | 已折叠进 `selectSchedulableMediaRoute` |
| [低] `queueAccountModelSync` 裸 goroutine 无 panic 防护 | 已加 recover + Error 日志 |
| [低] `runVideoJob` 账号重绑定写失败被吞 | 已改记 Warn 日志 |

**审计遗留（未落地，供后续迭代）**：视频任务重试路径丢失 client-key 账号范围（需 Job 结构迁移，中风险）；image/voice/voice_ws 三处失败审计闭包重复（重构收益中等）；`GetVideo` 轮询打开完整资产体（需 asset store Stat 接口）；`validate/resolveVideoInputReferences` 双遍历合并。

**i18n 完整性**：程序化对比发现合并组件引用 25 个未移植 key（探针 profile 19 + Imagine 配额 7 + 出口已绑定 1）；zh-CN 与 en 均已补齐并经浏览器验证（quality-guard "探针方案" 标签此前显示原始 key）。最终校验：src 中全部 1099 个 `t()` key 双语 100% 可解析。

### 3. 问题分析与优化建议（任务 3）

归档于本节与 PLAN.md；核心结论：

1. **502 根因链**（延续迭代 35）：客户端版本滞后 + 协议漂移。上游 1.0.4 协议修复（web_search 转换等）合入后，Build 渠道请求构造与官方 1.0.4 对齐；运行设置推荐值已是 1.0.4。
2. **合并债是最大风险源**：fork 与上游同文件双线重构（video.go、audits 页面、quality-guard）时冲突解决需逐块判断"谁对"；本迭代已建立路由面对比 + i18n key 对比两把标尺，建议后续同步继续使用（脚本思路记录于 RESULT）。
3. **上游自身缺陷**：`visibleTokensPerSecond` 映射错误（已规避）；可考虑回馈上游。
4. **建议后续**：视频任务 scope 持久化（审计项 2）；`accountsync.SyncModels` 直调路径补 singleflight；`GetVideo` 加元数据查询接口；首账号模型同步失败时的有界次账号兜底。

### 4. 前端页面优化（任务 4）

以浏览器实测（本地起完整栈 + Playwright）审计了登录/仪表盘/账号/请求审计/质量守护页：

- **修复真实视觉缺陷**：quality-guard profiles 标签原始 key 显示（i18n 移植，见上）。
- **采纳上游视觉改进**（随合并）：请求审计表 memoized 行渲染（大列表滚动性能）、行高 72→96 与响应性能列（总耗时/首字延迟/输出速率三指标网格）、刷新期间 `aria-busy` + 半透明过渡、紧凑时间格式（title 保留完整时间）、UsageDetails 媒体与 token 指标并列显示（替代二选一）。
- **一致性验证**：空状态文案、页头层级（h1 标题 + 描述）、导航结构、中文文案在全部实测页面一致；未发现字号/间距/配色层面的系统性问题（v3.6.x 沉浸式 UI 迭代已建立体系），故未做无依据的大改。

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| `go mod tidy && go build ./...` | Passed | 新依赖 sing/utls 随上游引入 |
| `go vet ./...` | Passed | 无告警 |
| `go test ./...`（全量） | Passed | 合并提交后与审计修复后各跑一轮 |
| `pnpm verify`（format+typecheck+lint+coverage+build+4 audits） | Passed | 与 CI 完全一致 |
| 路由面对比 | upstream-only = 0 | 本地附加 19 条均为有意保留 |
| i18n key 校验（工作区） | 1099/1099 双语可解析 | 自研脚本 |
| 浏览器实测 | 通过 | 登录→仪表盘→账号→审计→质量守护（探针方案标签渲染正常） |
| 乱码扫描（\?{4,} 模式） | 0 命中 | zh-CN.ts / config.example.yaml 修复后 |

## Assumptions and defaults verification

| Assumption/default | Result | Evidence |
| --- | --- | --- |
| 上游 369de6fd 为最新 main | Confirmed | fetch 于 2026-08-16 |
| fork 19 条附加路由均为有意 | Confirmed | 对应通知/策略/快照/预检等独立功能页面 |
| 上游 visibleTokensPerSecond 映射为缺陷 | Confirmed | 其 `QualityTestResult` 无该字段；本仓库字段真实存在且填充 |
| vitest 转换可行 | Confirmed | audit-usage.test.ts 66 项全过 |

## Push gate evidence

- 首次推送在全量验证通过后进行：Yes（backend build/vet/test 与 frontend pnpm verify 均通过后推送）
- Final verification run: backend `go build/vet/test ./...`；frontend `pnpm verify`

## Deviations from plan

- 无。

## CI corrections (first run after push)

首次 CI 运行 4 个失败，全部修复后二次推送：

| 失败 | 修复 |
| --- | --- |
| `prettier --check`：`request-audits-components.tsx` | `prettier --write` |
| `audit:architecture` oversized-view：`request-audits-page.tsx` 554 行 > 500 | `AuditRow`/`ResponsePerformance`/`PerformanceValue`/`splitDuration` 移至 `request-audits-components.tsx`（页面降至 456 行） |
| gitleaks：`media_clearance_retry_test.go` 两处示例 UUID 触发 `generic-api-key` | `.gitleaks.toml` 增加按路径+正则的 allowlist 条目（与既有条目同构） |
| govulncheck：utls v1.6.7 五个漏洞（含 GO-2025-3638） | 升级 `refraction-networking/utls` v1.7.0（连带 circl v1.5.0）；Reality 握手适配——utls 1.7 把 preset 私钥从弃用的 `State13.EcdheKey` 移到 `State13.KeyShareKeys.Ecdhe`，新增 `realityX25519Key` 兼容两处读取（`tunnelproxy` 测试全过） |
| govulncheck 二次运行：utls v1.7.0 仍暴露 GO-2026-4512/4509 与 circl GO-2026-4550/GO-2025-3754 | 再升级 `utls` v1.8.2 + `circl` v1.6.3；本地 `govulncheck ./...` 复核为 0 可达漏洞，后端全量测试通过 |

## Unresolved and follow-up work

- 审计项 2/5/7/11（见"任务 2"遗留清单）。
- 上游 i18n 另有 ~120 个未使用 key（对应上游同功能不同命名的实现），未移植——脚本已可识别"被引用"子集，后续同步时按需补。

## Rollback

revert 合并提交 `b7daa496` 与审计修复提交即可；无数据库迁移、无配置不兼容。

## Final acceptance

- [x] Implementation matches the accepted scope.
- [x] Checks and security review are complete.
- [x] Repository state is clean and documented.
- [x] The plan index is updated.
