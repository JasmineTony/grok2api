# grok2api 产品需求文档（PRD）

## 0. 文档信息与定位

| 项 | 值 |
| --- | --- |
| 文档类型 | 派生文档（derived documentation），由当前代码库反向梳理 + 需求演进规划构成 |
| 目标读者 | 产品/业务负责人、维护线负责人、验收人 |
| 覆盖范围 | 产品定位、用户场景、范围与非目标、功能需求 FR-A…FR-L、非功能需求、度量指标、优先级与路线图；不含实现细节与门禁规则（分别见 TD 与 AGENTS.md） |
| 文档状态 | 派生文档（非规则 SSOT）；规则以 `AGENTS.md` 为准，实测值以两个 `AUDIT.md` 为准 |
| 基线提交 | `45838afe`（`main`，2026-10-12）；历史基线 `c6206d50` 因远端仓库重建/历史重写已不可解析，引用其行号时需按当前文件重新定位 |
| 版本载体 | 唯一权威版本源是仓库根 `VERSION`（规则见 `AGENTS.md` §8）；`frontend/package.json.version` 须与之同线。本文不复制版本号，一致性以 `pnpm check:version` 当次输出为准 |
| 生成日期 | 2026-10-12 |
| 权威边界 | 本文件**不是**规则 SSOT。规则 SSOT 是 `AGENTS.md`；历史证据与逐轮实测 SSOT 是 `frontend/AUDIT.md`、`backend/AUDIT.md`。本文与它们冲突时，以那三者为权威。 |
| 事实口径 | 文中 `文件:行` 引用相对基线提交（基线已前移，需按当前文件重新定位）；复现命令见 `docs/TD.md` §17.5 与 `AGENTS.md` §7 |

阅读顺序建议：PRD（本文，回答「做什么、给谁、判什么」）→ `docs/TD.md`（回答「怎么实现、边界在哪」）→ `docs/implementation-plan.md`（回答「下一步按什么顺序落地」）。

**入口说明**：本文是派生文档，不是规则 SSOT；规则见 `AGENTS.md`（章节 `§0`–`§14`，规则编号 `META-n`/`DEV-n`/`TEST-n`/`REV-n`/`REL-n`/`EXEC-n`/`EVID-n`/`CHG-n`/`DOC-n`/`SEC-n`/`BIND-n`），当前状态见 `frontend/AUDIT.md` 与 `backend/AUDIT.md`。三份文档的阅读顺序：`docs/PRD.md` → `docs/TD.md` → `docs/implementation-plan.md`。

---

## 1. 产品概述

### 1.1 一句话定义

grok2api 是一个自托管的 **API 网关 + 管理控制台**：把多个 Grok 上游账号池（Grok Build / Grok Web / Grok Console）聚合为统一鉴权、统一计费、统一审计、统一路由的 **OpenAI 兼容 + Anthropic 兼容** 接口（`README.md:68`、`README.md:140`）。

### 1.2 背景与要解决的问题

上游 Grok 能力分散在三种互不兼容的接入面（OAuth 设备码、SSO、无状态 DPoP 协议），且以「账号」而非「租户」为配额单位。直接对接会带来以下问题：

| 问题 | 具体表现 | 本产品的应对 |
| --- | --- | --- |
| 协议碎片化 | 同一模型在不同上游的请求/响应结构、流式分帧、工具调用格式均不同 | 网关侧协议归一 + 双向编解码，对外只暴露 OpenAI / Anthropic 契约 |
| 凭据与配额易失效 | 令牌过期、额度窗口重置、账号被限流或封禁 | 凭据自动续期、额度窗口与恢复调度、冷却只延长不缩短、账号健康与降级 |
| 无法对外计量 | 多账号共用时无法区分调用方用量与成本 | 客户端密钥 + 预留/结算计费 + 请求级审计 |
| 出口 IP 风险 | 上游对出口网络有风控，单 IP 高并发易触发挑战 | 出口节点池、代理档位、订阅同步、探活与 Cloudflare clearance、出口质量守护 |
| 无法自证合规 | 谁在何时用了哪个账号、走了哪个出口、失败原因是什么 | 审计账本（含尝试链、路由、用量、计费）与账本就绪强制门禁 |

### 1.3 产品形态与上游关系

- **形态**：单个 Go 二进制，内嵌构建后的 React 静态资源；Docker 镜像多架构（amd64/arm64）交付（`Dockerfile`、`.github/workflows/ghcr-image.yml`）。
- **上游关系**：本仓库是 `chenyme/grok2api`（MIT License，Copyright (c) 2026 Chenyme）的**衍生维护线**（`AGENTS.md` §1）。上游对外行为契约优先，其载体为 `backend/api-baseline.txt`、`make swagger` 的精确 diff、E2E 用例。
- **非商用声明**：README 声明仅供技术研究与学习，使用者自担合规责任（`README.md:27`）。

---

## 2. 用户与场景

### 2.1 角色

