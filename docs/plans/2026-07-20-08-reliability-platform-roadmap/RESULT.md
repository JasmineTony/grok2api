# 第 08 轮迭代结果：可靠性治理与平台能力演进

- 计划日期：2026-07-20
- 当前状态：本地实施中，尚未推送、尚未创建 PR
- 本地分支：`codex/reliability-platform-roadmap`
- 交付规则：所有路线图、测试验收、假设与默认值核对完成后，才统一推送一次并创建唯一 PR

## 本轮已完成

### 可靠性基础与治理

- 统一账号错误分类与状态机基础已完成，并保留旧 API 字段兼容映射。
- Prometheus 低基数请求、错误、重试、账号状态、Egress、Token 与成本指标已接入。
- 协议黄金文件测试已扩展为 JSON、SSE、工具调用、usage、媒体和常见上游错误场景。
- Recharts、Vite 分块、前端包体预算和 Dashboard 聚合优化已完成，后端测试与前端检查此前均通过。

### Egress、用量与通知

- 账号级 Egress 策略、节点主动健康检查、失败冷却与恢复探测已完成。
- Token 规范化、请求缓存与 Token 缓存命中语义已拆分，小时/日 rollup 已完成。
- SQLite 一致性备份、manifest、校验、停服恢复和 PostgreSQL 外部备份声明已完成。
- 站内通知、去重、冷却、已读、确认、保留期和签名 Webhook 已完成。
- 维护仓库与上游仓库版本检查已分离。

### 本轮新增：类型化请求策略

- 新增领域模型：`backend/internal/domain/requestpolicy`。
- 支持客户端密钥、模型、Provider、操作、来源 CIDR 和媒体条件。
- 支持 allow、deny、limit_tokens、limit_media、force_provider、require_audit 动作。
- 规则按 priority、id 稳定排序；dry-run 只统计命中、不阻断请求。
- 新增持久化表 `request_policies`、命中计数和最后命中时间。
- 新增管理 API：`/api/admin/v1/request-policies` 及 evaluate 端点。
- Responses、Chat Completions、Anthropic Messages、图片和视频入口已接入策略评估；默认无规则时保持允许。
- 固定 Provider 可限制路由候选；策略拒绝使用稳定错误码 `request_policy_denied`，且不记录正文或凭据。

## 本地验证

- `go test -p 1 ./...`：通过
- `go vet ./...`：通过
- 新增请求策略领域、仓储和入口接线测试：通过
- 前端此前的 test、typecheck、lint、build、图标检查和包体检查：通过

## 尚未完成

- 升级前预检、PostgreSQL/Redis 外部备份钩子和全部通知触发点仍需实现。
- 请求快照、协议转换查看器、安全回放仍需实现。
- CLI 子命令、配置即代码和只读 stdio MCP 仍需实现。
- govulncheck、pnpm audit、Swagger 无漂移、race、PostgreSQL 集成、多架构 Docker 和三视口 Playwright 验收仍未完成。
- 假设与默认值尚未逐项核对；当前不允许推送或创建 PR。

## 安全与兼容声明

- 未修改公开 `/v1/*` 协议、Go module 路径、数据库既有字段或发布策略。
- 请求策略默认无规则即允许；高风险能力继续默认关闭或仅 dry-run。
- 不读取、保存或发送 GitHub 密码、SSH 口令或其他秘密。
