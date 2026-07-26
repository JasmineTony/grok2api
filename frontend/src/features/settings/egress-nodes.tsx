import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, History, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableActionCell,
  TableActionHead,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EgressNodeEditorDialog,
  EgressNodeHistoryDialog,
} from "@/features/settings/egress-node-dialogs";
import {
  checkEgressNode,
  createEgressNode,
  deleteEgressNode,
  type EgressNodeDTO,
  type EgressNodeInput,
  type EgressScope,
  listEgressNodes,
  refreshEgressClearance,
  updateEgressNode,
} from "@/features/settings/settings-api";
import { useApiClient } from "@/shared/api/use-api-client";
import { ErrorState } from "@/shared/components/data-state";
import { SortableTableHead } from "@/shared/components/sortable-table-head";
import { nextTableSort, type SortOrder, type TableSort } from "@/shared/lib/table-sort";
const EMPTY_EGRESS_NODE_INPUT: EgressNodeInput = {
  name: "",
  scope: "grok_build",
  enabled: true,
  proxyURL: "",
  userAgent: "",
  cloudflareCookies: "",
  proxyPool: false,
  accountCapacity: 0,
};

export function EgressNodes({
  clearanceMode = "manual",
}: {
  clearanceMode?: "manual" | "flaresolverr";
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  const [editing, setEditing] = useState<EgressNodeDTO | null | undefined>(undefined);
  const [form, setForm] = useState<EgressNodeInput>(EMPTY_EGRESS_NODE_INPUT);
  const [sort, setSort] = useState<TableSort>({ field: "", order: "asc" });
  const [historyNode, setHistoryNode] = useState<EgressNodeDTO | null>(null);
  const query = useQuery({
    queryKey: ["egress-nodes", sort.field, sort.order],
    queryFn: () =>
      listEgressNodes(apiClient, sort.field ? { sortBy: sort.field, sortOrder: sort.order } : {}),
  });
  const invalidateNodes = () => queryClient.invalidateQueries({ queryKey: ["egress-nodes"] });
  const save = useMutation({
    mutationFn: () => {
      const input = normalizeNodeInput(form);
      return editing
        ? updateEgressNode(apiClient, editing.id, input)
        : createEgressNode(apiClient, input);
    },
    onSuccess: () => {
      void invalidateNodes();
      setEditing(undefined);
      toast.success(t("settings.egress.saved"));
    },
    onError: (error) => showError(error, t("settings.egress.operationFailed")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteEgressNode(apiClient, id),
    onSuccess: () => {
      void invalidateNodes();
      toast.success(t("settings.egress.deleted"));
    },
    onError: (error) => showError(error, t("settings.egress.operationFailed")),
  });
  const check = useMutation({
    mutationFn: (id: string) => checkEgressNode(apiClient, id),
    onSuccess: (result) => {
      void invalidateNodes();
      void queryClient.invalidateQueries({ queryKey: ["egress-health-checks", result.nodeId] });
      toast[result.healthy ? "success" : "error"](
        t(result.healthy ? "settings.egress.healthy" : "settings.egress.unhealthy"),
      );
    },
    onError: (error) => showError(error, t("settings.egress.healthCheckFailed")),
  });
  const refreshClearance = useMutation({
    mutationFn: (id: string) => refreshEgressClearance(apiClient, id),
    onSuccess: () => {
      void invalidateNodes();
      toast.success(t("settings.egress.clearanceRefreshed"));
    },
    onError: (error) => showError(error, t("settings.egress.operationFailed")),
  });

  const openCreate = () => {
    setForm(EMPTY_EGRESS_NODE_INPUT);
    setEditing(null);
  };
  const openEdit = (node: EgressNodeDTO) => {
    setForm({
      name: node.name,
      scope: node.scope,
      enabled: node.enabled,
      userAgent: node.scope === "grok_build" ? "" : node.userAgent,
      proxyURL: "",
      cloudflareCookies: "",
      proxyPool: node.proxyPool,
      accountCapacity: node.accountCapacity,
    });
    setEditing(node);
  };
  const changeScope = (scope: EgressScope) => {
    const previousDefault = query.data?.defaultUserAgents[form.scope] ?? "";
    const nextDefault = query.data?.defaultUserAgents[scope] ?? "";
    setForm({
      ...form,
      scope,
      userAgent:
        scope === "grok_build"
          ? ""
          : form.userAgent === "" || form.userAgent === previousDefault
            ? nextDefault
            : form.userAgent,
      ...(scope === "grok_build"
        ? { cloudflareCookies: "" }
        : form.cloudflareCookies === undefined
          ? {}
          : { cloudflareCookies: form.cloudflareCookies }),
    });
  };
  const scopeLabel = (scope: EgressScope) => {
    if (scope === "grok_build") return t("settings.egress.scopeBuild");
    if (scope === "grok_console") return t("console.name");
    if (scope === "grok_web_asset") return t("settings.egress.scopeWebAsset");
    return t("settings.egress.scopeWeb");
  };
  const changeSort = (field: string, initialOrder: SortOrder) =>
    setSort((current) => nextTableSort(current, field, initialOrder));

  const nodes = query.data?.items ?? [];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t("console.egressDescription")}</p>
        <Button type="button" size="sm" variant="secondary" onClick={openCreate}>
          <Plus />
          {t("settings.egress.add")}
        </Button>
      </div>
      {query.isError ? (
        <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      ) : (
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead
                  field="name"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  onSort={changeSort}
                >
                  {t("settings.egress.name")}
                </SortableTableHead>
                <SortableTableHead
                  field="scope"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  align="center"
                  onSort={changeSort}
                >
                  {t("settings.egress.scope")}
                </SortableTableHead>
                <SortableTableHead
                  field="proxy"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  align="center"
                  onSort={changeSort}
                >
                  {t("settings.egress.proxy")}
                </SortableTableHead>
                <SortableTableHead
                  field="clearance"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  align="center"
                  onSort={changeSort}
                >
                  {t("settings.egress.clearance")}
                </SortableTableHead>
                <SortableTableHead
                  field="health"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  initialOrder="desc"
                  align="center"
                  onSort={changeSort}
                >
                  {t("settings.egress.health")}
                </SortableTableHead>
                <TableActionHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {nodes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-20 text-center text-xs text-muted-foreground">
                    {t("settings.egress.directFallback")}
                  </TableCell>
                </TableRow>
              ) : (
                nodes.map((node) => (
                  <EgressNodeRow
                    key={node.id}
                    node={node}
                    scopeLabel={scopeLabel(node.scope)}
                    clearanceMode={clearanceMode}
                    checking={check.isPending}
                    refreshingClearance={refreshClearance.isPending}
                    onEdit={() => openEdit(node)}
                    onCheck={() => check.mutate(node.id)}
                    onRefreshClearance={() => refreshClearance.mutate(node.id)}
                    onHistory={() => setHistoryNode(node)}
                    onDelete={() => remove.mutate(node.id)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <EgressNodeHistoryDialog node={historyNode} onClose={() => setHistoryNode(null)} />
      <EgressNodeEditorDialog
        editing={editing}
        form={form}
        pending={save.isPending}
        onClose={() => setEditing(undefined)}
        onFormChange={setForm}
        onScopeChange={changeScope}
        onSubmit={() => save.mutate()}
      />
    </div>
  );
}

type EgressNodeRowProps = {
  node: EgressNodeDTO;
  scopeLabel: string;
  clearanceMode: "manual" | "flaresolverr";
  checking: boolean;
  refreshingClearance: boolean;
  onEdit: () => void;
  onCheck: () => void;
  onRefreshClearance: () => void;
  onHistory: () => void;
  onDelete: () => void;
};

function EgressNodeRow({
  node,
  scopeLabel,
  clearanceMode,
  checking,
  refreshingClearance,
  onEdit,
  onCheck,
  onRefreshClearance,
  onHistory,
  onDelete,
}: EgressNodeRowProps) {
  const { t } = useTranslation();
  return (
    <TableRow className="group">
      <TableCell>
        <div className="text-xs font-medium">{node.name}</div>
        {node.lastError ? (
          <div className="mt-0.5 max-w-72 truncate text-[11px] text-destructive">
            {node.lastError}
          </div>
        ) : null}
      </TableCell>
      <TableCell className="text-center">
        <Badge variant="secondary" className="text-[10px]">
          {scopeLabel}
        </Badge>
      </TableCell>
      <TableCell className="text-center text-xs text-muted-foreground">
        {t(node.proxyConfigured ? "settings.egress.configured" : "settings.egress.direct")}
      </TableCell>
      <TableCell className="text-center text-xs text-muted-foreground">
        {t(node.cookieConfigured ? "settings.egress.configured" : "settings.egress.none")}
      </TableCell>
      <TableCell className="text-center text-xs tabular-nums">
        {Math.round(node.health * 100)}%
      </TableCell>
      <TableActionCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t("common.actions")}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil />
              {t("common.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={checking} onClick={onCheck}>
              <Activity />
              {t("settings.egress.check")}
            </DropdownMenuItem>
            {clearanceMode === "flaresolverr" && node.scope === "grok_web" ? (
              <DropdownMenuItem disabled={refreshingClearance} onClick={onRefreshClearance}>
                <RefreshCw />
                {t("settings.egress.refreshClearance")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={onHistory}>
              <History />
              {t("settings.egress.history")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={onDelete}
            >
              <Trash2 />
              {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableActionCell>
    </TableRow>
  );
}

function normalizeNodeInput(form: EgressNodeInput): EgressNodeInput {
  const proxyURL = form.proxyURL?.trim();
  const cloudflareCookies = form.cloudflareCookies?.trim();
  return {
    name: form.name,
    scope: form.scope,
    enabled: form.enabled,
    userAgent: form.scope === "grok_build" ? "" : form.userAgent,
    ...(proxyURL ? { proxyURL } : {}),
    ...(form.scope !== "grok_build" && cloudflareCookies ? { cloudflareCookies } : {}),
    ...(form.clearProxyURL === undefined ? {} : { clearProxyURL: form.clearProxyURL }),
    ...(form.clearCookies === undefined ? {} : { clearCookies: form.clearCookies }),
    ...(form.proxyPool === undefined ? {} : { proxyPool: form.proxyPool }),
    accountCapacity: form.accountCapacity,
  };
}

function showError(error: unknown, fallback: string) {
  toast.error(error instanceof Error ? error.message : fallback);
}