| 角色 | 关注点 | 主要入口 |
| --- | --- | --- |
| **运营者（管理员）** | 账号可用性、额度、成本、异常定位、出口稳定性 | 管理控制台（`/api/admin/v1`，单管理员模型） |
| **接入开发者** | 用 OpenAI / Anthropic / Codex / Claude Code 客户端直接调通 | `/v1/*` 网关面 + 内置 API 文档页（`/docs/*`） |
| **自建站内用户** | 在站内直接创作（对话/图像/视频/语音），无需自备密钥 | 创作台 `/creative-console` |
| **维护者** | 上游契约不回退、门禁可复现、发布可审计 | `AGENTS.md`、两个 `AUDIT.md`、`make` / `pnpm verify` / `backend/scripts/verify.sh` |

### 2.2 核心场景（用户故事）

1. **作为运营者**，我要批量导入三类账号并一眼看到额度与健康，以便在某个池子枯竭前补号（`/accounts`）。
2. **作为运营者**，我要让过期凭据自动续期、到期的额度窗口自动恢复并重排，以便无需人工值守。
3. **作为运营者**，我要把不同模型路由到不同账号池并支持粘性会话，以便同一会话不因换号而丢上下文。
4. **作为接入开发者**，我要把 `base_url` 指向本服务并复用现有 SDK，以便零改造成本接入（`/v1/chat/completions`、`/v1/responses`、`/v1/messages`）。
5. **作为接入开发者**，我要在 Codex / Claude Code 里直接配置本服务，并让提示缓存与推理上下文尽量命中，以便降本提速。
6. **作为运营者**，我要为每个调用方签发密钥、限定可用模型与账号范围、设置速率与并发，以便做租户隔离。
7. **作为运营者**，我要在请求失败时看到完整的尝试链（换了哪些账号、为什么换、走了哪个出口），以便定位是账号问题还是出口问题。
8. **作为运营者**，我要把出口流量分散到多节点并自动剔除劣化节点，以便降低挑战率。
9. **作为运营者**，我要在仪表盘看到调用量趋势、模型 Top、Provider 分布与资源占用，以便判断容量。
10. **作为自建站内用户**，我要在站内直接生成图像/视频/语音，以便不依赖外部客户端。
11. **作为运营者**，我要在设置页热更新运行参数（无需重启）并防止并发覆盖，以便多人在同一实例上安全协作。
12. **作为维护者**，我要在任何改动后一条命令验证全部门禁，以便「改动落地即验」。

---

## 3. 范围

### 3.1 在范围内

- 三类上游账号池的全生命周期管理（导入、导出、转换、同步、刷新、探测、清理、设备码登录）。
- 对外推理 API：OpenAI Responses / Chat Completions、Anthropic Messages、Images、Videos（异步任务）、TTS / STT / Realtime、Codex 与 Claude Code 兼容行为。
- 模型路由目录、别名、按账号能力与额度封锁。
- 客户端密钥、模型/账号范围、速率与并发限制、用量与计费。
- 会话能力：stored responses、上下文压缩、prompt cache 亲和、reasoning replay。
- 出口治理：节点、代理档位、订阅源、探活、Cloudflare clearance、出口质量守护（内置启发式熔断 + 可选 sidecar）。
- 审计与用量、仪表盘、系统信息与版本更新检查、运行时设置热更新。
- 交付面：多架构镜像、Compose 部署、本地与 CI 质量门禁。

### 3.2 非目标（明确不做 / 当前不做）

| 编号 | 非目标 | 依据 |
| --- | --- | --- |
| NG-1 | 不支持 Hysteria / TUIC 隧道协议 | `README.md:390` |
| NG-2 | Grok Build 池不提供图片生成/编辑路由 | `README.md:275` |
| NG-3 | 默认不开启 Swagger 文档端点 | `config.example.yaml` `server.swaggerEnabled: false` |
| NG-4 | 默认不自动删除旧账号 | `README.md:252` |
| NG-5 | 不提供多管理员与角色权限分级（当前为单管理员模型，无角色字段） | `backend/internal/domain/admin`；前端全仓无角色判断 |
| NG-6 | 不做模型质量判定器（出口质量守护只做出口速度/错误启发式熔断） | `tools/egress-quality-guard/README.md:3-11` |
| NG-7 | 不承诺上游能力的长期稳定性（上游协议非公开，随上游变化调整） | `README.md` Provider 边界章节 |
| NG-8 | 不提供 Kubernetes Operator / Helm 等编排资产 | 仓库无相关目录 |

### 3.3 约束与假设

- **C-1 上游契约优先**：不得为内部重构改变对外协议；契约变更必须同步 `backend/api-baseline.txt`、`make swagger` 产物与 E2E 用例。
- **C-2 单二进制交付**：前端必须构建为静态资源由后端托管，不引入独立前端服务。
- **C-3 密钥不可轮换**：`secrets.credentialEncryptionKey` 一旦写入账号即不可轮换（`config.example.yaml:31-36`）。
- **C-4 运行态默认单实例**：默认 `runtimeStore.driver: memory`、`deployment.replicas: 1`；多副本需显式配置 Redis 与共享媒体目录。
- **C-5 合规责任在使用者**：项目不提供上游合规授权，使用者自行承担。
- **假设 A-1**：上游 Grok 接口以非公开协议提供，服务端具备随上游变更快速适配的能力（Provider 适配层）。
- **假设 A-2**：使用者可提供合法的上游账号与出口网络。

