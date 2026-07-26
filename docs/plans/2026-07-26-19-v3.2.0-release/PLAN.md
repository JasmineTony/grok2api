# 第 19 轮计划：v3.2.0 发布与上游 v3.0.9 交付收口

- 日期：2026-07-26
- 状态：执行中
- 基线分支：sync/upstream-v3.0.9-settings-split-20260726
- 目标版本：v3.2.0

## 目标

1. 将第 18 轮两个上游 Merge commit 和设置页面拆分通过普通 Merge PR 合入 main。
2. 更新 VERSION 与当前版本说明为 v3.2.0。
3. 创建仅指向最终 main 的 annotated tag v3.2.0，并发布稳定 GitHub Release。
4. 验证双架构 GHCR、provenance、SBOM、稳定别名和 /healthz smoke。

## 用户批准的环境例外

- 当前机器未安装可用 Firefox 浏览器，本地 Firefox smoke 不作为本次推送阻断项；GitHub CI 的 Firefox job 仍必须成功。
- pnpm 11.15.1 已确认锁文件一致，registry 元数据验证重试 120 秒仍超时。pnpm audit 只报告一个已记录的 React Router RSC-only allowlist 项，当前应用不启用 RSC；该元数据验证允许延期到下一版本继续复核。
- 以上例外不允许绕过 GitHub 的 Verify、Visual、CodeQL、Firefox/WebKit、PostgreSQL race 和容器检查。

## 发布步骤

1. 完成 VERSION、README、第 18/19 轮文档和发布说明。
2. 复跑本地非环境阻塞门禁，确认工作区干净且上游两个提交均为 HEAD 祖先。
3. 首次推送同步分支并创建 PR，使用 Merge commit 合并。
4. 同步 main，确认 VERSION=v3.2.0 且发布切点是 main 祖先。
5. 创建 annotated tag v3.2.0，只推送该标签。
6. 发布 GitHub Release Grok2API v3.2.0。
7. 通过 release environment 审批并验证 amd64/arm64、manifest、provenance、SBOM 和 smoke。
8. 更新 RESULT.md，归档最终证据。

## 安全与兼容约束

- 不推送上游 v3.0.8-hotfix.1 或 v3.0.9 标签。
- 不移动或覆盖 v3.1.0、v3.1.1 标签。
- 不关闭失败检查、不强制合并失败 PR。
- 保持 /v1/*、/api/admin/v1/*、配置、数据库和 Go module 兼容。
- 不提交凭据、Cookie、Authorization、原始 Trace、堆快照、日志或临时数据库。

## 验收

- [ ] 第 18 轮 PR 使用 Merge commit 合并且两个上游提交均为 main 祖先。
- [ ] GitHub 所有必需检查成功。
- [ ] v3.2.0 标签与 VERSION 一致并指向 main。
- [ ] Release 和 GHCR v3.2.0、3.2.0、3.2、3、latest 发布成功。
- [ ] 双架构、provenance、SBOM 和 /healthz smoke 成功。
- [ ] 第 18、19 轮结果归档完成，临时远程分支删除。
