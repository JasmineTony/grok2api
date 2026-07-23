# 第 16 轮结果：上游 v3.0.7 同步与依赖更新治理

- 日期：2026-07-23
- 状态：本地实现与验收完成，等待 GitHub 远程门禁和 Merge commit 合并
- 分支：`sync/upstream-v3.0.7-20260723`
- 精确上游：`11bb5e20e7409ecaa64cf083c1e302fbb6ab30e7`

## 已交付

- 精确合并上游 v3.0.7 的 81 个变更文件，解决 24 个文本冲突，并保留上游祖先关系。
- 同时保留统一错误模型、账号状态机、请求策略、指标、账号级 Egress 和第 15 轮前端组件架构。
- 纳入默认关闭的 reauth 账号自动清理、`reauth_marked_at` 锚点、活动媒体跳过、分布式锁与批次删除保护。
- 纳入默认关闭的 FlareSolverr Clearance、代理池故障隔离、compaction 恢复、prompt-cache、x_search、限流元数据、上传诊断、媒体限制与视频预览修复。
- 将独立源码版本设为 `v3.1.1`，未推送上游 v3.0.7 标签。
- 58 个跟踪 Markdown 全部有效；没有可安全删除文件，修正第 08、10、11 轮最终状态。
- 常规 Dependabot 版本更新被冻结到下一个项目主版本筹备期，安全更新保留独立紧急流程。

## 本地验证

- `go test -p 1 ./...`：通过。
- `go vet ./...`：通过。
- 前端 TypeScript、ESLint、35 个单元测试：通过。
- 前端生产构建、Lucide、bundle、chunk、architecture、code 和 Prettier 检查：通过。
- 入口约 235.33 kB raw / 74.95 kB gzip，Dashboard 图表约 339.25 kB raw / 91.58 kB gzip，CSS 89.82 kB raw / 15.70 kB gzip。
- Markdown UTF-8、相对链接、迭代结构、索引状态、冲突标记及 `git diff --check`：通过。

## 远程待验收

- 启用 Dependency graph、Dependabot alerts 和 Dependabot security updates。
- 创建同步 PR，等待 Verify、Visual、CodeQL、PostgreSQL race 和双架构 Docker 全绿。
- 使用 Merge commit 合并，关闭 PR #26、#27、#28、#33，并删除对应远程分支。

## 回滚

- 合并前删除同步分支即可。
- 合并后 revert 最终 Merge commit；数据库迁移均为向前兼容的可空字段和索引，回滚应用前应保留数据库备份。