---

## 4. 功能需求（FR）

状态定义：**已实现** = 代码与测试均在位；**部分实现** = 主链路在位但有明确缺口（见 §7 路线图）；**未实现** = 当前无对应实现。

### FR-A 接入与协议兼容

| 编号 | 需求 | 验收标准 | 状态 |
| --- | --- | --- | --- |
| FR-A1 | 提供 OpenAI 兼容 Chat Completions | `POST /v1/chat/completions` 支持 JSON 与 SSE；支持图片输入与函数工具（`backend/internal/transport/http/inference/chat_handler.go`） | 已实现 |
| FR-A2 | 提供 OpenAI 兼容 Responses | `POST /v1/responses` 支持 JSON 与 SSE；`POST /v1/responses/compact` 压缩上下文；`GET/DELETE /v1/responses/{id}` 查询与删除（`responses_handler.go`、`responses_compat.go`） | 已实现 |
| FR-A3 | 提供 Anthropic 兼容 Messages | `POST /v1/messages` 使用 Anthropic 请求/响应形状与 `anthropic-version` 头（`backend/internal/transport/http/inference/handler.go`） | 已实现 |
| FR-A4 | 提供模型目录 | `GET /v1/models` 返回当前可用模型；Codex 客户端可获得其专用模型目录（`codex_models.go`） | 已实现 |
| FR-A5 | 兼容 Codex 与 Claude Code 客户端 | 从 `X-Claude-Code-Session-Id`、Codex 头及 `prompt_cache_key`/`session_id`/`conversation_id` 派生会话身份；Claude Code 的 title 辅助请求强制降级为软身份以避免推理上下文泄漏（`inference/prompt_cache.go`） | 已实现 |
| FR-A6 | 保持对外协议不回归 | `go run ./tools/apicheck` 与 `make swagger` 精确 diff 均退出 0；E2E 固定公开协议 | 已实现（机制在位） |
| FR-A7 | 请求错误契约稳定 | 网关面返回 OpenAI 风格错误；`/v1/messages` 返回 Anthropic 风格错误；管理面返回 `{error:{code,message,requestId}}` | 已实现 |

### FR-B 账号池管理

| 编号 | 需求 | 验收标准 | 状态 |
| --- | --- | --- | --- |
| FR-B1 | 三类账号池独立管理 | 列表/详情/启停/批量更新/删除按 `grok_build`、`grok_web`、`grok_console` 分池；前端以 Tab 呈现 | 已实现 |
| FR-B2 | 凭据导入与导出 | 支持认证文件导入、Web/Console 专用导入、批量导出与选中导出；非法文件导入失败且服务端账号数不变（E2E `accounts.e2e.ts`） | 已实现 |
| FR-B3 | 设备码（OAuth）登录 | `POST /accounts/device/start` + `POST /accounts/device/{sessionId}/poll` 完成 Build 账号设备码授权 | 已实现 |
| FR-B4 | 凭据自动续期 | 后台按调度刷新令牌；单账号手动刷新可用；失败标记需重新认证（`application/account/credential_scheduler.go`） | 已实现 |
| FR-B5 | 额度同步与展示 | 支持批量/单账号刷新额度与计费；Web 池支持分模式额度刷新；账号详情展示额度窗口与恢复时间 | 已实现 |
| FR-B6 | 跨池转换与同步 | Web→Build 凭据转换、Web→Console 账号同步，支持 `all` / `missing` 策略（`handler.go` `convert-to-build`、`sync-to-console`） | 已实现 |
| FR-B7 | Web 账号设置与脚本 | 接受条款、设置生日、开启 NSFW、执行 Web 账号脚本；批量任务以 SSE 推送进度 | 已实现 |
| FR-B8 | 账号清理 | 提供清理预览与执行（默认不自动删除旧账号）；支持批量删除预览 | 已实现 |
| FR-B9 | 账号探测与标记 | 支持 Build 账号可用性探测与结果分类（ok / invalid / failed） | 已实现 |
| FR-B10 | 账号与出口绑定 | 可将账号分配/解绑到出口节点，支持重平衡 | 已实现 |
| FR-B11 | 单账号冷却可清除 | `POST /accounts/{id}/clear-cooldown`；冷却写入只延长不缩短 | 已实现 |

### FR-C 模型路由

| 编号 | 需求 | 验收标准 | 状态 |
| --- | --- | --- | --- |
| FR-C1 | 模型路由 CRUD 与批量操作 | 管理面可新增/编辑/删除/批量启停模型路由（`transport/http/model/handler.go`） | 已实现 |
| FR-C2 | 从上游同步模型目录 | 支持同步并回传进度；支持分组视图与可选账号列表 | 已实现 |
| FR-C3 | 模型别名与推理级别重写 | 别名映射到规范内部 ID；别名可重写 reasoning effort（`domain/model/reasoning.go`） | 已实现 |
| FR-C4 | 模型级能力与封锁 | 账号-模型能力矩阵、模型级额度封锁与过期清理（`account_model_quota_blocks`） | 已实现 |
| FR-C5 | 按密钥限定模型与账号范围 | 客户端密钥可限定可用模型、Provider 与等级范围 | 已实现 |
| FR-C6 | 被拒模型返回明确错误 | 未授权模型请求返回 403 `model_not_allowed` 并写入审计 | 已实现 |

