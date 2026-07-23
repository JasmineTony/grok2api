# 第 16 轮计划：上游 v3.0.7 同步与依赖更新治理

- 日期：2026-07-23
- 基线：`main@82c5690cc6f61e4e868417d8fc5afe215724bde4`
- 分支：`sync/upstream-v3.0.7-20260723`
- 精确上游：`v3.0.7@11bb5e20e7409ecaa64cf083c1e302fbb6ab30e7`
- 目标独立版本：`v3.1.1`

## 目标

1. 审计全部 Git 跟踪 Markdown，保留有效和历史归档文档，修复失效状态与事实。
2. 冻结常规依赖更新到下一个项目主版本筹备期，保留安全更新例外。
3. 精确合并上游 v3.0.7，并保留上游祖先关系。
4. 叠加上游自动清理、FlareSolverr、协议和媒体修复，同时保留现有可靠性治理与前端组件架构。
5. 完成本地和 GitHub 全量验收后使用 Merge commit 合并。

## 约束

- 不使用 `reset --hard`，不推送中间状态。
- 不合并标签后的 upstream/main，不推送上游标签。
- 不删除历史计划、兼容入口或有审计价值的 Markdown。
- 不把普通依赖升级纳入 v3.1.1；安全更新使用独立计划和 PR。
- 保持 `/v1/*`、既有管理 API、配置、数据库和 Go module 路径兼容。
- 自动清理与 FlareSolverr 默认关闭。

## 工作顺序

1. 更新计划索引、历史结果、项目计划、安全审计和 README。
2. 增加 Markdown 审计脚本、依赖更新规范和 CI 门禁。
3. 合并 `upstream/v3.0.7` 并解决冲突。
4. 补齐专项回归，执行后端、前端、安全、文档和容器配置验收。
5. 启用 Dependabot alerts/security updates，确认无阻断安全告警。
6. 首次推送，创建同步 PR，全绿后使用 Merge commit 合并。
7. 关闭旧的常规 Dependabot PR #26、#27、#28、#33。

## 验收

- `11bb5e20` 是最终 main 的祖先，origin 不存在 `v3.0.7` 标签。
- `VERSION=v3.1.1`，但本轮合并前不发布 Release。
- Markdown UTF-8、链接、计划完整性和状态检查通过。
- Go、Swagger、前端 verify、E2E、CodeQL、race 和双架构 Docker 全绿。
- 常规 Dependabot PR 冻结，安全告警与安全更新启用。
