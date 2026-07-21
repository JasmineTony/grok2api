# 第 09 轮迭代结果：远程分支维护与历史归档

- 日期：2026-07-21
- 当前状态：实施中；等待供应链最短发布时间门禁到期后重跑 PR #21
- 文档分支：`docs/remote-branch-maintenance`，尚未推送

## 可靠性平台分支

- PR #19 已通过 Verify、Visual、CodeQL 和 amd64/arm64 Docker 检查并 Squash 合并。
- 合并提交：`785aa7a13813b9e18bd10e4a8615dcd17b265a1f`。
- 本地和远程 `codex/reliability-platform-roadmap` 已删除。

## Dependabot 与替代依赖分支

- 原 Dependabot PR #17 在 PR #19 合并后变为 `DIRTY / CONFLICTING`，机器人自动关闭 PR 并删除原远程分支。
- 替代分支 `codex/frontend-minor-patch-refresh` 从最新 main 创建，main 是其直接祖先。
- 当前差异只包含 `frontend/package.json` 和 `frontend/pnpm-lock.yaml`，没有业务代码、API、配置或数据库变更。
- 12 个目标版本与原 PR #17 一致；替代提交为 `14a31c9fd500d6108a9b9bf0fcdb12d9c44b17be`。
- 替代 PR：#21 `chore(deps): refresh frontend minor and patch dependencies`。
- 本地已通过 frozen install、audit、test、typecheck、lint、build、图标、包体和 Playwright 6/6。
- CodeQL 已通过；首次 GitHub CI 仅因 TanStack 5.101.3 两个包尚未达到 pnpm 24 小时 minimumReleaseAge 而失败。
- 两个包分别发布于 2026-07-20 12:04:24 UTC 和 12:04:30 UTC；不提交策略例外，计划在 2026-07-21 12:05 UTC（上海时间 20:05）后重跑。

## legacy-initial 归档

- 创建并单独推送 annotated tag：`archive/legacy-initial-20260719`。
- 远程 peeled commit 已核验为 `039c9f092610a4fe8e47b6471850bf5594d020c5`。
- 本地和远程 `legacy-initial` 分支均已删除。
- 归档标签没有对应 GitHub Release；没有创建 `v*.*.*` 标签。

## 待完成

- 在 minimumReleaseAge 到期后重跑 PR #21 全部检查；成功后 Squash 合并并删除替代分支。
- 将文档分支 rebase 到最终 main，完成分支、标签、Release/GHCR 和工作区验收。
- 统一推送本文档分支，创建文档 PR，等待检查后 Squash 合并。