### FR-D 客户端密钥、限额与计费

| 编号 | 需求 | 验收标准 | 状态 |
| --- | --- | --- | --- |
| FR-D1 | 密钥生命周期 | 创建（一次性返回明文）、编辑、启用/停用、批量更新/删除；明文仅在创建时与显式 `GET /client-keys/{id}/secret` 可见 | 已实现 |
| FR-D2 | 密钥鉴权 | `Authorization: Bearer g2a_<prefix>_<secret>` 或 `X-API-Key`；按前缀查库 + SHA-256 常量时间比较 | 已实现 |
| FR-D3 | 速率限制 | 按密钥 RPM 限流，超限返回 429 | 已实现 |
| FR-D4 | 并发限制 | 实例级推理总闸（超限 503 `server_overloaded` + `Retry-After`）与账号级并发租约 | 已实现 |
| FR-D5 | 用量与计费计量 | 请求前预留、审计提交时同事务结算并饱和；未结算预留周期回收 | 已实现 |
| FR-D6 | 余额不足拒绝 | 预留阶段余额不足直接拒绝，不消耗上游额度 | 已实现 |
| FR-D7 | 内部托管密钥隔离 | `InternalKind != ""` 的托管密钥拒绝外部调用 | 已实现 |

### FR-E 会话与缓存

| 编号 | 需求 | 验收标准 | 状态 |
| --- | --- | --- | --- |
| FR-E1 | 上游会话归属 | `previous_response_id` 归属校验，跨账号不串会话（`response_ownership`，TTL 30 天） | 已实现 |
| FR-E2 | 上下文压缩 | `POST /v1/responses/compact`；区分 compaction 与 TUI 分类 | 已实现 |
| FR-E3 | 提示缓存亲和 | 同一会话优先复用同一账号；亲和键按模型隔离 | 已实现 |
| FR-E4 | 推理上下文重放 | 可选开关（`routing.reasoningReplayEnabled`，默认开启）；仅由显式会话信号派生 key，软锚点不驱动 | 已实现 |
| FR-E5 | 无状态 Provider 降级 | Console 不支持 stored responses 时，`previous_response_id` 置空走无状态重放 | 已实现 |
| FR-E6 | 粘性会话 | 绑定未过期时保持账号；绑定原子保留 | 已实现 |

### FR-F 媒体能力

| 编号 | 需求 | 验收标准 | 状态 |
| --- | --- | --- | --- |
| FR-F1 | 图像生成与编辑 | `POST /v1/images/generations`、`/v1/images/edits`，支持尺寸/比例/分辨率/`n`/流式部分图 | 已实现 |
| FR-F2 | 视频异步任务 | `POST /v1/videos/{generations,edits,extensions}` 返回任务 ID；`GET /v1/videos/{requestId}` 查询；`GET /v1/videos/{requestId}/content` 取内容 | 已实现 |
| FR-F3 | 语音合成与识别 | `/v1/tts`、`/v1/tts/voices`、`/v1/stt`（含 WebSocket）、OpenAI 风格 `/v1/audio/speech`、`/v1/audio/tasks`、`/v1/audio/transcriptions`、`/v1/realtime` | 已实现 |
| FR-F4 | 媒体归档与访问 | 媒体落本地库；`GET /v1/media/{images,videos}/{assetId}` 公开访问；管理面列表/统计/删除 | 已实现 |
| FR-F5 | 媒体输入导入 | 支持 URL 导入与文件上传（上传票据 + `PUT /v1/media/uploads/{token}`，体积上限 256 MiB） | 已实现 |
| FR-F6 | 站内创作台 | `/creative-console` 提供对话/图像/视频/语音四模式 | 已实现 |

### FR-G 出口与代理治理

| 编号 | 需求 | 验收标准 | 状态 |
| --- | --- | --- | --- |
| FR-G1 | 出口节点管理 | 节点 CRUD、批量更新/删除、单节点与批量探测、质量探测、清理与预览 | 已实现 |
| FR-G2 | 代理档位管理 | 代理档位 CRUD 与代理 URL 显式揭示（受管理员鉴权保护） | 已实现 |
| FR-G3 | 出口源订阅同步 | 出口源 CRUD、手动同步、文本批量导入 | 已实现 |
| FR-G4 | Cloudflare clearance | 支持 manual / flaresolverr / on_demand 三种策略；节点可手动刷新 clearance | 已实现 |
| FR-G5 | 出口运营自动化 | 运营配置读写与重平衡触发；自动分配受最大节点占比与迁移占比约束 | 已实现 |
| FR-G6 | 出口质量守护 | 节点健康探测、探测档位、策略配置、事件列表、被降级账号查看与处置、统计图表；sidecar 通过受限内部 API 与共享卷交互，从不读取管理员密码 | 已实现 |
| FR-G7 | 出口租约与隔离 | 出口租约封锁表；账号连接隔离开关（`routing.accountIsolatedConnections`） | 已实现 |
| FR-G8 | 隧道协议支持 | HTTP / SOCKS / Resin 代理 + Trojan / VLESS / Shadowsocks / VMess 隧道 | 已实现 |

