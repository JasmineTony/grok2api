# 第 14 轮计划：前端治理、组件基础与可复现质量门禁

- 日期：2026-07-22
- 序号：14
- 负责人：JasmineTony
- 状态：本地完成，待远程 PR 验收
- 基线：`8ad1997263b846594e639b82269916500b507cff`
- 工作分支：`codex/frontend-governance-component-foundation`

## 目标

完成第 12/13 轮遗留的归档、类型、Lint、可访问性、CI 审计和测试门禁；建立不含全局可变业务状态的 API/认证基础，以及容器、展示组件、UI 基础组件三层规范。所有变更保持公开 API、运行时配置、数据库和发布策略兼容。

## 范围

- 修正第 13 轮结果、计划索引和文档编码/链接。
- 建立业务边界、组件设计系统、API 交互规范和可复现性能摘要规范。
- 用 Provider 作用域的认证/API 会话替换模块级可变认证状态；统一 runtime apiBaseUrl、AbortSignal、解码、错误和安全存储。
- 添加 FormSection、ResponsiveDataView、AsyncState、表格查询/选择 hook、query-key factory。
- 配置 Prettier、EditorConfig、VS Code、现代 ESLint flat config、架构/重复代码审计。
- 建立 actionlint、秘密扫描、Dockerfile/Compose 检查、Compose health smoke、PostgreSQL race、axe 与跨浏览器分层测试门禁。

## 非范围

- 不重构超过 500 行的账户、创作控制台和客户端密钥页面；该工作属于第 15 轮。
- 不合并 Dependabot PR，不发布版本、不创建标签/Release/GHCR 镜像。
- 不修改后端公开接口、数据库迁移、Go module 路径或 Release 工作流触发条件。

## 约束

- 禁止模块级可变业务状态、直接 fetch/localStorage、eval/Function/子进程执行和未处理错误。
- 允许模块级不可变类型、路由元数据和设计令牌；环境与业务配置必须来自 runtime config、服务端能力或集中 typed config。
- 第 14 轮采用架构违规冻结基线：不能新增或扩大违规；第 15 轮移除基线并达到零违规。
- 所有新增 feature 必须采用 page/container/presentation/shared-ui 分层；共享 UI 不得依赖业务 API。
- 分支在范围、测试、RESULT 和验收完成前不得推送。

## 实施步骤

1. 创建和修正计划归档；编写业务边界、设计系统和 API 交互规范。
2. 重构认证/API 会话为 Provider 作用域，迁移创作公共 API 与安全存储。
3. 添加共享状态/展示组件、表格 hooks 和 typed query helpers。
4. 升级 ESLint/Prettier、类型约束、重复代码和架构审计，并建立临时基线。
5. 补强单测/E2E/a11y 测试基础以及脱敏性能汇总。
6. 增加 CI workflow/security/container/Compose 门禁及 Postgres race 覆盖。
7. 完成完整本地验证、RESULT、最终同步后才首次推送和创建 PR。

## 验证

- 前端：frozen install、format check、typecheck、lint、coverage、unused/code/architecture/duplicate audit、bundle/chunk/icon、Chromium/Firefox/WebKit、axe。
- 后端：go test、vet、race、govulncheck、Swagger 无漂移。
- 安全/运维：actionlint、gitleaks、Dockerfile/Compose 审计、Compose health smoke、Markdown/UTF-8/敏感信息/冲突标记。
- 兼容性：现有 `/v1/*`、`/api/admin/v1/*` 请求、runtime apiBaseUrl 和认证恢复测试保持通过。

## 风险与回滚

- API/认证会话改造可能影响登录恢复；以覆盖 refresh、401、网络失败和多实例隔离的回归测试控制，必要时回退单一迭代提交。
- 新规则可能暴露历史问题；冻结基线仅限第 14 轮，所有豁免必须有注释和到期第 15 轮删除条件。
- 安全扫描可能误报 smoke fixture；仅允许精确路径/规则 allowlist，不允许全局忽略。

## 推送门禁

- 此 PLAN.md 是唯一交付单元；只允许本地 checkpoint commit。
- RESULT、全部本地检查和假设验证完成后，才可首次推送一次并创建最终 PR。

## 假设与默认值

- 不发布版本；兼容性重构仅通过 PR 合并。
- Chromium 执行全量三视口亮暗回归；Firefox/WebKit 执行关键路由/a11y smoke。
- 使用 ESLint flat config 生态而非 Airbnb 预设；所有第三方 action 固定不可变 SHA。

## 验收标准

- [ ] 第 13 轮结果和索引完整、UTF-8 正常且链接有效。
- [ ] API/认证无模块级可变业务状态，feature 无直接 fetch/localStorage。
- [ ] 组件/API/业务边界规范与共享基础组件落地。
- [ ] ESLint/Prettier、架构/重复/安全审计和测试规范可本地及 CI 复现。
- [ ] actionlint、secret、Docker/Compose 和健康检查进入 Verify 门禁。
- [ ] 本地完整测试、兼容性和安全检查通过。
- [ ] RESULT.md 完整，首次推送发生在最终本地验收之后。
