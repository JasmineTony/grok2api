import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { listAccounts } from "@/features/accounts/accounts-api";
import {
  buildAuditFilterOptionGroup,
  type AuditFilterOptionGroupState,
  type AuditFilterOptionItem,
} from "@/features/audits/audit-filter-definitions";
import { auditFilterOptionSearch, providerShortLabel } from "@/features/audits/audit-format";
import { listClientKeys } from "@/features/client-keys/client-keys-api";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";

// 筛选名单始终限制在服务器搜索后的前 50 条，避免大账号池把大量选项累积到浏览器。
const AUDIT_FILTER_PAGE_SIZE = 50;

type AuditFilterOptionSource = {
  id: "key" | "account";
  // 查询 key 前缀与原实现保持一致，不改变 react-query 缓存范围。
  queryKeyPrefix: string;
  loadOptions: (search: string) => Promise<{ items: AuditFilterOptionItem[]; total: number }>;
};

/**
 * 密钥/账号筛选名单只在对应三级菜单展开时懒加载，输入后重新按匹配查询；
 * 两个名单共用「展开才请求 + 防抖搜索 + 前 50 条截断提示」语义。
 */
function useAuditFilterOptionGroup({
  id,
  queryKeyPrefix,
  loadOptions,
}: AuditFilterOptionSource): AuditFilterOptionGroupState {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const query = useQuery({
    queryKey: [queryKeyPrefix, "audit-filter", debouncedSearch],
    queryFn: () => loadOptions(auditFilterOptionSearch(debouncedSearch)),
    enabled: open,
    staleTime: 60_000,
  });
  const onRetry = useCallback((): void => {
    void query.refetch();
  }, [query]);
  const group = buildAuditFilterOptionGroup({
    id,
    t,
    items: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    failed: query.isError,
    fetching: query.isFetching,
    onRetry,
  });
  return { group, search, onSearchChange: setSearch, onOpenChange: setOpen };
}

export type AuditFilterOptions = {
  keyGroup: AuditFilterOptionGroupState;
  accountGroup: AuditFilterOptionGroupState;
};

async function loadClientKeyOptions(search: string): Promise<{ items: AuditFilterOptionItem[]; total: number }> {
  const page = await listClientKeys({ page: 1, pageSize: AUDIT_FILTER_PAGE_SIZE, search });
  return {
    items: page.items.map((key) => ({
      id: key.id,
      label: key.name || key.prefix,
      description: `#${key.id} · ${key.prefix}`,
    })),
    total: page.total,
  };
}

// 账号范围覆盖三种 provider，审计记录可能来自任一 provider 的账号。
async function loadAccountOptions(search: string): Promise<{ items: AuditFilterOptionItem[]; total: number }> {
  const page = await listAccounts({ page: 1, pageSize: AUDIT_FILTER_PAGE_SIZE, search });
  return {
    items: page.items.map((account) => ({
      id: account.id,
      label: account.name || account.email || `#${account.id}`,
      description: `#${account.id}`,
      badge: providerShortLabel(account.provider),
    })),
    total: page.total,
  };
}

export function useAuditFilterOptions(): AuditFilterOptions {
  const keyGroup = useAuditFilterOptionGroup({
    id: "key",
    queryKeyPrefix: "client-keys",
    loadOptions: loadClientKeyOptions,
  });
  const accountGroup = useAuditFilterOptionGroup({
    id: "account",
    queryKeyPrefix: "accounts",
    loadOptions: loadAccountOptions,
  });
  return { keyGroup, accountGroup };
}
