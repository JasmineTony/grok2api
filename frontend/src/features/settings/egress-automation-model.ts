import type { EgressOperationsForm } from "@/features/settings/egress-automation-settings";
import type {
  EgressFallbackConfigDTO,
  EgressFallbackMode,
  EgressNodeDTO,
  EgressOperationsConfigDTO,
  EgressScope,
} from "@/entities/egress/egress-dto";

/** 兜底策略默认值：五个作用域都先按不使用兜底处理。 */
function defaultFallbacks(): Record<EgressScope, EgressFallbackConfigDTO> {
  return {
    grok_build: { mode: "none" },
    grok_web: { mode: "none" },
    grok_console: { mode: "none" },
    grok_web_asset: { mode: "none" },
    grok_console_asset: { mode: "none" },
  };
}

const defaultOperationsForm: EgressOperationsForm = {
  probeProvider: "cloudflare",
  probeIntervalSeconds: 900,
  autoAssignEnabled: false,
  autoBalanceEnabled: false,
  assignmentIntervalSeconds: 300,
  fallbacks: defaultFallbacks(),
};

/** 接口配置 → 自动化表单：未加载时用默认值，已加载时逐作用域补齐兜底字段。 */
export function operationsFormFrom(value?: EgressOperationsConfigDTO): EgressOperationsForm {
  if (!value) return { ...defaultOperationsForm, fallbacks: defaultFallbacks() };

  const defaults = defaultFallbacks();
  return {
    probeProvider: value.probeProvider,
    probeIntervalSeconds: value.probeIntervalSeconds,
    autoAssignEnabled: value.autoAssignEnabled,
    autoBalanceEnabled: value.autoBalanceEnabled,
    assignmentIntervalSeconds: value.assignmentIntervalSeconds,
    fallbacks: {
      grok_build: { ...defaults.grok_build, ...value.fallbacks.grok_build },
      grok_web: { ...defaults.grok_web, ...value.fallbacks.grok_web },
      grok_console: { ...defaults.grok_console, ...value.fallbacks.grok_console },
      grok_web_asset: { ...defaults.grok_web_asset, ...value.fallbacks.grok_web_asset },
      grok_console_asset: { ...defaults.grok_console_asset, ...value.fallbacks.grok_console_asset },
    },
  };
}

/** 切换兜底模式：沿用当前候选节点，节点已失效时回落到第一个候选。 */
export function fallbackWithMode(
  candidates: EgressNodeDTO[],
  current: EgressFallbackConfigDTO,
  mode: EgressFallbackMode,
): EgressFallbackConfigDTO {
  const currentCandidate = candidates.find((node) => node.id === current.nodeId);
  return { mode, nodeId: mode === "fixed" ? (currentCandidate?.id ?? candidates[0]?.id) : undefined };
}
