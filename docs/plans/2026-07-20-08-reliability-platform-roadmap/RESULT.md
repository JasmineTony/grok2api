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

### 升级前检查与通知补强

- 备份服务新增升级前预检报告，检查数据库连接、媒体目录、备份 manifest 与 SQLite/外部数据库备份责任。
- 新增管理 API：`GET /api/admin/v1/system/upgrade/preflight`。
- 账号重认证、额度耗尽、Egress 节点健康检查失败和策略拒绝已接入去重通知。

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

### 协议转换查看器

- 新增离线协议规范化预览：OpenAI Responses、Chat Completions 与 Anthropic Messages。
- 新增管理 API：`POST /api/admin/v1/protocol/conversions/preview`。
- 预览限制单条 256 KiB，不联网、不回放、不保存请求正文。

### 配置即代码基础

- 新增声明式 YAML 结构校验，支持模型、Egress、策略和通知对象。
- Secret 字段只接受 `env:VAR` 引用；`config plan` 输出非破坏性差异。
- `config apply` 当前明确以 dry-run 返回，不删除未声明对象，待绑定真实仓储和独立运维确认后再开放写入。

### 安全请求快照

- 新增 `request_snapshots` 表和管理 API。
- 快照在保存前递归脱敏、gzip 压缩、AES-256-GCM 加密并记录 SHA-256，单条上限 256 KiB，默认 TTL 24 小时。
- 默认关闭；查看和回放均为 dry-run。实际回放明确拒绝，等待独立安全评审，不访问上游。

### CLI 与只读 MCP 基础

- 保持无子命令启动兼容，并新增 `serve`、`version`、`doctor`、`config validate/export`、`backup create/verify/restore`、`egress check`。
- 新增 `mcp serve` 本地 stdio JSON-RPC 基础，工具目录只读且明确禁止输出凭据、请求正文、客户端密钥和代理秘密。
- MCP 首批工具名称已固定：模型、账号健康、用量、最近错误、Egress、版本和配置验证。
- 配置导出会清空 JWT、凭据加密密钥和管理员密码。

## 新增验证记录

- `go test -p 1 ./...`：通过。
- `go vet ./...`：通过。
- govulncheck v1.6.0：未发现代码可达漏洞；发现 1 个仅存在于依赖模块但当前代码不可达的漏洞，需后续依赖跟踪。
- 前端 `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm check:icons`、`pnpm check:bundle`：通过。
- `pnpm audit --audit-level high`：未发现已知高危漏洞。
- Swagger 生成器因网络/缓存依赖问题尚未完成无漂移检查；Docker、race、PostgreSQL 集成和 Playwright 三视口验收仍未完成。

## 本轮新增进展

- 外部备份钩子已支持：应用直接执行可配置可执行文件，不经过 shell，不把钩子输出写入日志；升级预检和外部数据库备份责任保持显式。
- 配置即代码 `config apply` 已支持模型启用状态、Egress 节点和请求策略的幂等写入；默认不删除未声明对象，Secret 只允许 `env:VAR` 引用。
- MCP 只读工具已绑定模型、账号状态、24 小时用量、最近错误、Egress 健康、版本和配置校验数据，禁止返回凭据和完整正文。
- Playwright 已加入 Windows 视觉回归 CI，覆盖 375x812、768x1024、1440x900 以及亮色/暗色主题；登录页维护仓库链接已切换到 JasmineTony。
- CI 已增加 PostgreSQL 服务、race 检查和多架构构建前的视觉门禁。

## 尚未完成

- 升级前预检、PostgreSQL/Redis 外部备份钩子和主要通知触发点已实现；仍需在 CI 中取得 PostgreSQL、race、Swagger、Docker 的远程检查证据。
- 请求快照、协议转换查看器和显式确认回放路径已实现；实际回放默认关闭，启用前仍需单独安全评审。
- CLI、只读 stdio MCP 和配置即代码的真实非破坏性 apply 已实现；MCP 写操作和实际回放继续保持关闭。
- govulncheck、pnpm audit、Swagger 无漂移、race、PostgreSQL 集成、多架构 Docker 和三视口 Playwright 验收仍未完成。
- 假设与默认值尚未逐项核对；当前不允许推送或创建 PR。

## 安全与兼容声明

- 未修改公开 `/v1/*` 协议、Go module 路径、数据库既有字段或发布策略。
- 请求策略默认无规则即允许；高风险能力继续默认关闭或仅 dry-run。
- 不读取、保存或发送 GitHub 密码、SSH 口令或其他秘密。
