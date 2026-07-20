# 第 06 次迭代计划：SSH Agent 与中文主 README 精简

- 日期：2026-07-20
- 负责人：JasmineTony
- 状态：实施中
- 基线提交：`ac13042a692455148a58d80bad0f91ef271f98c8`
- 工作分支：`codex/ssh-agent-readme`

## 目标

在不保存 SSH 私钥口令、不移除私钥口令的前提下，通过 Windows OpenSSH `ssh-agent` 实现后续 Git 推拉免重复输入；同时将仓库首页改为精简的简体中文主文档，并保留短英文摘要和旧中文 README 的兼容入口。

## 实施内容

1. 将 Windows `ssh-agent` 设置为自动启动并加载专用 Ed25519 密钥。
2. 为当前仓库局部固定 Windows 系统 OpenSSH、专用密钥和非交互模式。
3. 重写根 `README.md`，删除推广、重复免责声明和过度展开的实现细节。
4. 将架构、路由、部署和配置的深度内容迁移到 `docs/reference/`。
5. 将 `README.zh-CN.md` 改为兼容跳转页。
6. 同步更新 `.gitignore`、Issue 模板、`UPSTREAM.md` 及关联文档引用。
7. 通过独立 PR 验证并 squash 合并。

## 安全与兼容约束

- 不在脚本、环境变量、日志、Git 配置或文档中保存 SSH 口令。
- 不使用明文 `SSH_ASKPASS`，不移除私钥口令。
- 不修改全局 Git 身份或其他仓库的 SSH 配置。
- 不修改公开 API、配置语义、数据库、Go module 路径、业务代码或发布策略。
- 普通分支和 `main` 推送不得发布 GHCR 镜像。

## 验证

- Windows `ssh-agent` 为 `Running / Automatic`。
- 服务重启后，专用密钥指纹仍可见，并可无口令执行 GitHub SSH 身份验证和 `git fetch`。
- 所有 Markdown 使用 UTF-8，相对链接均有效。
- README 和 Issue 模板中的锚点、文件名和工作流说明一致。
- `git diff --check` 与敏感信息扫描通过。
- GitHub CI、CodeQL 及 Docker 验证全部成功。

## 验收标准

- [ ] SSH 推拉不再重复提示密钥口令。
- [ ] `README.md` 为简体中文主文档并包含短英文摘要。
- [ ] 深度说明已迁移且无断链。
- [ ] `README.zh-CN.md` 保留兼容入口。
- [ ] 所有关联文档引用已同步。
- [ ] PR 检查全部通过并完成 squash 合并。
