import { describe, expect, it, vi, type Mock } from "vitest";

import {
  EGRESS_FILTER_NODE_PAGE_SIZE,
  EGRESS_FILTER_SOURCE_PAGE_SIZE,
  accountProviderPrimaryEgressScope,
  buildEgressFilterGroup,
  collectScopedEgressOptions,
  loadMoreEgressFilterOptions,
  nextEgressFilterPage,
  resolveEgressFilterLabel,
  scopeSupportsAccountProvider,
  type EgressFilterPageSource,
} from "@/features/accounts/accounts-egress-filter";
import {
  buildAccountFilterDescriptors,
  type AccountFilterChanges,
  type AccountFilterInput,
} from "@/features/accounts/accounts-filter-descriptors";
import { i18n } from "@/shared/i18n";
import type { DataTableFilter, DataTableFilterOption } from "@/shared/components/data-table-filters";

// 出口筛选纯逻辑测试（AGENTS.md TEST-1）：分页合并、作用域过滤、加载更多与分组描述符。
// 测试文件为 *.test.tsx 才会被 vitest 覆盖率统计；这里不渲染 DOM，只驱动纯函数。

type Entry = { id: string; name: string; scope: "grok_build" | "grok_web" | "grok_console" };

function entry(id: string, name: string, scope: Entry["scope"]): Entry {
  return { id, name, scope };
}

/** descriptor 是 options/text 联合类型：这里只取带选项列表的那一支（测试断言的是选项集合）。 */
function optionsFilter(filters: DataTableFilter[], id: string): DataTableFilterOption[] {
  const filter = filters.find((item) => item.id === id);
  if (!filter || !("options" in filter)) throw new Error(`filter ${id} is not an option filter`);
  return filter.options;
}

/** 出口筛选选中值回显：text 分支没有 selectedLabel，按契约必须为 undefined。 */
function selectedLabelOf(filters: DataTableFilter[], id: string): string | undefined {
  const filter = filters.find((item) => item.id === id);
  return filter && "options" in filter ? filter.selectedLabel : undefined;
}

type PageSourceHarness = Pick<EgressFilterPageSource, "isFetching" | "isError" | "hasNextPage"> & {
  refetch: Mock<() => void>;
  fetchNextPage: Mock<() => void>;
};

function pageSource(overrides: Partial<PageSourceHarness> = {}): PageSourceHarness {
  const source = {
    isFetching: false,
    isError: false,
    hasNextPage: false,
    refetch: vi.fn<() => void>(),
    fetchNextPage: vi.fn<() => void>(),
    ...overrides,
  };
  return source;
}
describe("出口筛选常量与作用域", () => {
  it("节点与订阅源分页大小都有界", () => {
    expect(EGRESS_FILTER_NODE_PAGE_SIZE).toBe(100);
    expect(EGRESS_FILTER_SOURCE_PAGE_SIZE).toBe(100);
  });

  it("主作用域与 provider 一一对应", () => {
    expect(accountProviderPrimaryEgressScope("grok_build")).toBe("grok_build");
    expect(accountProviderPrimaryEgressScope("grok_web")).toBe("grok_web");
    expect(accountProviderPrimaryEgressScope("grok_console")).toBe("grok_console");
  });

  it("Console 池接受 Grok Web 与 Console 出口，其余池只接受同作用域", () => {
    expect(scopeSupportsAccountProvider("grok_build", "grok_build")).toBe(true);
    expect(scopeSupportsAccountProvider("grok_web", "grok_build")).toBe(false);

    expect(scopeSupportsAccountProvider("grok_web", "grok_web")).toBe(true);
    expect(scopeSupportsAccountProvider("grok_build", "grok_web")).toBe(false);

    expect(scopeSupportsAccountProvider("grok_web", "grok_console")).toBe(true);
    expect(scopeSupportsAccountProvider("grok_console", "grok_console")).toBe(true);
    expect(scopeSupportsAccountProvider("grok_build", "grok_console")).toBe(false);
  });
});

describe("collectScopedEgressOptions", () => {
  it("合并多页结果并按账号池作用域过滤", () => {
    const options = collectScopedEgressOptions(
      [[entry("1", "东京", "grok_build"), entry("2", "新加坡", "grok_web")], [entry("3", "法兰克福", "grok_build")]],
      "grok_build",
      "",
    );

    expect(options.map((item) => item.id)).toEqual(["1", "3"]);
  });

  it("搜索词忽略大小写与首尾空格", () => {
    const pages = [[entry("1", "Tokyo A", "grok_web"), entry("2", "Osaka", "grok_web")]];

    expect(collectScopedEgressOptions(pages, "grok_web", "  tokyo ").map((item) => item.id)).toEqual(["1"]);
    expect(collectScopedEgressOptions(pages, "grok_web", "zzz")).toEqual([]);
  });

  it("空分页返回空数组", () => {
    expect(collectScopedEgressOptions([], "grok_web", "")).toEqual([]);
  });
});

