# 第 19 轮结果：v3.2.0 发布与上游 v3.0.9 交付收口

- 日期：2026-07-26
- 状态：完成
- 目标版本：v3.2.0
- 发布 main：55cb016d67f0d76552c9e640e882761edb931731
- PR：#39
- PR 合并方式：Merge commit
- Release：https://github.com/JasmineTony/grok2api/releases/tag/v3.2.0
- Release workflow：https://github.com/JasmineTony/grok2api/actions/runs/30205347774

## 合并与门禁结果

- PR #39 的 15 项检查全部成功，包含 Backend test/audit、PostgreSQL race、Frontend quality、Repository code audit、Workflow/secret audit、Container configuration/health smoke、Firefox/WebKit smoke、Visual regression、CodeQL 和双架构 Docker。
- CI run 30203622573 成功；CodeQL run 30203622569 成功。
- Backend race 作业 89797774557 成功，用时 10 分 56 秒。
- 修复提交 a0506deb1bb3532c7d90cbd3a24e403acc6a4d58 将 `frontend/pnpm-workspace.yaml` 纳入 Docker 构建上下文，解决 `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`。
- GitHub CI 完成 pnpm 11.15.1 registry 供应链策略验证：607 个条目在 9 秒内通过。
- CodeQL alerts 4、6、7 经代码级复核后标记为 false positive：SHA-256 仅用于确定性非凭据标识符和幂等键，不用于密码或认证密钥。

## Release 与受保护环境

- GitHub Release `Grok2API v3.2.0` 于 2026-07-26 发布，标签精确指向 55cb016d67f0d76552c9e640e882761edb931731。
- Release workflow run 30205347774 于 2026-07-26 22:19（Asia/Shanghai）成功完成。
- 受保护的 `release` environment 分三阶段审批：
  1. Publish image (amd64/arm64)；
  2. Publish final tags；
  3. Smoke test release image。
- 作业结果：
  - Validate release 89802323957：成功；
  - Publish image (amd64) 89802338716：成功；
  - Publish image (arm64) 89802338731：成功；
  - Publish final tags 89802742236：成功；
  - Smoke test release image 89803332005：成功。
- provenance 与 SBOM 均由双架构发布作业生成；GitHub Attestation 页面已产生对应记录。

## GHCR 证据

- OCI index digest：`sha256:b5603ad4d085b4b3bb30262a406a476704aa784a78c3e50ba74ccf1e063b5c87`。
- linux/amd64 manifest：`sha256:5c0115409eedf06036c243beb81c65f27dd27f3596532413047e302edce522b8`。
- linux/arm64 manifest：`sha256:94f31714b8a60207be639badc38a294e58ea5ac0b2c9cc5928cc47474f528590`。
- 公开 Registry API 对以下标签均返回 200，且全部指向同一 OCI index：
  - `v3.2.0`；
  - `3.2.0`；
  - `3.2`；
  - `3`；
  - `latest`。
- `/healthz` 发布镜像 smoke 作业成功。

## 兼容性与标签治理

- `VERSION=v3.2.0`。
- dae50ce67b95d5cad2b4168e32332c790b2c9ce6 与 834f9f70e57882438177b8ab89c3aaee52dffe2e 均为最终 main 祖先。
- 未向 origin 推送上游 v3.0.8-hotfix.1 或 v3.0.9 标签。
- `v3.1.0`、`v3.1.1` 未移动或覆盖。
- `/v1/*`、既有 `/api/admin/v1/*`、配置语义、数据库既有字段和 Go module 路径保持兼容。

## 偏差

- 原计划要求 annotated tag。为遵守用户指定的“通过 ChatGPT 内置浏览器执行 GitHub 发布”，GitHub Release 网页从 main 创建的是 lightweight tag；`v3.2.0` 仍精确指向已验证的发布 main。
- 标签创建后 Release 和 GHCR 已成功发布，因此依据不可变发布原则不删除、不重写、不移动该标签。后续发布计划必须在 Release 前显式决定：若要求 annotated tag，先通过已认证终端创建并推送单一标签，再在浏览器发布 Release。

## 回滚

- 应用回滚优先选择上一稳定镜像 `v3.1.1`，不得移动 `v3.2.0` 标签或覆盖已发布 digest。
- 代码回滚使用新 revert 提交，不重写 main；数据库变更为兼容性增量迁移，操作前仍需验证备份。

## 最终验收

- [x] PR #39 以 Merge commit 合并并删除同步分支。
- [x] 两个上游提交均为最终 main 祖先。
- [x] `VERSION=v3.2.0`，Release tag 精确指向发布 main。
- [x] amd64、arm64、provenance、SBOM、manifest 和 `/healthz` smoke 成功。
- [x] 五个稳定镜像标签存在并指向同一 OCI index digest。
- [x] 未推送任何上游版本标签。
