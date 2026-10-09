/**
 * zh-CN 文案 · 账号凭据、导出、额度重置与额度产品。
 * 命名空间：accountCredential、accountExport、accountQuotaReset、accountQuotaTask、quotaProducts。
 */
export default {
  accountCredential: {
    label: "凭据续期",
    quotaSyncAction: "额度同步",
    refreshAction: "凭据刷新",
    autoRefresh: "支持自动续期",
    noAutoRefresh: "不支持自动续期",
    expiresAt: "凭据过期时间：{{time}}",
    expiryUnknown: "凭据过期时间未知",
    detectAction: "检测账号",
  },
  accountExport: {
    countDescription: "按稳定顺序分批导出，单批最多 10000 个。",
    batchProgress: "已导出 {{count}} 个账号；下一批为第 {{batch}} 批。",
    nextBatch: "导出下一批",
    batchCompleted: "本批已导出 {{count}} 个账号",
    completed: "导出完成，共 {{count}} 个账号",
  },
  accountQuotaReset: {
    action: "重置额度",
    description:
      "仅清除本地待重置和模型额度阻断，不会修改上游 Billing 或审计记录。若账号仍已耗尽，真实请求会再次将其标记为待重置。",
    completed: "已重置 {{reset}} 个账号的本地额度状态",
  },
  accountQuotaTask: {
    title: "处理所选 {{count}} 个账号的额度",
    description: "选择要对所选 Grok Build 账号执行的额度任务。",
    allTitle: "处理全部账号的额度",
    allDescription: "选择要对全部已启用 Grok Build 账号执行的额度任务。",
    syncDescription: "请求上游 Billing 并更新本地额度快照、账号类型和恢复状态。",
    resetAllDescription: "清除全部已启用 Grok Build 账号的本地待重置和额度耗尽阻断；不会修改上游 Billing 或审计记录。",
    execute: "执行任务",
  },
  quotaProducts: {
    thirdParty: "第三方",
    api: "API",
    build: "Grok Build",
    plugins: "Grok Plugins",
    chat: "聊天",
    imagine: "Imagine",
    voice: "语音",
    unknown: "产品 {{code}}",
  },
} as const;