### FR-H 审计与用量

| 编号 | 需求 | 验收标准 | 状态 |
| --- | --- | --- | --- |
| FR-H1 | 请求级审计明细 | 记录状态、路由、耗时、用量、计费、重试尝试链与元数据；列表/详情/汇总均可查 | 已实现 |
| FR-H2 | 审计筛选与汇总 | 支持多维筛选与汇总指标；E2E 断言筛选改变真实查询范围与激活计数 | 已实现 |
| FR-H3 | 事件唯一性 | 每次请求生成唯一 `eventID` 作为审计唯一键（partial unique 索引） | 已实现 |
| FR-H4 | 账本健康强制 | `ledgerMode: enforce` 下账本不可用时阻塞请求；observe 模式只告警 | 已实现 |
| FR-H5 | 审计保留策略 | 按 `audit.retentionDays` 周期清理 | 已实现 |
| FR-H6 | 降级账号视图 | 质量守护降级账号列表与处置入口 | 已实现 |

### FR-I 运维面板与系统

| 编号 | 需求 | 验收标准 | 状态 |
| --- | --- | --- | --- |
| FR-I1 | 仪表盘 | 调用量、趋势、模型 Top、Provider 分布、资源占用、活动热力图（`GET /api/admin/v1/dashboard`） | 已实现 |
| FR-I2 | 系统信息 | `GET /system` 返回公开 API 基址等运行信息；`GET /system/version` 返回版本 | 已实现 |
| FR-I3 | 版本更新检查 | `POST /system/update/check`；前端展示当前版本与更新横幅 | 已实现 |
| FR-I4 | 健康与就绪 | `GET /healthz` 存活；`GET /readyz` 分层就绪（runtime_store / billing_ledger / grok_build / grok_web / statsig），未就绪 503 | 已实现 |
| FR-I5 | 放流量门 | 启动 reconcile 完成前 `/v1` 返回 503 `service_reconciling` | 已实现 |

### FR-J 设置与配置

| 编号 | 需求 | 验收标准 | 状态 |
| --- | --- | --- | --- |
| FR-J1 | 运行时设置热更新 | `GET/PUT /api/admin/v1/settings`；保存后无需重启生效 | 已实现 |
| FR-J2 | 乐观并发保护 | 版本冲突返回 409，前端保留草稿（E2E `settings.e2e.ts`） | 已实现 |
| FR-J3 | 分页设置项 | 设置页按域分页（Grok Build / Grok Web / Console / 投递 / 策略 / 审计 / 账号 / 关于） | 已实现 |
| FR-J4 | 配置来源 | `config.yaml`（可 `--config` 指定）+ 环境变量覆盖（`GROK2API_DATABASE_URL` 等）；启动即校验配置 | 已实现 |

### FR-K 安全与认证

| 编号 | 需求 | 验收标准 | 状态 |
| --- | --- | --- | --- |
| FR-K1 | 管理员登录与会话 | 登录/刷新/登出/改密；access 为 HS256 JWT，refresh 为落库 opaque token | 已实现 |
 | FR-K2 | 会话 Cookie 安全 | `SameSite=Strict`、`HttpOnly`、`Secure` 取「配置为真或连接为 TLS」；Cookie 回退需同源校验 | 已实现 |
| FR-K3 | 凭据静态加密 | 账号凭据、代理 URL、运行时设置使用 AES-256-GCM 加密存储 | 已实现 |
| FR-K4 | SSRF 防护 | 媒体 URL 与 Web 附件抓取经内网地址守卫，拒绝私有/环回/保留网段 | 已实现 |
| FR-K5 | 内部通道最小权限 | 质量守护令牌为 HMAC 派生、域分隔；sidecar 不接触管理员密码 | 已实现 |
| FR-K6 | 安全响应头 | 设置 `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy` / `Permissions-Policy` | 已实现 |
| FR-K7 | 请求体大小限制 | 全局上限可配（默认 32 MiB），上传端点放宽到 256 MiB | 已实现 |
| FR-K8 | 登录限流 | 管理员登录复用速率限制器 | 已实现 |

### FR-L 交付、文档与质量

| 编号 | 需求 | 验收标准 | 状态 |
| --- | --- | --- | --- |
| FR-L1 | 一键部署 | Docker Compose 起服务（含可选质量守护 profile）；镜像多架构 | 已实现 |
| FR-L2 | 内置 API 文档 | `/docs/:category/:endpoint` 覆盖 16 个端点（Chat 3 / Image 2 / Video 4 / Voice 7），含 curl/python/javascript 示例与真实 Base URL | 已实现 |
| FR-L3 | 前端可用性基线 | 中英双语、明暗主题、移动端适配与键盘可达（E2E `navigation.e2e.ts`） | 已实现 |
| FR-L4 | 本地质量门禁 | `pnpm verify`、`pnpm verify:full`、`backend/scripts/verify.sh` 均退出 0（步骤清单 SSOT：`AGENTS.md` 的 BIND-4 / DEV-4 / TEST-6） | 已实现 |
| FR-L5 | CI 验收门禁 | CI 在远端真实跑完前后端测试、race、PG/Redis 集成、Swagger diff、全栈 E2E、必需用例断言、镜像 manifest 断言 | 机制在位；**当前无远端 run 证据**（见 §7 R-4） |
| FR-L6 | 版本载体一致 | 仓库根 `VERSION` 与 `frontend/package.json.version` 同线，本地 `pnpm check:version` 与 CI step 双向强制 | 已实现 |
| FR-L7 | 文档站 | 站内 `/docs` 页 + 仓库 README（英/中） | 已实现 |

