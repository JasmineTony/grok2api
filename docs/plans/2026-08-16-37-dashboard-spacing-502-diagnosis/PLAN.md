# Iteration plan: Dashboard chart spacing fix and 502-vs-upstream diagnosis

- Date: 2026-08-16
- Sequence: 37
- Owner: JasmineTony
- Status: Complete
- Base commit: `fde5b41e` (main after PR #65)
- Working branch: `fix/dashboard-chart-spacing-20260816`

## Objective

1. 修复仪表盘"模型计费 Top 10"与相邻面板之间无垂直间距的问题。
2. 诊断"本 fork 部署请求 502、上游项目同请求 200"的根因并给出处置结论。

## Background

- 用户报告两个现象：仪表盘模型计费 Top 10 上下无间距挤在一起；fork 部署审计页 502 而上游项目 200。
- 代码层面已核对：`git diff upstream/main -- backend/internal/infra/provider/cli/` **零差异**（Build 请求转发/协议/请求头完全一致）；上游 1.0.4 提交（`e0a82d50`）也仅改版本常量，UA 格式与本 fork 迭代 35 的升级完全一致；Build 默认 BaseURL/回退两边相同。

## Scope

- `dashboard-charts.tsx`：加载后布局与骨架屏（`space-y-2`）对齐，修复面板相挤。
- 归档 502 诊断结论（部署侧版本/设置滞后，代码无回归）。

## Out of scope

- 网关代码改动（已确认与上游字节级一致，无回归可修）。

## Verification

- `pnpm typecheck`、`pnpm test`、`prettier --check` 通过。
- 浏览器实测：TopModels 面板上下间距各 8px，与骨架屏及页面紧凑区一致。

## 502 diagnosis summary

fork 与上游在 Build 协议栈（cli 包）、版本常量（1.0.4）、UA、默认 BaseURL 上完全一致，502 只可能来自部署侧状态：

1. **部署版本滞后**（最可能）：fork 部署若仍是 ≤v3.6.1（clientVersion 0.2.119），xAI 已弃用旧客户端版本——刷新/请求被拒 → 凭据不可用 → 502；上游项目部署为 1.0.4 默认值 → 200。处置：升级到本 main（PR #65 已含 1.0.4 常量 + 上游 1.0.4 协议修复 + utls 安全修复）。
2. **运行设置/配置显式固定旧版本**：升级后若运行设置或 config.yaml 显式保存过 `provider.build.clientVersion`，不会自动跟随推荐值。处置：运行设置（构建）应用推荐 1.0.4，或删除配置文件中该字段以回退默认。
3. **验证方法**：请求审计页过滤 502 查看 error_code——`upstream_credential_unavailable` 指向版本/凭据，`upstream_network_error` 指向出口/网络；管理端"关于"核对部署版本。

## Acceptance criteria

- [x] 间距修复并浏览器实测通过。
- [x] 验证套件通过。
- [x] 诊断结论归档。
