# 第 13 轮迭代结果：v3.1.0 发布镜像 smoke test 修复

- 日期：2026-07-22
- 状态：完成
- 分支：`fix/release-smoke-config-path`
- 原始失败运行：`29887732308`

## 根因

v3.1.0 的 Validate、amd64/arm64 构建与推送、provenance、digest manifest 和最终标签均成功。最终 smoke job 启动容器时把配置挂载到 `/app/config.yaml`，但镜像入口通过 `GROK2API_CONFIG_SOURCE=/run/grok2api/config.yaml` 读取配置，因此容器输出：

`missing config: /run/grok2api/config.yaml`

这是工作流测试路径错误，不是已发布镜像的应用构建失败。

## 修改

- 将 `release-image.yml` 的 smoke mount 修正为 `/run/grok2api/config.yaml:ro`。
- 新增只读 `release-smoke.yml` 手动工作流，严格验证输入标签、`VERSION` 和 main 祖先关系，再拉取已发布镜像执行 `/healthz`。
- 手动 smoke 仅授予 `contents: read` 和 `packages: read`。首次 main 调度因 `release` environment 仅允许标签部署而在分配 Runner 前被拒绝；手动只读验证不再绑定发布环境，发布写入流程仍继续受 `release` environment 保护。
- 不移动 `v3.1.0` 标签，不重建 Release，不重新发布应用代码。

## 验证

- `actionlint`：通过。
- Markdown 相对链接、UTF-8 和 `git diff --check`：通过。
- PR [#30](https://github.com/JasmineTony/grok2api/pull/30) 全绿并 Squash 合并为 `d12f33c5f9426b1920a75e6c1700e828d52a7f84`，未来 Release 工作流挂载路径已修复。首次 main 调度 `29890559049` 证明 release environment 的分支限制会拒绝只读 workflow_dispatch；移除该非必要 environment 后，修复分支手动运行 `29890683090` 成功拉取 `v3.1.0` 并通过 `/healthz`。

## PR 与回滚

- Pull Request：[#30](https://github.com/JasmineTony/grok2api/pull/30) 完成未来 Release 路径修复；最终只读 environment 兼容与结果归档由后续文档 PR 完成。
- 回滚：回退工作流修复提交；该回滚不影响已发布镜像和标签。
