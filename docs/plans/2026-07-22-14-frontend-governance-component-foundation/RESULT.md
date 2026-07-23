# 第 14 轮迭代结果：前端治理、组件基础与可复现质量门禁

- 完成日期：2026-07-22
- 状态：完成
- 基线：`8ad1997263b846594e639b82269916500b507cff`
- 实现提交：`b0075e1`；最终 Squash 提交：`777a4c7`
- 工作分支：`codex/frontend-governance-component-foundation`
- Pull Request：[#32](https://github.com/JasmineTony/grok2api/pull/32)

## 已交付

- 将管理端 API 会话改为 Provider 作用域的 `ApiClient` 单实例；移除模块级 access token、refresh promise 和监听器运行态，所有管理 API 通过显式客户端注入调用。
- 创作控制台公共 `/v1/*` 请求统一通过 runtime `publicApiBaseUrl` 和 `ApiClient.publicRequest`；请求支持 `AbortSignal`、统一错误解码和脱敏错误语义。
- 将聊天历史、Dashboard 偏好和语言偏好迁入带解析失败、容量异常与不可用存储回退的 `safeStorage`；feature 源码不再直接访问 `localStorage`。
- 增加 `AsyncState`、`FormSection`、`ResponsiveDataView`、表格查询状态、批量选择和 query-key factory，并以组件/hook 回归测试固定行为。
- 启用 `exactOptionalPropertyTypes`、`verbatimModuleSyntax` 和 Node 配置严格模式；修复显式 `undefined`、`RequestInit`、DTO 与展示 props 的严格可选类型问题。
- 建立 Feature 公共入口及 `app → features/entities/shared`、shared/entity/UI 依赖方向约束；新增业务边界、组件设计、API 错误处理和脱敏性能摘要规范。
- 引入 Prettier、EditorConfig、VS Code 设置、ESLint type-aware/React Hooks/JSX a11y/Testing Library/import sort 规则，以及架构、可维护性、重复和未使用代码审计。
- CI 新增 actionlint、Gitleaks、Hadolint、Compose 配置与 `/healthz` smoke、PostgreSQL race、Firefox/WebKit smoke、axe 和脱敏性能汇总 artifact；所有第三方 Actions 继续固定不可变 SHA。
- 修复折叠文档导航中 `aria-hidden` 区域仍可聚焦的问题，并提高亮色主题 muted 文本对比度。

## 验证结果

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| Frozen install | 通过 | `pnpm@11.15.1 install --frozen-lockfile`。 |
| 依赖审计 | 通过 | `pnpm audit --audit-level high` 无已知漏洞。 |
| 前端完整门禁 | 通过 | `pnpm verify`：format、typecheck、lint、34 个 coverage 用例、build、bundle/chunk/icon、Knip、代码/架构/jscpd 全部通过。 |
| 架构审计 | 通过 | 9 个格式化后历史超长页面被冻结，未新增跨层、直接 fetch/storage、可变模块状态或危险执行违规；第 15 轮必须归零。 |
| 重复代码审计 | 通过 | jscpd 10 个克隆、重复行 0.78%，低于 8% 门禁。 |
| Chromium | 通过 | desktop/tablet/mobile 共 33 个 E2E、视觉和 axe 用例通过。 |
| WebKit | 通过 | 关键路由 smoke 通过；对比度修复后 2 个 axe 用例复跑通过。 |
| Firefox | CI 验收 | Windows 本机 Firefox 151 headless 因 `RenderCompositorSWGL failed mapping default framebuffer` 无法启动；已关闭加速并将 CI 固定为 Ubuntu 单 worker，必须以远程 job 为最终验收，不将环境失败误判为应用缺陷。 |
| 后端 | 通过 | `go test -p 1 ./...`、`go vet ./...`、govulncheck 均通过；可达漏洞为 0。 |
| Swagger | 通过 | 使用 swag v1.16.6 重新生成，三个生成文件无漂移。 |
| Workflow lint | 通过 | actionlint v1.7.7。 |
| Secret scan | 通过 | Gitleaks v8.30.1 对最新实现提交扫描，无泄漏；上游历史测试夹具不纳入本轮增量门禁。 |
| Docker/Compose | CI 验收 | 本机未安装 Docker；Hadolint、Compose config、构建及 `/healthz` 已进入必需 CI job。 |
| Markdown/UTF-8 | 通过 | 相对链接、UTF-8 解码与 replacement-character 检查通过。 |

## 假设与默认值验证

| 假设/默认值 | 结果 | 证据 |
| --- | --- | --- |
| 本轮不发布版本 | 通过 | 未创建或推送标签、Release、GHCR 镜像。 |
| 不改变公开接口与后端语义 | 通过 | 无后端业务/API/迁移修改；Go module 路径保持不变。 |
| Provider 作用域替换全局可变认证状态 | 通过 | ApiClient 隔离、并发 refresh 去重、runtime public base URL、401 invalidation 回归测试通过。 |
| 第 14 轮使用冻结基线 | 通过 | Prettier 规范化后基线为 9 个超长 view 和 5 个可维护性项；门禁禁止新增或增长，第 15 轮删除基线并归零。 |
| Firefox/WebKit 分层验收 | 通过 | PR #32 的 Ubuntu Firefox/WebKit smoke 成功；WebKit 本地复核也通过。 |

## 推送门禁证据

- 实现提交 `b0075e1` 在本地完整 `pnpm verify`、后端、Swagger、Chromium、WebKit、actionlint 与 Gitleaks 验收后创建。
- 在本 RESULT 完成前没有推送分支、创建 PR、标签、Release 或 GHCR 镜像。
- 首次远程推送仅包含本轮最终本地提交；远程检查失败时只在本分支修复，不绕过检查。

## 远程验收与合并

- PR #32 最终 HEAD：`ae889554566416e8305fff15323a97bd62fd54c6`。
- CI run `29911713428` 与 CodeQL run `29911713459` 共 15 项检查全部成功，包括 Verify、Visual、CodeQL、amd64/arm64 Docker、Firefox/WebKit、Compose health 与安全审计。
- Gitleaks 对 GitHub 浅克隆 merge ref 的根提交扫描暴露 11 个既有测试/示例误报；修复为当前工作树扫描，并使用路径、规则与精确行内容联合 allowlist，未使用全局忽略。
- 2026-07-22 使用 Squash merge 合并为 `777a4c7`，远程与本地功能分支均已删除。
- 本轮没有创建版本标签、GitHub Release 或 GHCR 镜像。

## 偏差、延期项与回滚

- Prettier 以 100 列规范化历史代码后，超 500 行的页面从原始压缩格式下 4 个显性文件扩展为 9 个真实结构问题。未通过提高 printWidth 掩盖；这些文件在第 14 轮冻结，统一进入第 15 轮容器/展示组件拆分。
- Windows Firefox headless 图形初始化失败属于本机运行环境限制；远程 Linux Firefox smoke 是合并阻断条件。
- 本机无 Docker，因此容器运行态以远程必需 job 验收；Dockerfile/Compose 规则已静态纳入工作流。
- 回滚方式：回退本轮 Squash 提交即可恢复原前端会话和工具链；不需要数据库回滚，也不影响公开 API 或运行时配置。