---

## 5. 非功能需求（NFR）

| 编号 | 维度 | 要求 | 验证方式 |
| --- | --- | --- | --- |
| NFR-1 | 性能（流式） | 流式响应首字节后保持转发；流空闲按 Provider 阈值判定并中断，不无限挂起 | `infra/provider/streamidle`、`pkg/neterror` 分类测试 |
| NFR-2 | 性能（体积） | 五项体积预算（登录首屏关键 JS / 业务路由增量 / 全部 JS / 全部 CSS / 单 chunk）全部达标（阈值唯一来源：`frontend/bundle-budget.json`，规则见 `AGENTS.md` 的 REV-5；明细见 `docs/TD.md` §14.1） | `pnpm check:budget`（`frontend/bundle-budget.json`） |
| NFR-3 | 可靠性（故障转移） | 单次请求在账号/出口失败时有界重试，尝试次数与决策显式可控，不无限重试 | `application/gateway` 尝试循环测试 |
| NFR-4 | 可靠性（额度） | 额度窗口到期自动恢复并重排；冷只延长不缩短；封锁有过期清理 | `application/quotarecovery`、`account_quota_windows` 测试 |
| NFR-5 | 可靠性（审计） | 账本不可用时按配置阻塞放流量；事件唯一性由数据库约束保证 | `application/audit` 账本测试、`idx_audits_event_id` |
| NFR-6 | 一致性（计费） | 预留与结算原子；崩溃遗留预留有界回收；金额计算饱和不溢出 | 同事务结算测试、`CleanupExpiredBilling` |
| NFR-7 | 安全（传输） | 支持反向代理部署并正确解析客户端 IP（`trustedProxies` 显式配置，禁止通配） | 配置校验 + `middleware.ClientIP` |
| NFR-8 | 安全（数据） | 敏感凭据不得明文落库；日志与 trace 不得包含真实秘密 | 代码审查 + E2E 隔离断言 |
| NFR-9 | 可观测性 | 存活/就绪端点分层；结构化 JSON 日志含 requestID；审计含 eventID 可关联 | `GET /readyz`、`infra/observability` |
| NFR-10 | 可维护性（结构） | 单文件 / 单函数 / 控制流嵌套三项结构上限达标（阈值唯一来源：两侧 `structure-baseline.json`，规则见 `AGENTS.md` 的 REV-1/REV-2/REV-3） | `pnpm check:structure`、`go run ./tools/structurecheck` |
| NFR-11 | 可维护性（分层） | 前端依赖方向可被机器校验（app→features→entities→shared，无跨 feature 直接依赖）；后端 Transport→Application→Domain | `pnpm check:architecture`、`AGENTS.md` §DEV-3 评审 |
| NFR-12 | 可维护性（测试） | 业务 UI 逐文件覆盖率与自定义 hook 覆盖率达标（阈值唯一来源：`frontend/vitest.config.ts`，规则见 `AGENTS.md` 的 TEST-1/TEST-2） | `pnpm test:ui:coverage`（`vitest.config.ts`） |
| NFR-13 | 可维护性（类型） | 新增导出必须有显式返回类型；禁止新增 `any` / `@ts-ignore` | `pnpm typecheck`、`pnpm lint` |
| NFR-14 | 兼容性 | 上游对外行为契约不回退 | `apicheck`、Swagger 精确 diff、E2E |
| NFR-15 | 部署 | 单镜像支持 amd64 与 arm64；非 root 运行；镜像内含版本载体 | `dockerfilecheck`、CI `merge` job 断言 |
| NFR-16 | 多副本 | 支持 `replicas > 1`（需 Redis + 共享媒体目录 + 集群标记校验） | `internal/app/topology.go` 预检；**缺口见 §7 R-6** |
| NFR-17 | 可测试性 | 全栈 E2E 与真实后端进程隔离（每 worker 独立端口/临时库/合成凭据，未知外呼快速失败） | `frontend/e2e/*`、`pnpm test:e2e` |

---

## 6. 度量指标