describe("resolveEgressFilterLabel", () => {
  const groups = [
    { id: "nodes", label: "节点", options: [{ value: "node:1", label: "东京" }] },
    { id: "sources", label: "订阅源", options: [{ value: "source:2", label: "订阅 A" }] },
  ];

  it("未选择具体节点/订阅源时返回空标签", () => {
    expect(resolveEgressFilterLabel(groups, "bound")).toBe("");
  });

  it("在后续分组里命中时返回该分组标签", () => {
    expect(resolveEgressFilterLabel(groups, "source:2")).toBe("订阅 A");
  });

  it("带冒号但分组里找不到时返回空标签", () => {
    expect(resolveEgressFilterLabel(groups, "node:404")).toBe("");
  });
});

describe("loadMoreEgressFilterOptions", () => {
  it("全部来源成功时按 hasNextPage 继续翻页", () => {
    const withMore = pageSource({ hasNextPage: true });
    const exhausted = pageSource({ hasNextPage: false });

    loadMoreEgressFilterOptions([withMore, exhausted]);

    expect(withMore.fetchNextPage).toHaveBeenCalledTimes(1);
    expect(exhausted.fetchNextPage).not.toHaveBeenCalled();
    expect(withMore.refetch).not.toHaveBeenCalled();
  });

  it("任一来源失败时只重试失败来源，不翻页", () => {
    const failed = pageSource({ isError: true, hasNextPage: true });
    const healthy = pageSource({ hasNextPage: true });

    loadMoreEgressFilterOptions([failed, healthy]);

    expect(failed.refetch).toHaveBeenCalledTimes(1);
    expect(failed.fetchNextPage).not.toHaveBeenCalled();
    expect(healthy.fetchNextPage).not.toHaveBeenCalled();
  });

  it("无来源时不产生任何调用", () => {
    expect(() => loadMoreEgressFilterOptions([])).not.toThrow();
  });
});

