# 第 10 轮迭代结果：精确同步上游 v3.0.6

- 日期：2026-07-21
- 状态：本地交付与验收完成；本分支只在 GitHub 全部检查成功后以 Merge commit 合并
- 最终基线：`origin/main@63e1c52bfe8410da0ab437406da659ba92fc6185`
- 精确上游提交：`c7b4a51aa0d3e3724654fdaf94c7b89236ecf27d`

## 交付结果

- 仅合并 `upstream/v3.0.6`，未纳入标签后的 `upstream/main`，也不推送上游标签。
- 正式同步提交保留双亲关系：第一父提交为当前项目基线，第二父提交为上游 `v3.0.6`。
- `gateway.Input` 同时保留 `ForcedProvider` 与 `GrokTurnIndex`；Chat、Messages、Responses/Compact 同时传递请求策略固定 Provider 与真实 turn index。
- 纳入上游 soft session、prompt cache affinity、reasoning replay、response ownership、缓存 usage、流式 failure/usage 与媒体审计。
- 保留统一错误模型、账号状态机、请求策略、Prometheus、通知、备份、请求快照与平台治理数据表。
- `credential_decrypt_failed` 保持可恢复；`invalid_grant` 等真实 OAuth 永久失败继续阻断；未知 403 不触发 reauth；`permission-denied` 使用稳定客户端与审计码。
- 客户端密钥 RPM/并发显式为 `0` 时表示无限；SQLite/PostgreSQL 迁移保持幂等。
- PR #21 的 `frontend/package.json` 与 `frontend/pnpm-lock.yaml` 依赖升级结果保持不变。
- `VERSION` 更新为 `v3.0.6`；未创建版本标签、GitHub Release 或 GHCR 发布。

## 兼容修复与冲突处理

- 解决 `gateway/service.go`、`inference/handler.go` 与中英文 i18n 三处文本冲突，保留本项目治理能力并叠加上游协议修复。
- 黄金文件比较兼容 Windows CRLF 检出，不修改黄金内容。
- 增加固定 Provider 与真实 turn index 同时生效的网关回归覆盖。
- 保留上游 Dialog 信息架构并复用既有 Tailwind 工具类，使生产 CSS 维持在 90,000 bytes 预算内。
- 对 66 个上游同步路径与预合并语义结果逐文件校验；除本轮结果文档外最终源码树一致。

## 本地验证

- `go test -p 1 ./...`：通过。
- `go vet ./...`：通过。
- `govulncheck`：0 个可达漏洞；依赖模块中的 1 个漏洞不可达。
- Swagger 重新生成：跟踪文件对象哈希无漂移。
- 前端 frozen install 与 `pnpm audit --audit-level high`：通过，无已知高危漏洞。
- Vitest 2/2、typecheck、lint、build、icon、bundle：通过。
- Playwright：3 个视口 × 亮/暗主题，共 6/6 通过。
- 生产构建转换 3712 个模块；CSS 为 89.65 kB raw；全部现有 JavaScript 与图表包体预算通过。
- 生产 chunk DAG 检查：68 个 JavaScript chunks，无循环。
- `git diff --check`、UTF-8、Markdown 相对链接、敏感信息和冲突标记检查通过。
- Windows 本机缺少 GCC，race 与 amd64/arm64 Docker 由 GitHub CI 验收。

## GitHub、发布与回滚

- 正式 PR 必须等待 Verify、Visual、CodeQL、amd64 Docker 与 arm64 Docker 全部成功，并使用 Merge commit 合并。
- 不创建或推送 `v*.*.*` 标签；不创建 GitHub Release；普通 PR/main 不发布 GHCR。
- 如需回滚，应 revert 最终 Merge commit，不重写 `main` 历史；归档标签不受影响。
