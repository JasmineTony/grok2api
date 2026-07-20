# 上游同步与 SSH 操作

本仓库由 `JasmineTony` 独立维护，同时保留与 `chenyme/grok2api` 的兼容关系、提交历史和 MIT 许可证归属。

## 远程仓库

```text
origin   git@github.com:JasmineTony/grok2api.git
upstream https://github.com/chenyme/grok2api.git
```

## 安全同步流程

1. 从干净且最新的 `origin/main` 开始。
2. 获取 `origin` 和 `upstream`；上游标签只用于比较，不推送到 `origin`。
3. 从 `origin/main` 创建 `sync/upstream-YYYYMMDD`。
4. 将选定的 `upstream/main` 提交合入同步分支，禁止直接强推 `main`。
5. 解决冲突时保留本仓库的安全策略、独立维护声明和仅 GitHub Release 发布 GHCR 的工作流。
6. 执行后端测试与 vet、Swagger 漂移检查、前端冻结安装/lint/build、漏洞扫描和 Docker 验证。
7. 推送同步分支，通过检查成功的 Pull Request 合入。

普通标签推送不会发布容器。发布镜像必须创建符合 `VERSION` 的 GitHub Release，并由受保护的 `release` environment 授权。

## Windows SSH Agent

当前仓库使用带口令的专用 Ed25519 密钥。口令不写入脚本、环境变量、Git 配置或文档；Windows OpenSSH `ssh-agent` 负责在用户安全上下文中提供已解锁密钥。

管理员 PowerShell：

```powershell
Set-Service -Name ssh-agent -StartupType Automatic
Start-Service -Name ssh-agent
Get-Service ssh-agent
```

用户 PowerShell 中只需在首次加入密钥时输入一次口令：

```powershell
ssh-add "$env:USERPROFILE\.ssh\id_ed25519_grok2api_jasminetony"
ssh-add -l
```

为本仓库固定 Windows 系统 OpenSSH 和专用密钥，不影响其它仓库：

```powershell
$key = (Join-Path $env:USERPROFILE '.ssh\id_ed25519_grok2api_jasminetony').Replace('\', '/')
git config --local core.sshCommand "C:/Windows/System32/OpenSSH/ssh.exe -i $key -o IdentitiesOnly=yes -o BatchMode=yes"
```

验证：

```powershell
ssh -T git@github.com
git fetch origin
git ls-remote origin refs/heads/main
```

`ssh -T` 成功时 GitHub 会确认账号，但仍返回“不提供 shell access”的提示，这是预期行为。若 Agent 被清空、密钥更换或用户配置重置，重新执行 `ssh-add`；不要改用明文口令脚本或无口令私钥。
