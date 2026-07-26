# 第 19 轮结果：v3.2.0 发布与上游 v3.0.9 交付收口

- 日期：2026-07-26
- 状态：同步分支已推送，等待 PR 创建与 CI
- 目标版本：v3.2.0
- 当前发布准备提交：3cf7567c44fbd0a6e945f40b82597a9c113e3065
- 远程分支：sync/upstream-v3.0.9-settings-split-20260726
- PR：待创建
- Release：待发布

## 已完成

- VERSION 已更新为 v3.2.0，README 已更新上游 v3.0.8-hotfix.1/v3.0.9 关系和目标镜像标签。
- pnpm 11.15.1 registry 元数据验证再次运行 120 秒，仍因 registry.npmjs.org 请求超时而停止。
- pnpm audit --json 成功退出：Critical 0、High 1、advisories 为空；High 计数来自已记录的 GHSA-qwww-vcr4-c8h2 RSC-only allowlist，当前项目不启用 React Router RSC。
- 用户明确批准：本机无可用 Firefox 时由 GitHub CI 执行 Firefox smoke；pnpm registry 元数据超时允许延期到下一版本继续验证。
- 同步分支已首次推送到 origin；未推送任何上游标签，未创建 v3.2.0 标签、Release 或 GHCR 镜像。

## 当前阻塞

- 当前终端具备 Git SSH 推送权限，但没有 gh CLI 或 GitHub API Token，无法以 API 创建 PR、执行 Merge 或发布 Release。
- 需要在 GitHub 网页创建同步 PR，或为本终端提供已认证的 gh 会话。

## 后续验收

- [ ] 创建同步 PR并等待 Verify、Visual、CodeQL、Firefox/WebKit、PostgreSQL race、容器和双架构 Docker 检查成功。
- [ ] 使用 Merge commit 合并 PR，并确认两个上游提交是 main 祖先。
- [ ] 创建并推送 annotated tag v3.2.0。
- [ ] 发布 GitHub Release 并验证 GHCR、provenance、SBOM 和 /healthz smoke。
