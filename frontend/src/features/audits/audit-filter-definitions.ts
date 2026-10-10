import type {
  DataTableFilter,
  DataTableFilterOption,
  DataTableFilterOptionGroup,
} from "@/shared/components/data-table-filters";

/** 与 react-i18next 的 t 兼容的最小取值函数签名。 */
export type AuditFilterTranslate = (key: string, options?: Record<string, unknown>) => string;

export type AuditFilterOptionItem = { id: string; label: string; description: string; badge?: string };

/** 三级菜单（密钥/账号）的懒加载状态与查询入口。 */
export type AuditFilterOptionGroupState = {
  group: DataTableFilterOptionGroup;
  search: string;
  onSearchChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
};

export type AuditFilterFieldState = {
  value: string;
  onChange: (value: string) => void;
};

export type AuditFiltersInput = {
  t: AuditFilterTranslate;
  model: AuditFilterFieldState & { options: Array<{ value: string; label: string }> };
  status: AuditFilterFieldState;
  mode: AuditFilterFieldState;
  key: AuditFilterFieldState & { group: AuditFilterOptionGroupState };
  account: AuditFilterFieldState & { group: AuditFilterOptionGroupState };
};

// 筛选名单高度约 5 行，超出后内部滚动。
export const AUDIT_FILTER_MAX_HEIGHT = "max-h-56 overflow-y-auto py-0.5";

export type AuditFilterGroupInput = {
  id: string;
  t: AuditFilterTranslate;
  items: AuditFilterOptionItem[];
  total: number;
  failed: boolean;
  fetching: boolean;
  onRetry: () => void;
};

/** 密钥/账号名单的统一展示契约：空态/加载态/失败重试/前 50 条截断提示。 */
export function buildAuditFilterOptionGroup({
  id,
  t,
  items,
  total,
  failed,
  fetching,
  onRetry,
}: AuditFilterGroupInput): DataTableFilterOptionGroup {
  return {
    id,
    label: t(`audits.${id}`),
    emptyLabel: failed
      ? t("audits.filterOptionsLoadFailed")
      : fetching
        ? t("common.loading")
        : t("audits.filterOptionsEmpty"),
    options: items.map((item) => ({
      value: String(item.id),
      label: item.label,
      description: item.description,
      badge: item.badge,
    })),
    loading: fetching,
    hasMore: failed,
    actionLabel: t("common.retry"),
    onAction: onRetry,
    noteLabel: !failed && total > items.length ? t("audits.filterOptionsTruncated") : undefined,
    hideLabel: true,
    maxHeightClassName: AUDIT_FILTER_MAX_HEIGHT,
  };
}

function modelFilter(input: AuditFiltersInput): DataTableFilter {
  const { t, model } = input;
  return {
    id: "model",
    label: t("audits.model"),
    value: model.value,
    onChange: model.onChange,
    options: model.options,
  };
}

function statusFilter(input: AuditFiltersInput): DataTableFilter {
  const { t, status } = input;
  return {
    id: "status",
    label: t("audits.status"),
    value: status.value,
    onChange: status.onChange,
    options: [
      { value: "2xx", label: `2xx · ${t("audits.statusSuccess")}` },
      { value: "4xx", label: `4xx · ${t("audits.statusClientError")}` },
      { value: "5xx", label: `5xx · ${t("audits.statusServerError")}` },
      { value: "other", label: t("audits.statusOtherError") },
    ],
  };
}

function modeFilter(input: AuditFiltersInput): DataTableFilter {
  const { t, mode } = input;
  return {
    id: "mode",
    label: t("audits.mode"),
    value: mode.value,
    onChange: mode.onChange,
    options: [
      { value: "stream", label: t("audits.stream") },
      { value: "nonStream", label: t("audits.nonStream") },
    ],
  };
}

/** 密钥/账号筛选是三级菜单：先选「全部/任意」，再按名称或前缀缩小范围。 */
function groupedFilter(
  id: "key" | "account",
  label: string,
  searchPlaceholder: string,
  field: AuditFilterFieldState & { group: AuditFilterOptionGroupState },
): DataTableFilter {
  const option: DataTableFilterOption = {
    value: "any",
    label,
    groups: [field.group.group],
    onGroupsOpenChange: field.group.onOpenChange,
    groupSearch: {
      value: field.group.search,
      placeholder: searchPlaceholder,
      onChange: field.group.onSearchChange,
    },
  };
  return { id, label, value: field.value, onChange: field.onChange, options: [option] };
}

export function buildAuditFilters(input: AuditFiltersInput): DataTableFilter[] {
  const { t } = input;
  return [
    modelFilter(input),
    statusFilter(input),
    modeFilter(input),
    groupedFilter("key", t("audits.key"), t("audits.keyFilterPlaceholder"), input.key),
    groupedFilter("account", t("audits.account"), t("audits.accountFilterPlaceholder"), input.account),
  ];
}
