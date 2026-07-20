# 第 07 次迭代结果：依赖升级与可靠性平台基础

- 完成日期：2026-07-20
- 状态：完成
- 基线提交：`46ca1f4b8b77d5d5a10a8c0059c49062a3c6e1ad`
- Squash 合并提交：`6b0a4027230ff4837664c24d4310280d8b06dccb`
- 工作分支：`codex/reliability-foundation`（已删除）
- Pull Request：[#16](https://github.com/JasmineTony/grok2api/pull/16)

## 交付内容

### 工具链与依赖

- Node.js/CI/Docker 目标锁定 `24.13.0`，pnpm 锁定 `11.15.1`。
- 升级 Vite 8.1.5、Tailwind 4.3.3、ESLint 10.7.0、typescript-eslint 8.64.0、react-i18next 17.0.10、Lucide 1.25.0、React Hook Form 7.82.0。
- TypeScript 生产编译保留 6.0.2，Recharts 保留 2.15.4，避免在基础 PR 中混入破坏性迁移。
- Go 直接依赖升级为 `golang.org/x/net v0.57.0`、`google.golang.org/protobuf v1.36.11`。

### 前端可靠性、性能与版式

- 增加 Vitest、Testing Library、jsdom、类型检查、测试、包体预算和 Lucide 导入检查。
- 为匿名区、认证区和兜底路由增加错误边界；未知错误不直接展示对象内容。
- Dashboard 图表拆分为独立异步块并提供固定高度 Skeleton。
- GitHub 链接修正为 `JasmineTony/grok2api`；桌面侧栏改为 240/288px 响应式宽度，内容最大宽度提升至 1440px。
- Dialog 增加统一最大高度和内部滚动；表格滚动容器增加横向 overscroll/边缘提示。
- 当前构建：入口 `440.99 kB raw / 136.34 kB gzip`，Dashboard 页面 `37.83 kB`，图表业务块 `71.20 kB`，Recharts 共享块 `351.65 kB / 95.56 kB gzip`，Lucide 共享块 `49.73 kB`，CSS `88.51 kB`。图标与 Dashboard 业务块显著下降；入口与 Recharts raw 预算仍需后续独立优化。

### 统一错误与账号状态基础

- `UpstreamFailure` 增加稳定分类、阶段、可重试性、账号影响和脱敏详情字段。
- 分类覆盖 credential、quota、rate_limit、policy、network、timeout、upstream、protocol、internal。
- 未知 403 保持上游/策略失败，不进入凭据重认证；超时归为可重试 timeout/cooldown。
- 增加 `ready/degraded/cooldown/quota_exhausted/reauth_required/disabled` 状态和显式事件转换函数。
- 数据库增量增加 `provider_accounts.state` 与 `account_state_events`，旧账号通过 Enabled/AuthStatus 兼容映射。

### 协议与指标基础

- 增加离线 JSON/SSE 规范化工具和 OpenAI Responses、Anthropic Messages 示例夹具。
- 规范化 request ID、时间戳和 JSON 对象键；测试不联网。
- 增加无第三方运行依赖的低基数 Prometheus registry、HTTP handler 和独立监听器。
- 新增 `observability.prometheus.enabled/listen`，默认关闭并绑定 `127.0.0.1:9090`；应用仅在显式启用时启动监听。
- 指标设计禁止账号 ID、请求 ID、凭据、Cookie 和完整请求正文作为标签。

## 验证结果

- `pnpm install --frozen-lockfile`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：2 项通过。
- `pnpm lint`：通过，无警告。
- `pnpm build`：通过，Vite 8.1.5 转换 3726 个模块。
- `pnpm check:bundle`：通过当前防回退预算。
- `pnpm check:icons`：通过。
- `pnpm audit --audit-level high`：无已知漏洞。
- `go test -p 1 ./...`：通过。并行 `go test ./...` 在 Windows 上两次触发既有 SOCKS5 回环测试连接被本机终止；目标测试单独连续 3 次通过，记录为环境相关并行抖动。
- `go vet ./...`：通过。
- `govulncheck v1.6.0 ./...`：可达代码 0 个漏洞；依赖模块存在 1 个不可达漏洞。
- SQLite schema/upsert/重复迁移测试：通过。
- `git diff --check`：通过。
- PR #16 GitHub Actions：7/7 检查通过，包括 CodeQL、CI Verify、amd64 与 arm64 Docker 构建。

## 偏差与后续工作

- 本轮只完成路线图第一阶段的可回滚基础，不实现账号级代理、汇总统计、通知、备份、策略、回放、CLI 配置即代码或 MCP；后续必须建立独立迭代目录和 PR。
- `account_state_events` 已建表，但状态转换服务尚未接入所有健康写入路径；接入前旧字段继续作为路由事实来源。
- Prometheus 已具备安全监听和 registry，但请求/账号/Egress/Token/成本的业务埋点需在后续小 PR 逐项接入。
- 协议黄金测试当前验证规范化框架和代表性夹具，尚未覆盖所有真实转换器、图片、视频和畸形响应。
- 入口 raw 包体仍高于路线图 350 kB 目标；Recharts 3 迁移、vendor 分块、Playwright 三视口视觉回归和热点预取留待独立 PR。
- 本地 Node 实际运行时为 24.0.1；CI 和 Docker 已按 `.node-version`/Docker ARG 使用 24.13.0。
