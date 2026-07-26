# 第 19 轮计划：v3.2.0 发布与上游 v3.0.9 交付收口

- 日期：2026-07-26
- 状态：完成
- 基线分支：main@55cb016d67f0d76552c9e640e882761edb931731
- 目标版本：v3.2.0

## 目标

1. 将第 18 轮两个上游 Merge commit 和设置页面拆分通过普通 Merge PR 合入 main。
2. 确认 `VERSION=v3.2.0`，并从最终 main 发布稳定 GitHub Release。
3. 验证双架构 GHCR、provenance、SBOM、稳定别名和 `/healthz` smoke。
4. 归档 PR、CI、Release、镜像 digest、审批和偏差信息，不移动已发布标签。

## 用户批准的环境例外及关闭方式

- 本机无可用 Firefox 浏览器：由 GitHub CI Firefox smoke 完成权威验证，结果通过。
- 本机 pnpm 11.15.1 registry 元数据请求超时：GitHub CI 成功验证 607 个 registry 条目，供应链门禁通过。
- 以上例外没有绕过 Verify、Visual、CodeQL、Firefox/WebKit、PostgreSQL race、容器检查或双架构构建。

## 发布步骤

1. 完成 `VERSION`、README、第 18/19 轮文档和发布说明。
2. 复跑本地非环境阻塞门禁，确认工作区干净且两个上游提交均为 HEAD 祖先。
3. 推送同步分支并创建 PR #39，等待 15 项检查全部成功。
4. 使用 Merge commit 合并 PR #39，删除同步分支并快进本地 main。
5. 通过 ChatGPT 内置浏览器从 main 发布 `v3.2.0` GitHub Release。
6. 分三次审批受保护的 `release` environment：双架构构建、稳定标签、最终 smoke。
7. 验证 amd64/arm64、OCI manifest、provenance、SBOM、稳定别名和 `/healthz` smoke。
8. 更新 RESULT.md 并通过独立文档 PR 归档最终证据。

## 安全与兼容约束

- 不推送上游 v3.0.8-hotfix.1 或 v3.0.9 标签。
- 不移动或覆盖 v3.1.0、v3.1.1 或已经发布的 v3.2.0 标签。
- 不关闭失败检查、不强制合并失败 PR。
- 保持 `/v1/*`、`/api/admin/v1/*`、配置、数据库和 Go module 兼容。
- 不提交凭据、Cookie、Authorization、原始 Trace、堆快照、日志或临时数据库。

## 验收

- [x] 第 18 轮 PR 使用 Merge commit 合并且两个上游提交均为 main 祖先。
- [x] GitHub 所有 15 项必需检查成功。
- [x] v3.2.0 标签与 VERSION 一致并精确指向发布 main。
- [x] Release 和 GHCR `v3.2.0`、`3.2.0`、`3.2`、`3`、`latest` 发布成功。
- [x] 双架构、provenance、SBOM 和 `/healthz` smoke 成功。
- [x] 第 18、19 轮结果归档完成，临时远程分支删除。
