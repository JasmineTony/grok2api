# 第 13 轮计划：v3.1.0 发布镜像 smoke test 修复

- 日期：2026-07-22
- 分支：`fix/release-smoke-config-path`
- 触发原因：v3.1.0 镜像构建、签名和多架构标签发布成功，但 Release 工作流把配置挂载到 `/app/config.yaml`；镜像入口实际要求 `/run/grok2api/config.yaml`，导致最终 `/healthz` smoke test 误报失败。

## 目标

1. 修正未来 Release 工作流的配置挂载路径。
2. 增加只读、可手动触发的已发布镜像 smoke 工作流，用于验证现有 `v3.1.0`，不重写标签、不重新发布镜像。
3. 保持 GHCR 只读权限和严格版本校验；手动 smoke 不使用 release environment，因为该环境只允许版本标签部署，而 workflow_dispatch 必须从包含工作流文件的分支运行。
4. 通过 actionlint、PR 检查和实际 `v3.1.0` `/healthz` 验证后更新结果记录。

## 实施步骤

1. 将 `.github/workflows/release-image.yml` 的挂载目标改为 `/run/grok2api/config.yaml:ro`。
2. 新增 `.github/workflows/release-smoke.yml`：
   - 仅 `workflow_dispatch`；
   - 输入严格 SemVer 标签；
   - checkout 对应标签并验证 `VERSION`；
   - 验证标签提交属于 `main`；
   - 仅使用 `contents: read` 和 `packages: read`，不授予发布权限；
   - 拉取现有 GHCR 镜像并执行 `/healthz`。
3. 本地运行 actionlint、文档检查、敏感信息和差异检查。
4. 推送单一修复 PR，检查全绿后 Squash 合并。
5. 在修复分支和最终 main 上手动运行 smoke workflow，输入 `v3.1.0` 并验证成功。

## 验收标准

- 原始 Release 失败日志中的 `missing config: /run/grok2api/config.yaml` 不再出现。
- 手动 smoke workflow 成功拉取 `ghcr.io/jasminetony/grok2api:v3.1.0` 并通过 `/healthz`。
- 不删除或移动 `v3.1.0` 标签，不重建 Release，不覆盖应用代码。
- 工作流权限维持最小化，配置和凭据不写入仓库。
