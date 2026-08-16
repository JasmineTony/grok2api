# Iteration plan: Upstream parity merge, interface/code audit, and UI polish

- Date: 2026-08-16
- Sequence: 36
- Owner: JasmineTony
- Status: In progress
- Base commit: `8a8ea96c` (main after PR #64)
- Working branch: `sync/upstream-20260816-parity-audit`

## Objective

1. 审核本项目接口与上游 chenyme/grok2api 的差异，吸收上游正确修复，保留本仓库正确的独立实现。
2. 审计并优化重构代码（合并遗留、乱码、死代码、重复实现）。
3. 归档当前问题分析与优化建议。
4. 依据主流审美对前端页面做保守、可验证的优化。

## Background

- 上游自 `86ae6057`（v3.6.1 同步点）推进到 `369de6fd`，共约 30 个修复：Grok Build 1.0.4 协议兼容（web_search 工具转换/可见推理摘要）、媒体 403 后 clearance 重取、Console 视频参考限制前置校验、探测 profile/双探测恢复/thinking 守卫、语义流空闲超时、媒体输入时保留 token 审计、SSO→Build 设备流、Clash/Reality 订阅解析。
- 本仓库在迭代 35 已把客户端版本升到 1.0.4（仅常量），上游 `e0a82d50` 证明 1.0.4 还伴随协议修复——必须合并补齐。
- 已发现并需修复的仓库内乱码：`zh-CN.ts` 检测对话框 17 个 key、`config.example.yaml` 6 处注释（均自引入即损坏，无法从历史恢复，需按语义重写）。
- 上游把 `visibleTokensPerSecond` 映射到 `OutputTokensPerSecond`（其结构缺该字段）；本仓库有真实字段，保留正确映射。

## Scope

- `git merge upstream/main`（86ae6057→369de6fd），逐个解决 14 个冲突文件，保留 fork 架构（模块化前端组件、client 注入 API、vitest、通知/请求策略/快照等 19 个独立路由）。
- 修复仓库内中文乱码（zh-CN 检测对话框、config.example.yaml 注释）。
- 路由面对比审计：确认合并后 0 个上游路由缺失、19 个本地附加路由全部为有意保留。
- 后端代码审计（并发 agent）产出的问题清单中，落地安全无风险的修复。
- 前端页面视觉审计（浏览器实测）+ 保守优化。
- 计划/结果文档与索引更新。

## Out of scope

- 不重写上游已修复的逻辑；不删除 fork 独立功能。
- 大规模 UI 重设计；仅做一致性/可读性/可访问性优化。
- 数据库迁移或配置文件不兼容变更。

## Implementation steps

1. 合并 upstream/main，解决冲突，保留 fork 特性（已完成，提交 b7daa496）。
2. 修复乱码（zh-CN.ts、config.example.yaml）——随合并提交完成。
3. 路由面对比审计（脚本化，已确认对齐）。
4. 后端审计 agent 发现清单 → 落地低风险修复。
5. 前端浏览器实测 → 视觉优化。
6. 完整验证（后端 go build/test、前端 pnpm verify）→ RESULT.md → 同步 main → 推送 → 最终 PR。

## Security and compatibility constraints

- 不引入凭据/日志入文档；上游新依赖（sing/utls）仅用于订阅解析，来源为上游官方。
- API 契约：上游 140 路由全量保留；fork 19 路由不变。
- 配置结构不变（qualityGuard 新增注释仅为文档）。

## Verification

- `cd backend && go mod tidy && go build ./... && go test ./...`
- `cd frontend && pnpm verify`
- 路由 diff 脚本输出：only upstream = 0。

## Risks and rollback

- 合并风险已通过全量测试缓解；回滚即 revert 合并提交。
- UI 优化若引起回归，revert 对应提交即可。

## Delivery and push gate

- 分支保持本地直到全部验证通过；一次推送、一个最终 PR。

## Acceptance criteria

- [ ] 上游 30 个修复全部合入且 fork 特性无损。
- [ ] 乱码修复完成且扫描为 0。
- [ ] 审计发现落地或归档。
- [ ] 验证套件全绿。
- [ ] RESULT.md 与索引更新。