describe("buildEgressFilterGroup", () => {
  function groupInput(overrides: Partial<Parameters<typeof buildEgressFilterGroup>[0]> = {}) {
    return {
      t: (key: string) => i18n.t(key),
      kind: "nodes" as const,
      options: [{ value: "node:1", label: "东京" }],
      failed: false,
      fetching: false,
      hasMore: false,
      onAction: vi.fn(),
      ...overrides,
    };
  }

  it("节点分组使用节点专属文案与分页状态", () => {
    const onAction = vi.fn();
    const group = buildEgressFilterGroup(groupInput({ hasMore: true, fetching: true, onAction }));

    expect(group.id).toBe("nodes");
    expect(group.label).toBe(i18n.t("accounts.egressNodeGroup"));
    expect(group.actionLabel).toBe(i18n.t("common.loading"));
    expect(group.emptyLabel).toBe(i18n.t("common.loading"));
    expect(group.loading).toBe(true);
    expect(group.hasMore).toBe(true);
    expect(group.options).toEqual([{ value: "node:1", label: "东京" }]);
    expect(group.options).not.toBe(groupInput().options);

    group.onAction?.();
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("订阅源分组使用订阅源专属文案", () => {
    const group = buildEgressFilterGroup(groupInput({ kind: "sources" }));

    expect(group.id).toBe("sources");
    expect(group.label).toBe(i18n.t("accounts.egressSourceGroup"));
    expect(group.emptyLabel).toBe(i18n.t("accounts.egressSourceGroupEmpty"));
    expect(group.actionLabel).toBe(i18n.t("accounts.egressFilterSourcesLoadMore"));
  });

  it("加载失败时动作与空态都提示重试", () => {
    const group = buildEgressFilterGroup(groupInput({ failed: true, fetching: true }));

    expect(group.actionLabel).toBe(i18n.t("common.retry"));
    expect(group.emptyLabel).toBe(i18n.t("accounts.egressFilterOptionsLoadFailed"));
  });

  it("节点分组默认空态与「加载更多」使用节点文案", () => {
    const group = buildEgressFilterGroup(groupInput());

    expect(group.emptyLabel).toBe(i18n.t("accounts.egressNodeGroupEmpty"));
    expect(group.actionLabel).toBe(i18n.t("accounts.egressFilterOptionsLoadMore"));
  });
});

describe("nextEgressFilterPage", () => {
  it("还有剩余条目时返回下一页", () => {
    expect(nextEgressFilterPage({ page: 1, pageSize: 100, total: 250 })).toBe(2);
  });

  it("已取满时返回 undefined", () => {
    expect(nextEgressFilterPage({ page: 3, pageSize: 100, total: 300 })).toBeUndefined();
  });
});

describe("buildAccountFilterDescriptors", () => {
  type DescriptorHarness = {
    filters: DataTableFilter[];
    onChange: AccountFilterChanges;
    onEgressLabelChange: Mock<(label: string) => void>;
    onEgressGroupsOpenChange: Mock<(open: boolean) => void>;
  };

  /** 用真实 descriptor 契约构造筛选输入；values / onChange 等维度可按用例如需整体覆盖。 */
  function descriptorInput(
    provider: "grok_build" | "grok_web" | "grok_console",
    overrides: Partial<AccountFilterInput> = {},
  ): DescriptorHarness {
    const onChange: AccountFilterChanges = {
      type: vi.fn<(value: string) => void>(),
      status: vi.fn<(value: string) => void>(),
      egress: vi.fn<(value: string) => void>(),
      renewal: vi.fn<(value: string) => void>(),
      risk: vi.fn<(value: string) => void>(),
      agreement: vi.fn<(value: string) => void>(),
      association: vi.fn<(value: string) => void>(),
    };
    const onEgressLabelChange = vi.fn<(label: string) => void>();
    const onEgressGroupsOpenChange = vi.fn<(open: boolean) => void>();
    const filters = buildAccountFilterDescriptors({
      t: (key: string, options?: Record<string, unknown>) => i18n.t(key, options),
      provider,
      values: {
        type: "free",
        status: "active",
        egress: "bound",
        egressSelectedLabel: "东京",
        renewal: "refreshable",
        risk: "flagged",
        agreement: "nsfwEnabled",
        association: "webLinked",
      },
      onChange,
      egressGroups: [{ id: "nodes", label: "节点", options: [{ value: "node:1", label: "东京" }] }],
      egressGroupSearch: { value: "", onChange: vi.fn<(value: string) => void>() },
      onEgressGroupsOpenChange,
      onEgressLabelChange,
      ...overrides,
    });
    return { filters, onChange, onEgressLabelChange, onEgressGroupsOpenChange };
  }

  it("Build 池包含类型、状态、出口、凭据、风险与关联筛选", () => {
    const { filters } = descriptorInput("grok_build");

    expect(filters.map((filter) => filter.id)).toEqual(["type", "status", "egress", "renewal", "risk", "association"]);
    expect(optionsFilter(filters, "type").map((option) => option.value)).toEqual(["free", "paid", "unknown"]);
  });

  it("Web 池包含分层、协议与关联筛选，不含凭据与风险", () => {
    const { filters } = descriptorInput("grok_web");

    expect(filters.map((filter) => filter.id)).toEqual(["type", "status", "egress", "agreement", "association"]);
    expect(optionsFilter(filters, "type").map((option) => option.value)).toEqual(["auto", "basic", "super", "heavy"]);
    expect(optionsFilter(filters, "association").map((option) => option.value)).toEqual([
      "buildLinked",
      "buildUnlinked",
      "consoleLinked",
      "consoleUnlinked",
      "allLinked",
      "allUnlinked",
    ]);
  });

  it("Console 池没有类型维度，关联筛选只保留 Web 关联", () => {
    const { filters } = descriptorInput("grok_console");

    expect(filters.map((filter) => filter.id)).toEqual(["status", "egress", "association"]);
    expect(optionsFilter(filters, "association").map((option) => option.value)).toEqual(["webLinked", "webUnlinked"]);
  });

  it("出口筛选项把选中值、标签解析与分组搜索回调接到 descriptor", () => {
    const { filters, onChange, onEgressLabelChange, onEgressGroupsOpenChange } = descriptorInput("grok_build");
    const egress = filters.find((filter) => filter.id === "egress");
    expect(egress?.value).toBe("bound");
    expect(selectedLabelOf(filters, "egress")).toBe("东京");

    egress?.onChange("node:1");
    expect(onChange.egress).toHaveBeenCalledWith("node:1");
    expect(onEgressLabelChange).toHaveBeenCalledWith("东京");

    const bound = optionsFilter(filters, "egress").find((option) => option.value === "bound");
    expect(bound?.groups).toHaveLength(1);
    expect(bound?.groupSearch?.placeholder).toBe(i18n.t("accounts.egressFilterOptionsSearch"));
    bound?.onGroupsOpenChange?.(true);
    expect(onEgressGroupsOpenChange).toHaveBeenCalledWith(true);
  });

  it("未选择具体出口时不带 selectedLabel", () => {
    const { filters } = descriptorInput("grok_build", {
      values: {
        type: "",
        status: "",
        egress: "",
        egressSelectedLabel: "",
        renewal: "",
        risk: "",
        agreement: "",
        association: "",
      },
      egressGroups: [],
    });

    expect(selectedLabelOf(filters, "egress")).toBeUndefined();
  });
});
