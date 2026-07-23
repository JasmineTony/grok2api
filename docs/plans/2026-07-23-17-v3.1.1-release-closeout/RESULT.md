# 第 17 轮结果：v3.1.1 发布与最终归档

- 日期：2026-07-23
- 状态：完成
- 目标版本：`v3.1.1`
- 发布提交：`71b660321ab9f8e77e29194eb832b1fe8d02e0c5`

## 发布结果

- Annotated tag `v3.1.1` 已创建并仅单独推送，标签 peeled commit 精确指向 `71b660321ab9f8e77e29194eb832b1fe8d02e0c5`；未推送上游 `v3.0.7` 标签，也未移动或覆盖 `v3.1.0`。
- GitHub Release 已发布： [Grok2API v3.1.1](https://github.com/JasmineTony/grok2api/releases/tag/v3.1.1)。Release 为非 draft、非 prerelease，发布时间为 2026-07-23 20:17:51（Asia/Shanghai）。
- Release workflow： [30006425853](https://github.com/JasmineTony/grok2api/actions/runs/30006425853)，最终 `completed / success`。
- 受保护 `release` environment 的最终 smoke 部署已审批并成功完成；审批后 Smoke test release image job `89209518906` 成功。

## 镜像与供应链验证

- amd64 发布 job `89203436100`：成功；构建 digest `sha256:f91f8f9c218ba5b7f9d75eb0a677f7d4f8d0d4e334263e6174241689749a2e8f`。
- arm64 发布 job `89203436093`：成功；构建 digest `sha256:c035a0ed51ef0a3ddfe3bea7d8e4a76a544325a0dace04d95a719d6c7a30a09d`。
- 最终多架构 manifest digest：`sha256:6434d1dfd59c1adc90b23d1f67fda517cad0d96ce3547459e2f6314824d8462f`。
- `Publish final tags` job `89205554907` 成功并检查了 GHCR 镜像。标签为：`v3.1.1`、`3.1.1`、`3.1`、`3`、`latest`。
- Buildx 配置 `sbom: true`，amd64/arm64 的 provenance attestation 均成功；本次流水线没有单独的 SBOM job，SBOM 作为镜像构建元数据生成。
- Smoke job 拉取 `ghcr.io/jasminetony/grok2api:v3.1.1`，digest 与最终 manifest 一致，并通过 `/healthz`。

## 最终同步与兼容性

- `HEAD == origin/main == 71b660321ab9f8e77e29194eb832b1fe8d02e0c5`，工作区干净。
- `11bb5e20e7409ecaa64cf083c1e302fbb6ab30e7` 是最终 main 的祖先。
- Dependabot alerts/security updates 已启用，核验时开放安全告警为 0；常规更新 PR 上限冻结为 0，延期到 v4.0.0 筹备期。
- `/v1/*`、现有 `/api/admin/v1/*`、配置既有语义、数据库兼容性和 Go module 路径保持不变。
- 原始 Trace、堆快照、凭据、Cookie、Authorization、请求正文和临时数据库未进入 Git。

## 回滚

- 应用回滚优先使用新的修复提交或 revert，不能删除或移动已发布的 `v3.1.1` 标签。
- 如需回滚镜像，部署方应固定到先前已验证的 digest；Release 与 GHCR 工件保留用于审计。
- 自动清理与 FlareSolverr 均默认关闭；需要停用新能力时优先关闭对应配置并保留数据迁移。
