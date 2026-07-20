# 第 06 次迭代结果：SSH Agent 与中文主 README 精简

- 完成日期：2026-07-20
- 状态：待 Pull Request 合并
- 基线提交：`ac13042a692455148a58d80bad0f91ef271f98c8`
- 工作分支：`codex/ssh-agent-readme`
- Pull Request：待创建

## 已交付

- Windows `ssh-agent` 已设置为 `Running / Automatic`。
- 专用 Ed25519 密钥已加入 Agent，指纹为 `SHA256:wbPoueActalpVMWvIiDfsmrDuy7MWHqGiZhofzR6gdA`。
- Agent 服务重启后，密钥仍可用于 GitHub 身份验证和 `git fetch`，无需再次输入口令。
- 当前仓库局部 Git SSH 配置已固定为 Windows 系统 OpenSSH、专用密钥和 `BatchMode=yes`。
- 根 `README.md` 已改为简体中文主文档，并保留短英文摘要。
- `README.zh-CN.md` 已改为兼容入口。
- 架构、路由、部署和配置深度说明已迁移到 `docs/reference/`。
- `UPSTREAM.md` 已补充 Windows SSH Agent 安全操作；Issue 模板已更新 README 路径和版本示例。
- 未修改公开 API、配置语义、数据库、Go module 路径、业务代码或发布策略。

## 验证结果

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| ssh-agent 服务 | 通过 | `Running / Automatic` |
| Agent 密钥指纹 | 通过 | 与 JasmineTony 专用密钥一致 |
| GitHub SSH 身份 | 通过 | GitHub 返回 JasmineTony 身份确认 |
| 服务重启后无口令 fetch | 通过 | `git fetch origin main` 成功 |
| Markdown UTF-8 与相对链接 | 通过 | 21 个 Markdown 文件检查通过 |
| README 精简 | 通过 | 主 README 209 行，兼容页 11 行 |
| Issue 模板 YAML | 通过 | Bug 与 Documentation 模板均可解析 |
| 敏感信息扫描 | 通过 | 未发现私钥、Token 或口令 |
| `git diff --check` | 通过 | 仅有 Git 自动换行提示 |

## 安全边界

- SSH 口令没有写入脚本、环境变量、Git 配置、日志或仓库文档。
- 没有使用明文 `SSH_ASKPASS`，没有移除私钥口令。
- 本地临时 SSH helper 仅用于初始化和验证，合并前清理，不进入 Git。

## 待完成

1. 提交并推送本分支。
2. 创建 PR，等待 CI、CodeQL、Markdown 检查和 Docker 检查。
3. 检查全部成功后 squash 合并、删除远程分支并同步本地 `main`。
4. 回填 PR、最终提交和合并后的验证结果。
