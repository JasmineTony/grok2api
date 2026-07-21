# 第 10 轮迭代计划：精确同步上游 v3.0.6

- 日期：2026-07-21
- 最终分支：`sync/upstream-v3.0.6-20260721`
- 精确上游提交：`c7b4a51aa0d3e3724654fdaf94c7b89236ecf27d`
- 推送规则：实现、测试、验收和结果记录全部完成后才首次推送

## 目标

- 在 PR #21 与第 09 轮文档合并后的最终 `main` 上，精确合并上游 `v3.0.6`，不包含标签后的上游 `main` 提交。
- 使用保留双亲的 merge commit，使上游 `v3.0.6` 提交成为最终 `main` 的祖先。
- 采用“保留本项目安全治理，并叠加上游协议修复”的冲突处理原则。
- 将源码 `VERSION` 更新为 `v3.0.6`，但不推送上游标签、不创建 GitHub Release、不发布 GHCR。

## 范围与约束

- 保持公开 `/v1/*`、现有配置键、数据库既有字段、Go module 路径兼容。
- 同时保留请求策略、统一错误模型、账号状态机、指标、通知、备份、快照与平台治理能力。
- 纳入上游软会话、prompt cache affinity、reasoning replay、response ownership、媒体审计和流式 failure/usage 修复。
- 如果某项上游变化只能通过破坏兼容性落地，则不在本轮强制采用，记录到结果与后续迁移计划。

## 有序工作

1. 完成 PR #21 与第 09 轮文档 PR，核验本地 `main == origin/main`。
2. 刷新索引并验证无真实工作区差异，不使用 `reset --hard`。
3. 仅获取并核验 `v3.0.5` 与 `v3.0.6` 标签提交，禁止纳入标签后的上游 `main`。
4. 从最终 `main` 创建同步分支，执行 `git merge --no-ff --no-commit refs/remotes/upstream/v3.0.6`。
5. 手工解决 `gateway/service.go`、`inference/handler.go`、`frontend/src/shared/i18n/index.ts` 文本冲突，并行为级复核全部重叠文件。
6. 补充专项回归测试，更新 `VERSION=v3.0.6`，创建保留双亲的本地 merge commit。
7. 完成后端、前端、数据库、Swagger、协议、漏洞、文档与 Git 验收。
8. 更新 `RESULT.md`，统一推送一次并创建 `sync: merge upstream v3.0.6` PR。
9. GitHub 检查全绿后使用 Merge commit 合并，删除同步分支并完成最终验收。

## 冲突处理

- `gateway/service.go`：同时保留 `ForcedProvider` 与 `GrokTurnIndex`；保留本项目治理并叠加上游缓存亲和、软会话、reasoning replay、响应归属及流式诊断。
- `inference/handler.go`：Chat、Messages、Responses/Compact 同时传递固定 Provider 与真实 `x-grok-turn-idx`，并保留策略、稳定错误码、回放门禁及上游 usage/媒体修复。
- `frontend/src/shared/i18n/index.ts`：手工合并中英文键集合，保留平台治理文案并纳入模型、客户端密钥、Grok Build 0.2.106 与 Dialog 新文案。
- 自动合并的重叠文件仍需复核凭据错误、未知 403、配置、无限 RPM/并发、响应归属、媒体审计及迁移幂等语义。

## 测试与验收

- 后端：`go test -p 1 ./...`、`go vet ./...`、govulncheck、数据库迁移、Swagger 无漂移。
- 专项：Grok Build 0.2.106、prompt cache/cached token、soft session、turn index、reasoning replay、多模态、媒体审计、流式 failure/usage、凭据状态转换、无限 RPM/并发与固定 Provider 协同。
- 前端：frozen install、audit、test、typecheck、lint、build、图标、包体预算与 Playwright 三视口亮暗主题。
- GitHub：Verify、Visual、CodeQL、amd64/arm64 Docker 全部成功；不绕过失败检查。
- 最终：`VERSION=v3.0.6`，`c7b4a51` 是最终 `main` 祖先，无上游标签、Release 或 GHCR 发布，工作区干净。

## 假设与默认值

- 精确同步 `v3.0.6` 标签，不跟随上游标签后的 `main`。
- 同步 PR 是 Squash 规则的明确例外，最终必须使用 Merge commit。
- PR #21 的依赖文件与第 09 轮 docs 不覆盖上游 v3.0.6 的冲突文件。
- 高风险行为继续默认关闭，现有 API、配置和数据库兼容语义不变。