| 类别 | 指标 | 目标 | 当前可测性 |
| --- | --- | --- | --- |
| 交付 | `pnpm verify` 全绿（步骤清单 SSOT：`AGENTS.md` 的 BIND-4 / DEV-4） | 每次改动 | 可测（本地） |
| 交付 | `backend/scripts/verify.sh` 全绿（步骤清单 SSOT：`AGENTS.md` 的 BIND-4 / TEST-6） | 每次改动 | 可测（本地） |
| 交付 | 远端 CI `verify` job 全绿且必需用例零跳过 | 每个发布 | **当前无远端 run 证据** |
| 交付 | 发布镜像同时含 linux/amd64 与 linux/arm64 | 每个发布 | 机制在位（CI `merge` job 断言） |
| 质量 | 结构门禁越限数 | 0（棘轮只降不升） | 可测 |
| 质量 | 契约基线差异 | 0 | 可测 |
| 质量 | 业务 UI 逐文件覆盖率 | 达标（阈值唯一来源 `frontend/vitest.config.ts`，规则见 `AGENTS.md` 的 TEST-1/TEST-2） | 可测 |
| 质量 | 首屏关键 JS | 达标（阈值唯一来源 `frontend/bundle-budget.json`，规则见 `AGENTS.md` 的 REV-5） | 可测；**认证后首屏超阈值但未纳入门禁**（体积以 `pnpm check:budget` 与 `frontend/AUDIT.md` 的 FE-19-5 / §37.2 当次输出为准；见 §7 R-5） |
| 运维 | 账号池可用率（非冷却/非降级账号占比） | 由运营目标设定 | 仪表盘 + 审计可观测 |
| 运维 | 请求成功率与首字节延迟分位 | 由运营目标设定 | 审计可观测；**无后端指标导出端点**（见 §7 R-7） |
| 运维 | 账本就绪率 | 100%（enforce 模式下阻塞放流量） | `/readyz` 可观测 |

---

## 7. 需求优先级与路线图

优先级口径沿用 `AGENTS.md` §6：P0 立即阻塞；P1 阶段验收阻塞；P2 已登记且不扩张的存量债务；P3 建议项。

**当前状态（基线快照：`main` @ `45838afe`，2026-10-12；当前 tip 以 `git rev-parse HEAD` 为准）**：P0 = 0；交付阻塞类 4 项；P2 = 5 项；P3 = 6 项（**计数口径：本节表格中该优先级的条目数，P3 即 R-10…R-15**；`docs/implementation-plan.md` §1.3 已按同一口径对齐，其 EVID-8 留痕见该文 §10）。

| 编号 | 需求 | 优先级 | 现状与缺口 | 验收标准 |
| --- | --- | --- | --- | --- |
| R-1 | 发布路径可获得真实远端证据 | P1（阻塞发布） | 交付分支从未推送，CI 的两条维护线新增断言 step 从未执行 | 远端 `ghcr-image.yml` 的 `verify` job 真实跑完，两个「Assert required … ran」step 为 success，并登记 run id |
| R-2 | 版本载体与发布版本一致 | P1（阻塞发布） | 当前版本载体以仓库根 `VERSION` 为准（唯一权威源，规则见 `AGENTS.md` §8；本文不复制版本号）；历史授权中的版本号与「仅重发某版本」口径见 `backend/AUDIT.md` D.5，需在发布时一次性明确 | `pnpm check:version` 通过且 tag 名与 `VERSION` 一致 |
| R-3 | 远端仓库与推送凭据就绪 | P1（阻塞发布） | `origin`（fetch HTTPS / push SSH）与 `upstream`（只读参考，**禁止推送**）均已配置，`main` 跟踪 `origin/main`（事实 SSOT 是 `AGENTS.md` 的 BIND-1）；远端重建与重发的实测登记见 `backend/AUDIT.md` D.1/D.2，授权口径见 D.5；剩余缺口是推送凭据可用性的逐次实测 | `git remote -v` 显示 `origin` 指向维护线仓库且 `main` 跟踪 `origin/main`；推送通道可完成含工作流的提交推送 |
| R-4 | CI 断言 step 首次真实执行 | P1（阻塞发布） | 依赖 R-1/R-3 | 见 R-1 |
| R-5 | 体积预算口径收口 | P2 | 认证后首屏超体积预算上限但不入门禁（体积以 `pnpm check:budget` 与 `frontend/AUDIT.md` 的 FE-19-5 / §37.2 当次输出为准）；`runtime-config.js` 漏算；嵌套 `import()` 不可见；冻结基线陈旧 | 四项在 `frontend/bundle-budget.json` 与 `check-bundle-budget.mjs` 中显式覆盖或登记为豁免，且门禁口径可复现 |
| R-6 | 多副本运行态一致性 | P2 | `memory` driver 在多副本下静默退化为每实例独立限流/粘滞/锁；`replicas > 1` 未强制要求 Redis | 多副本启动时对 `memory` + `replicas>1` 组合 fail-closed 或明确告警 |
| R-7 | 可观测性补全 | P2 | 无请求级全链路 trace；`pkg/perfmetrics` 只写日志与内存 gauge，无导出端点；`/readyz` 只有二值状态 | 定义 SLO 与采集方案并落地至少一个导出端点；或登记为明确不做并说明替代手段 |
| R-8 | 后端分层边界收敛 | P2 | application → infra 生产依赖未收敛，仅冻结为只减不增的门禁例外（文件数与 (文件, 包路径) 对数以 `go test ./internal/ports/provider/ -count=1` 当次输出为准，实测值 SSOT 见 `backend/AUDIT.md` C 区 BE-P2-2） | 例外数只降不升，且每项有收敛计划 |
| R-9 | 数据迁移版本化 | P2 | 无版本化迁移表、无 down/回滚路径、无迁移耗时/锁等待指标 | 引入迁移版本记录与回滚路径（或登记为明确不做的决策） |
| R-10 | 网关包体量拆分 | P3 | `application/gateway` 单包文件数与单文件行数偏大（以 `go run ./tools/structurecheck` 与字节级行数当次输出为准，本文不复制数值） | 给出拆分边界与阶段计划，拆分后门禁仍全绿 |
| R-11 | 文档矩阵补全 | P3 | 阶段验收矩阵、三工具差异表、FT-01 纳入/排除矩阵缺失 | 矩阵补齐且与实际门禁输出一致 |
| R-12 | E2E 场景补全 | P3 | 账号导入/额度/模型封锁/出口/质量守护/创作台/文档场景未纳入 E2E | 按阶段纳入 `pnpm verify:full` 且断言真实执行 |
| R-13 | 门禁接线补全 | P3 | 预算 artifact 上传、根级文件无三工具覆盖、版本一致性无本地接线（部分已落地为 `check:version`） | CI step 覆盖且本地命令等价 |
| R-14 | Provider 能力声明编译期强制 | P3 | 能力与接口一致性仅运行时校验（`Definition.Validate()`），漏改只在启动暴露 | 新增 Provider 能力时缺失实现可在编译期或测试期失败 |
| R-15 | 外部依赖熔断与灰度 | P3 | FlareSolverr / Statsig signer / ipinfo 探针等外部端点无熔断策略文档 | 明确各外部依赖的超时、重试、降级与回滚流程 |

