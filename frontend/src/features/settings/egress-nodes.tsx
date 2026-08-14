import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  History,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableActionCell,
  TableActionHead,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EgressNodeEditorDialog,
  EgressNodeHistoryDialog,
} from "@/features/settings/egress-node-dialogs";
import {
  checkEgressNode,
  cleanupUnhealthyEgressNodes,
  type ClearanceMode,
  createEgressNode,
  deleteEgressNode,
  deleteEgressNodes,
  type EgressNodeDTO,
  type EgressNodeInput,
  type EgressScope,
  listEgressNodes,
  previewUnhealthyEgressNodes,
  refreshEgressClearance,
  testEgressNode,
  updateEgressNode,
} from "@/features/settings/settings-api";
import { useApiClient } from "@/shared/api/use-api-client";
import { ErrorState } from "@/shared/components/data-state";
import { Pagination } from "@/shared/components/pagination";
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

export function EgressNodes({ clearanceMode = "manual" }: { clearanceMode?: ClearanceMode }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  const [editing, setEditing] = useState<EgressNodeDTO | null | undefined>(undefined);
  const [form, setForm] = useState<EgressNodeInput>(EMPTY_EGRESS_NODE_INPUT);
  const [sort, setSort] = useState<TableSort>({ field: "", order: "asc" });
  const [historyNode, setHistoryNode] = useState<EgressNodeDTO | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [probeFilter, setProbeFilter] = useState<"" | "healthy" | "unhealthy" | "unknown">("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const query = useQuery({
    queryKey: ["egress-nodes", probeFilter, sort.field, sort.order, page, pageSize],
    queryFn: () =>
      listEgressNodes(apiClient, {
        probe: probeFilter,
        page,
        pageSize,
        ...(sort.field ? { sortBy: sort.field, sortOrder: sort.order } : {}),
      }),
  });
  const cleanupPreview = useQuery({
    queryKey: ["egress-nodes", "cleanup-preview"],
    queryFn: () => previewUnhealthyEgressNodes(apiClient),
    enabled: cleanupOpen,
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
    onSuccess: (_, id) => {
      setSelected((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      void invalidateNodes();
      toast.success(t("settings.egress.deleted"));
    },
    onError: (error) => showError(error, t("settings.egress.operationFailed")),
  });
  const removeMany = useMutation({
    mutationFn: () => deleteEgressNodes(apiClient, [...selected]),
    onSuccess: (result) => {
      setSelected(new Set());
      setBatchDeleteOpen(false);
      void invalidateNodes();
      toast.success(t("settings.egress.batchDeleted", { count: result.deleted }));
    },
    onError: (error) => showError(error, t("settings.egress.operationFailed")),
  });
  const cleanupUnhealthy = useMutation({
    mutationFn: () => cleanupUnhealthyEgressNodes(apiClient),
    onSuccess: (result) => {
      setSelected(new Set());
      setCleanupOpen(false);
      void invalidateNodes();
      toast.success(t("settings.egress.cleanupDeleted", { count: result.deleted }));
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
  const probe = useMutation({
    mutationFn: (id: string) => testEgressNode(apiClient, id),
    onSuccess: (result) => {
      void invalidateNodes();
      toast[result.status === "healthy" ? "success" : "error"](
        result.status === "healthy"
          ? t("settings.egress.testedOne")
          : result.error || t("settings.egress.operationFailed"),
      );
    },
    onError: (error) => showError(error, t("settings.egress.operationFailed")),
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
      ...(scope === "grok_build" || scope === "grok_console_asset"
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
    if (scope === "grok_console_asset") return t("settings.egress.scopeConsoleAsset");
    return t("settings.egress.scopeWeb");
  };
  const changeSort = (field: string, initialOrder: SortOrder) => {
    setSelected(new Set());
    setPage(1);
    setSort((current) => nextTableSort(current, field, initialOrder));
  };

  const nodes = query.data?.items ?? [];
  const toggleAll = (checked: boolean) =>
    setSelected(checked ? new Set(nodes.map((node) => node.id)) : new Set());
  const toggleNode = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  const allSelected = nodes.length > 0 && nodes.every((node) => selected.has(node.id));
  const selectedAssignedAccounts = nodes
    .filter((node) => selected.has(node.id))
    .reduce((total, node) => total + node.assignedAccountCount, 0);
  const selectedSourceNodes = nodes.filter((node) => selected.has(node.id) && node.sourceId).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">{t("console.egressDescription")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={probeFilter || "all"}
            onValueChange={(value) => {
              setSelected(new Set());
              setPage(1);
              setProbeFilter(value === "all" ? "" : (value as typeof probeFilter));
            }}
          >
            <SelectTrigger className="h-8 w-[9.5rem]" aria-label={t("settings.egress.probeFilter")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="all">{t("settings.egress.probeAll")}</SelectItem>
              <SelectItem value="healthy">{t("settings.egress.probeHealthy")}</SelectItem>
              <SelectItem value="unhealthy">{t("settings.egress.probeUnhealthy")}</SelectItem>
              <SelectItem value="unknown">{t("settings.egress.probeUnknown")}</SelectItem>
            </SelectContent>
          </Select>
          <Button type="button" size="sm" variant="outline" onClick={() => setCleanupOpen(true)}>
            <Trash2 />
            {t("settings.egress.cleanupUnhealthy")}
          </Button>
          {selected.size > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="text-destructive"
              onClick={() => setBatchDeleteOpen(true)}
            >
              <Trash2 />
              {t("common.delete")} ({selected.size})
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="secondary" onClick={openCreate}>
            <Plus />
            {t("settings.egress.add")}
          </Button>
        </div>
      </div>
      {query.isError ? (
        <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      ) : (
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 px-2">
                  <Checkbox
                    checked={allSelected ? true : selected.size > 0 ? "indeterminate" : false}
                    disabled={nodes.length === 0}
                    aria-label={t("settings.egress.selectVisible")}
                    onCheckedChange={(checked) => toggleAll(checked === true)}
                  />
                </TableHead>
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
                  <TableCell colSpan={7} className="h-20 text-center text-xs text-muted-foreground">
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
                    selected={selected.has(node.id)}
                    checking={check.isPending}
                    probing={probe.isPending}
                    refreshingClearance={refreshClearance.isPending}
                    onSelect={(checked) => toggleNode(node.id, checked)}
                    onEdit={() => openEdit(node)}
                    onCheck={() => check.mutate(node.id)}
                    onProbe={() => probe.mutate(node.id)}
                    onRefreshClearance={() => refreshClearance.mutate(node.id)}
                    onHistory={() => setHistoryNode(node)}
                    onDelete={() => remove.mutate(node.id)}
                  />
                ))
              )}
            </TableBody>
          </Table>
          <Pagination
            className="border-t px-3 py-2"
            page={query.data?.page ?? page}
            pageSize={query.data?.pageSize ?? pageSize}
            total={query.data?.total ?? nodes.length}
            onPageChange={(nextPage) => {
              setSelected(new Set());
              setPage(nextPage);
            }}
            onPageSizeChange={(nextPageSize) => {
              setSelected(new Set());
              setPage(1);
              setPageSize(nextPageSize);
            }}
          />
        </div>
      )}

      <EgressNodeHistoryDialog node={historyNode} onClose={() => setHistoryNode(null)} />
      <AlertDialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.egress.batchDeleteTitle", { count: selected.size })}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-1">
              <span className="block">
                {t("settings.egress.batchDeleteDescription", {
                  count: selected.size,
                  accounts: selectedAssignedAccounts,
                })}
              </span>
              {selectedSourceNodes > 0 ? (
                <span className="block">
                  {t("settings.egress.batchDeleteSourceHint", { count: selectedSourceNodes })}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMany.isPending}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={removeMany.isPending || selected.size === 0}
              onClick={(event) => {
                event.preventDefault();
                removeMany.mutate();
              }}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={cleanupOpen} onOpenChange={setCleanupOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.egress.cleanupTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="space-y-1">
              {cleanupPreview.isPending ? (
                <span className="block">{t("common.loading")}</span>
              ) : cleanupPreview.isError ? (
                <span className="block text-destructive">{cleanupPreview.error.message}</span>
              ) : (
                <>
                  <span className="block">
                    {t("settings.egress.cleanupDescription", {
                      count: cleanupPreview.data?.nodes ?? 0,
                      accounts: cleanupPreview.data?.boundAccounts ?? 0,
                    })}
                  </span>
                  {(cleanupPreview.data?.subscriptionManaged ?? 0) > 0 ? (
                    <span className="block">
                      {t("settings.egress.cleanupSubscriptionHint", {
                        count: cleanupPreview.data?.subscriptionManaged ?? 0,
                      })}
                    </span>
                  ) : null}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cleanupUnhealthy.isPending}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={
                cleanupPreview.isPending ||
                cleanupPreview.isError ||
                cleanupUnhealthy.isPending ||
                (cleanupPreview.data?.nodes ?? 0) === 0
              }
              onClick={(event) => {
                event.preventDefault();
                cleanupUnhealthy.mutate();
              }}
            >
              {t("settings.egress.cleanupConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  clearanceMode: ClearanceMode;
  selected: boolean;
  checking: boolean;
  probing: boolean;
  refreshingClearance: boolean;
  onSelect: (checked: boolean) => void;
  onEdit: () => void;
  onCheck: () => void;
  onProbe: () => void;
  onRefreshClearance: () => void;
  onHistory: () => void;
  onDelete: () => void;
};

function EgressNodeRow({
  node,
  scopeLabel,
  clearanceMode,
  selected,
  checking,
  probing,
  refreshingClearance,
  onSelect,
  onEdit,
  onCheck,
  onProbe,
  onRefreshClearance,
  onHistory,
  onDelete,
}: EgressNodeRowProps) {
  const { t } = useTranslation();
  return (
    <TableRow className="group" data-state={selected ? "selected" : undefined}>
      <TableCell className="px-2">
        <Checkbox
          checked={selected}
          aria-label={t("common.selectItem", { name: node.name })}
          onCheckedChange={(checked) => onSelect(checked === true)}
        />
      </TableCell>
      <TableCell>
        <div className="text-xs font-medium">{node.name}</div>
        {node.lastError ? (
          <div className="mt-0.5 max-w-72 whitespace-normal break-words text-[11px] text-destructive">
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
            <DropdownMenuItem disabled={probing || !node.proxyConfigured} onClick={onProbe}>
              <Search />
              {t("settings.egress.test")}
            </DropdownMenuItem>
            {clearanceMode !== "manual" && node.scope === "grok_web" ? (
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
