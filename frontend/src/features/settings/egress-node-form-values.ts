import type { EgressNodeDTO, EgressNodeInput, EgressScope } from "@/entities/egress/egress-dto";

/**
 * 出口节点弹窗草稿的字段规则：空草稿、由节点回填、按作用域/代理配置重算，
 * 以及提交时对代理地址与 Cookie 的取舍。这些规则与渲染无关，集中在此便于单独验证。
 */

/** 新建节点时的空草稿。 */
export const emptyEgressNodeInput: EgressNodeInput = {
  name: "",
  scope: "grok_build",
  enabled: true,
  proxyPool: false,
  accountCapacity: 0,
  proxyURL: "",
  userAgent: "",
  cloudflareCookies: "",
};

/** 由已有节点生成编辑草稿：代理地址与 Cookie 不回填明文，只保留「已配置」语义。 */
export function egressNodeInputFromNode(node: EgressNodeDTO): EgressNodeInput {
  return {
    name: node.name,
    scope: node.scope,
    enabled: node.enabled,
    proxyPool: node.proxyPool,
    accountCapacity: node.accountCapacity,
    proxyProfileId: node.proxyProfileId,
    userAgent: node.scope === "grok_build" ? "" : node.userAgent,
    proxyURL: "",
    cloudflareCookies: "",
  };
}

/**
 * 切换作用域时重算凭据字段：Build 清空 UA 与 Cookie，控制台资源清空 Cookie；
 * 其余作用域在 UA 为空或仍是上一作用域默认值时注入该作用域的默认 UA。
 */
export function egressNodeInputForScope(
  form: EgressNodeInput,
  scope: EgressScope,
  defaultUserAgents: Record<EgressScope, string> | undefined,
): EgressNodeInput {
  const previousDefault = defaultUserAgents?.[form.scope] ?? "";
  const nextDefault = defaultUserAgents?.[scope] ?? "";
  return {
    ...form,
    scope,
    userAgent:
      scope === "grok_build"
        ? ""
        : form.userAgent === "" || form.userAgent === previousDefault
          ? nextDefault
          : form.userAgent,
    cloudflareCookies: scope === "grok_build" || scope === "grok_console_asset" ? "" : form.cloudflareCookies,
  };
}

/** 选择代理配置（含「手动」）时的字段变化：手动即标记解除配置库绑定。 */
export function egressNodeInputForProxyProfile(
  editing: EgressNodeDTO | null | undefined,
  value: string,
): Partial<EgressNodeInput> {
  return {
    proxyProfileId: value === "manual" ? (editing?.proxyProfileId ? "0" : undefined) : value,
    proxyURL: "",
  };
}

/**
 * 提交体：只提交用户新填的代理地址，未修改时留空让服务端保留既有配置；
 * Build 作用域不提交 UA 与 Cookie，其它作用域提交去空白后的值。
 */
export function egressNodeInputForSave(
  form: EgressNodeInput,
  editing: EgressNodeDTO | null | undefined,
  revealedProxyURL: string,
): EgressNodeInput {
  const normalizedProxyURL = form.proxyURL?.trim() || "";
  return {
    ...form,
    proxyURL:
      normalizedProxyURL && (!editing || normalizedProxyURL !== revealedProxyURL) ? normalizedProxyURL : undefined,
    userAgent: form.scope === "grok_build" ? "" : form.userAgent,
    cloudflareCookies: form.scope === "grok_build" ? undefined : form.cloudflareCookies?.trim() || undefined,
  };
}