实施顺序、文件级改动点与验证命令见 `docs/implementation-plan.md`。

---

## 8. 需求追踪（示例）

| 需求 | 实现位置（代表） | 验证方式 |
| --- | --- | --- |
| FR-A1 | `backend/internal/transport/http/inference/chat_handler.go` | `pnpm test:e2e`；`go test ./internal/transport/...` |
| FR-A3 | `backend/internal/transport/http/inference/handler.go`、`infra/provider/conversation` | `backend/api-baseline.txt` + E2E |
| FR-B4 | `backend/internal/application/account/credential_scheduler.go` | `go test ./internal/application/account/...` |
| FR-D5 | `backend/internal/infra/persistence/relational/client_key_repository.go`、`audit_repository_write.go` | 同事务结算测试 |
| FR-E4 | `backend/internal/pkg/reasoningreplay`、`application/gateway/prompt_cache.go` | `go test ./internal/pkg/reasoningreplay/...` |
| FR-G6 | `tools/egress-quality-guard/*`、`backend/internal/transport/http/egress/quality_guard*.go` | sidecar 单测 + 管理面 API 测试 |
| FR-H4 | `backend/internal/application/audit/service_ledger.go` | 账本健康测试 |
| FR-L2 | `frontend/src/features/docs/endpoint-definitions.ts`、`frontend/src/app/shell-nav-config.ts` | 组件测试 + 文档页路由 E2E |
| FR-L4 | `frontend/package.json`、`backend/scripts/verify.sh` | 直接执行 |

---

## 9. 事实来源与复现命令

规范复现命令统一维护在 `docs/TD.md` §17.5（规范命令）与 `AGENTS.md` §7（门禁入口）；本文不复制命令副本，避免同一事实两处维护得出不同数字。

- 门禁清单与步骤数：SSOT 是 `AGENTS.md` 的 BIND-4（清单）、DEV-4（前端）、TEST-6（后端）。
- 阈值：体积见 `frontend/bundle-budget.json`、结构见两侧 `structure-baseline.json`、覆盖率见 `frontend/vitest.config.ts`（规则 `REV-1`/`REV-2`/`REV-3`/`REV-5`、`TEST-1`/`TEST-2`）。
- 本文 §1.3 / §3.2 的 `文件:行` 引用相对 §0 的基线提交；基线已前移，引用需按当前文件重新定位。

---

## 10. 变更记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-10-12 | 初稿 | 基于 `main` @ `45838afe` 反向梳理产品需求，并纳入当前已知缺口（R-1 ~ R-15）作为演进需求（历史基线 `c6206d50` 因远端仓库重建/历史重写已不可解析） |
| 2026-10-13 | 修订 | 按 DOC-1 / META-2 收口复制项与计数口径：① §0 版本载体改为指向仓库根 `VERSION`（规则见 `AGENTS.md` §8），不再复制版本号；② §7 的 P3 计数保持 6（口径＝本节表格 R-10…R-15），并与 `docs/implementation-plan.md` §1.3 对齐（该文原写 5，EVID-8 留痕见其 §10）；③ 「认证后首屏 282.30 KiB」等会漂移的实测值改为「以 `pnpm check:budget` / `frontend/AUDIT.md` 当次输出为准」；④ R-2/R-3 的版本号与远端重建/重发证据改为指向 `backend/AUDIT.md` D.5 / D.1 / D.2。 |
