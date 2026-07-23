# 第 16 轮结果：上游 v3.0.7 同步与依赖更新治理

- 日期：2026-07-23
- 状态：完成
- 同步 PR：#36 `sync: merge upstream v3.0.7 and establish dependency update policy`
- 合并提交：`71b660321ab9f8e77e29194eb832b1fe8d02e0c5`（Merge commit）
- 同步分支：`sync/upstream-v3.0.7-20260723`（远程已删除；本地清理在第 17 轮归档分支合并后完成）
- 精确上游：`v3.0.7@11bb5e20e7409ecaa64cf083c1e302fbb6ab30e7`
- 独立仓库版本：`v3.1.1`

## 已交付

- 精确合并上游 v3.0.7 的变更，解决文本冲突并保留上游祖先关系；未合并标签后的 `upstream/main`，未向 origin 推送上游 `v3.0.7` 标签。
- 同时保留统一错误模型、账号状态机、请求策略、Prometheus 指标、账号级 Egress 和第 15 轮前端组件架构。
- 纳入默认关闭的 reauth 账号自动清理、`reauth_marked_at` 锚点、活动媒体跳过、分布式锁与批次删除保护。
- 纳入默认关闭的 FlareSolverr Clearance、代理池故障隔离、compaction 恢复、prompt-cache、x_search、限流元数据、上传诊断、媒体限制与视频预览修复。
- 58 个跟踪 Markdown 全部有效；没有可安全删除文件，历史计划、安全审计、兼容跳转页和参考文档均保留。
- 常规 Dependabot 版本更新冻结到下一个项目主版本筹备期，安全更新保留独立紧急流程。
- 已启用 Dependency graph、Dependabot alerts 和 Dependabot security updates；核验时开放安全告警为 0。
- 常规 Dependabot PR #26、#27、#28、#33 已关闭且对应远程分支已删除；关闭原因和重新评估条件已记录。

## 本地验证

- `go test -p 1 ./...`：通过。
- `go vet ./...`：通过。
- 前端 TypeScript、ESLint、35 个单元测试：通过。
- 前端生产构建、Lucide、bundle、chunk、architecture、code 和 Prettier 检查：通过。
- 入口约 235.33 kB raw / 74.95 kB gzip，Dashboard 图表约 339.25 kB raw / 91.58 kB gzip，CSS 89.82 kB raw / 15.70 kB gzip。
- Markdown UTF-8、相对链接、迭代结构、索引状态、冲突标记及 `git diff --check`：通过。

## GitHub 门禁

- PR #36 的 Backend、PostgreSQL race、Frontend、Visual、Firefox/WebKit、Workflow/secret audit、Container health、CodeQL、amd64 Docker 和 arm64 Docker 检查全部成功。
- 相关 CI 运行记录：`30005371565`、`30005371703`；同步 PR 使用 Merge commit 合并。
- `git merge-base --is-ancestor 11bb5e20e7409ecaa64cf083c1e302fbb6ab30e7 origin/main`：通过。
- `VERSION` 为 `v3.1.1`，且未推送 origin 的上游 `v3.0.7` 标签。

## 回滚

- 应用回滚应 revert 合并提交 `71b660321ab9f8e77e29194eb832b1fe8d02e0c5`，不要移动版本标签；数据库迁移均为向前兼容的可空字段和索引，回滚应用前应保留数据库备份。
- 常规依赖冻结可通过独立主版本筹备计划重新开启；安全更新不受该冻结策略限制。
