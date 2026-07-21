# 第 09 轮迭代计划：远程分支维护与历史归档

- 日期：2026-07-21
- 本地分支：`docs/remote-branch-maintenance`
- 推送规则：全部远程分支操作、测试与验收完成后才统一推送本分支

## 目标

- Squash 合并已全绿的可靠性平台 PR #19，并删除其功能分支。
- 让 Dependabot PR #17 基于新 main 重建，验证 12 项前端补丁依赖后独立合并。
- 将 `legacy-initial@039c9f0` 转为非发布归档标签，再删除本地和远程旧分支。
- 记录远程分支、标签、Release/GHCR 和最终工作区验收证据。

## 实施顺序

1. 核验并 Squash 合并 PR #19，删除功能分支，同步本地 main。
2. 通过 `@dependabot recreate` 重建 PR #17；检查版本、锁文件、本地测试和全部 GitHub 门禁。
3. PR #17 全绿后 Squash 合并并删除 Dependabot 分支；机器人无法重建时使用用户维护的替代分支和 PR。
4. 创建 annotated tag `archive/legacy-initial-20260719`，核验 peeled commit 后删除 `legacy-initial`。
5. 完成 RESULT、本地文档检查，统一推送本分支并通过文档 PR 合并。

## 测试与验收

- 前端：冻结锁文件安装、audit、test、typecheck、lint、build、图标检查、包体检查和 Playwright 6 个场景。
- GitHub：Verify、Visual、CodeQL 和 amd64/arm64 Docker 全部成功，失败不得绕过。
- Git：最终 main 包含 PR #19、依赖补丁和本轮文档；目标远程分支全部删除。
- 归档：`archive/legacy-initial-20260719^{}` 精确指向 `039c9f092610a4fe8e47b6471850bf5594d020c5`。
- 发布：不创建 GitHub Release，不推送 `v*.*.*` 标签，不触发 GHCR。

## 假设与默认值

- PR #19 和依赖 PR 均使用 Squash merge。
- 归档使用 annotated tag，不再保留 legacy-initial 分支。
- Dependabot 更新保持独立 PR，不混入可靠性平台 PR。
- 仓库自动删分支关闭，因此合并后显式删除远程分支。
