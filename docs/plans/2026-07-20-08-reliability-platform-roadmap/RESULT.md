# 第 08 轮迭代结果：可靠性治理与平台能力演进

- 计划日期：2026-07-20
- 当前状态：完成；PR #19 已全绿并 Squash 合并为 `785aa7a13813b9e18bd10e4a8615dcd17b265a1f`
- 基线：main@c4a29a183e5065823c2356406f9002b310b62819
- 功能分支：codex/reliability-platform-roadmap
- 远程 main 核验：2026-07-20 仍为 c4a29a183e5065823c2356406f9002b310b62819
- legacy-initial：039c9f092610a4fe8e47b6471850bf5594d020c5

## 已交付能力

### 可靠性与账号治理

- 统一错误分类、账号状态机和显式状态事件。
- 超时、网络、代理、5xx 和未知 403 不会误杀凭据。
- 账号级 Egress 策略、主动健康检查、熔断冷却和恢复探测。
- Token、缓存命中率、实际/估算成本语义和小时/日用量汇总。
- Prometheus 低基数请求、错误、重试、账号状态、Egress、Token 与成本指标。

### 版本、备份和通知

- 维护仓库与上游仓库版本检查分离。
- SQLite 一致性快照、媒体备份、manifest、SHA-256 校验和停服恢复。
- PostgreSQL/Redis 外部备份钩子直接执行，不经过 shell，不记录钩子输出和秘密。
- 升级前检查覆盖数据库、媒体、备份 manifest 和外部备份责任。
- 站内通知、去重、冷却、已读、确认、保留期与 HMAC Webhook。

### 请求策略、快照和协议

- 类型化请求策略支持客户端密钥、模型、Provider、操作、CIDR 和媒体条件。
- 动作包括 allow、deny、limit_tokens、limit_media、force_provider、require_audit。
- 默认无规则时允许；dry-run 只记录命中；Provider 级规则会过滤路由候选。
- 协议黄金文件覆盖 Responses、Chat Completions、Anthropic Messages、JSON/SSE、工具调用、usage、媒体和常见错误。
- 协议转换查看器支持三类协议的离线规范化预览。
- 请求快照默认关闭；开启后执行脱敏、gzip、AES-256-GCM、SHA-256、256 KiB 限制和 TTL。
- 实际回放默认关闭；启用时必须同时满足 allowActualReplay、管理员 confirm、临时客户端 API Key、新 replay request ID 和再次请求策略评估。

### CLI、配置即代码和 MCP

- 保持无子命令启动兼容，并新增 serve、version、doctor、config、backup、egress、mcp 子命令。
- 配置即代码支持模型、Egress、策略和通知定义；Secret 只允许 env:VAR 引用。
- config apply 幂等写入，不删除未声明对象。
- MCP 仅使用本地 stdio，首版只读，绑定模型、账号状态、24 小时用量、最近错误、Egress、版本和配置校验。
- MCP 不返回凭据、Token、Cookie、客户端密钥、代理密码或完整请求正文。

### 前端与性能

- Node.js 24.13.0、pnpm 11.15.1、Vite 8.1.5、TypeScript 6.0.2、Recharts 3.9.2。
- Dashboard 图表异步分块、Lucide 导入检查和包体预算。
- Playwright 覆盖 375x812、768x1024、1440x900 以及亮色/暗色主题。
- 登录页维护仓库链接已修正为 JasmineTony/grok2api。

## 本地测试与验收

已通过：

- go test -p 1 ./...
- go vet ./...
- govulncheck v1.6.0：0 个代码可达漏洞；1 个模块漏洞当前不可达
- Swagger 重新生成且 docs.go、swagger.json、swagger.yaml 无漂移
- pnpm install --frozen-lockfile
- pnpm test
- pnpm typecheck
- pnpm lint
- pnpm build
- pnpm check:icons
- pnpm check:bundle
- pnpm audit --audit-level high：无已知高危漏洞
- Playwright：6/6 通过
- git diff --check
- YAML 解析检查
- 敏感信息模式扫描

前端关键包体：

- 主入口约 116.00 kB raw / 35.39 kB gzip
- Dashboard 图表约 17.04 kB raw / 5.29 kB gzip
- CSS 约 89.93 kB raw / 15.64 kB gzip

本机限制：

- Windows 本机没有 CGO 编译器，race 由 GitHub Ubuntu CI 执行。
- 本机没有 PostgreSQL 服务，PostgreSQL 新库/迁移幂等由 GitHub CI 服务容器执行。
- 本机没有 Docker，amd64/arm64 镜像构建由 GitHub Actions 执行。

## 假设与默认值核对

- TypeScript 7 未进入生产构建：符合。
- Recharts 3 已通过构建、包体和截图回归：符合。
- Go module 路径保持 github.com/chenyme/grok2api/backend：符合。
- 公开 /v1/*、配置既有语义和数据库既有字段未删除或重命名：符合。
- 数据库变更只增加表、索引和兼容字段：符合。
- Prometheus 外部监听默认关闭：符合。
- 请求快照默认关闭：符合。
- 实际回放默认关闭：符合。
- 请求策略默认无规则时允许：符合。
- Webhook 外发仅在显式配置后启用：符合。
- MCP 为本地 stdio、只读：符合。
- 配置 apply 默认不删除未声明资源：符合。
- 未推送版本标签、未触发 GHCR 发布：符合。

## PR 与远程门禁修复记录

- 唯一交付 PR：`#19 feat: complete reliability governance and platform foundation`。
- 首轮 GitHub `Verify` 已通过，包括 Go、race、PostgreSQL、govulncheck、Swagger、前端测试、构建和审计。
- CodeQL 三种分析语言均成功；PR 安全门禁另外发现备份校验路径的 3 条高危路径注入告警。
- 备份读取与恢复已改用 `os.Root` 约束在已打开的备份根目录内，并拒绝数据库快照、媒体清单中的绝对路径、父目录遍历、反斜杠遍历、重复路径和根外符号链接。
- 管理端升级预检只接受 `backup.root` 下的备份名称；兼容查询键 `backupRoot` 也按受限名称解释，不能选择任意主机路径。
- 新增路径遍历与符号链接逃逸回归测试；本地 `go test -p 1 ./...` 和 `go vet ./...` 通过。
- 首轮 Windows runner 截图差异为各视口约 0.3%–0.94% 像素，符合字体栅格化差异特征；视觉门禁改为最多 1% 像素差异，并保留功能断言。
- 视觉失败时自动上传 Playwright 报告、实际图和差异图，保留 7 天，便于后续确认真实布局回退。
- 修复后本地 Playwright 三视口亮暗主题再次 6/6 通过。

## 远程门禁

首次统一推送后必须通过：

- Verify：Go test/vet/race、PostgreSQL、govulncheck、Swagger、前端测试/构建/审计。
- Visual regression：Windows Playwright 三视口亮暗主题。
- Build image：linux/amd64 与 linux/arm64，只构建不发布。
- CodeQL。

任何失败均在同一分支修复，不绕过检查、不强制合并。全部通过后 Squash 合并并删除远程功能分支。
