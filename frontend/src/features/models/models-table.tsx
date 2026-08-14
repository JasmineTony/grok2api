import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { ModelRouteDTO } from "@/entities/model/types";
import { ModelCapabilities, ModelProvider } from "@/features/models/model-group";
import { capabilityLabel, type ModelRouteGroup } from "@/features/models/model-group-utils";
import { EmptyState, ErrorState, TableLoadingRow } from "@/shared/components/data-state";
import { SortableTableHead } from "@/shared/components/sortable-table-head";
import { VirtualTableBody } from "@/shared/components/virtual-table-body";
import { cn } from "@/shared/lib/cn";
import { formatDateTime } from "@/shared/lib/format";
import type { SortOrder, TableSort } from "@/shared/lib/table-sort";

type ModelsTableProps = {
  items: ModelRouteGroup[];
  isPending: boolean;
  isError: boolean;
  errorMessage: string;
  selected: Set<string>;
  allPageSelected: boolean;
  selectedOnPageCount: number;
  sort: TableSort;
  onRetry: () => void;
  onTogglePage: (checked: boolean) => void;
  onToggleModelGroup: (routes: ModelRouteDTO[], checked: boolean) => void;
  onSort: (field: string, initialOrder: SortOrder) => void;
  onEdit: (route: ModelRouteDTO) => void;
  onDelete: (group: ModelRouteGroup) => void;
};

export function ModelsTable({
  items,
  isPending,
  isError,
  errorMessage,
  selected,
  allPageSelected,
  selectedOnPageCount,
  sort,
  onRetry,
  onTogglePage,
  onToggleModelGroup,
  onSort,
  onEdit,
  onDelete,
}: ModelsTableProps) {
  const { t, i18n } = useTranslation();
  return (
    <>
      {isError ? <ErrorState message={errorMessage} onRetry={() => void onRetry()} /> : null}
      {!isPending && !isError && items.length === 0 ? <EmptyState /> : null}
      {isPending || items.length > 0 ? (
        <Table viewportRows={20} rowHeight={72} className="min-w-[1120px] table-fixed text-xs">
          <colgroup>
            <col className="w-10" />
            <col className="w-56" />
            <col className="w-32" />
            <col className="w-52" />
            <col className="w-24" />
            <col className="w-32" />
            <col className="w-40" />
            <col className="w-44" />
            <col className="w-10" />
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-2 text-center">
                <Checkbox
                  checked={
                    allPageSelected ? true : selectedOnPageCount > 0 ? "indeterminate" : false
                  }
                  onCheckedChange={(checked) => onTogglePage(checked === true)}
                  aria-label={t("common.selectPage")}
                />
              </TableHead>
              <SortableTableHead
                field="publicId"
                sortBy={sort.field}
                sortOrder={sort.order}
                onSort={onSort}
              >
                {t("models.model")}
              </SortableTableHead>
              <SortableTableHead
                field="upstreamModel"
                sortBy={sort.field}
                sortOrder={sort.order}
                onSort={onSort}
              >
                {t("models.upstream")}
              </SortableTableHead>
              <TableHead className="text-center">{t("models.capability")}</TableHead>
              <SortableTableHead
                field="status"
                sortBy={sort.field}
                sortOrder={sort.order}
                align="center"
                onSort={onSort}
              >
                {t("models.status")}
              </SortableTableHead>
              <SortableTableHead
                field="provider"
                sortBy={sort.field}
                sortOrder={sort.order}
                align="center"
                onSort={onSort}
              >
                {t("models.provider")}
              </SortableTableHead>
              <SortableTableHead
                field="accountSupport"
                sortBy={sort.field}
                sortOrder={sort.order}
                initialOrder="desc"
                align="center"
                onSort={onSort}
              >
                {t("models.accountSupport")}
              </SortableTableHead>
              <SortableTableHead
                field="lastSyncedAt"
                sortBy={sort.field}
                sortOrder={sort.order}
                initialOrder="desc"
                onSort={onSort}
              >
                {t("models.lastSyncedAt")}
              </SortableTableHead>
              <TableActionHead />
            </TableRow>
          </TableHeader>
          {isPending ? (
            <TableBody>
              <TableLoadingRow colSpan={9} />
            </TableBody>
          ) : (
            <VirtualTableBody
              items={items}
              colSpan={9}
              rowHeight={72}
              renderRow={(model) => {
                const selectedRoutes = model.routes.filter((route) =>
                  selected.has(route.id),
                ).length;
                return (
                  <TableRow
                    className="group h-[72px]"
                    key={model.key}
                    data-state={selectedRoutes > 0 ? "selected" : undefined}
                  >
                    <TableCell className="px-2 text-center">
                      <Checkbox
                        checked={
                          selectedRoutes === model.routes.length
                            ? true
                            : selectedRoutes > 0
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={(checked) =>
                          onToggleModelGroup(model.routes, checked === true)
                        }
                        aria-label={t("common.selectItem", { name: model.publicId })}
                      />
                    </TableCell>
                    <TableCell className="min-w-0">
                      <span className="block truncate text-xs font-medium" title={model.publicId}>
                        {model.publicId}
                      </span>
                    </TableCell>
                    <TableCell className="min-w-0">
                      <span
                        className="block truncate text-xs text-muted-foreground"
                        title={model.upstreamModel}
                      >
                        {model.upstreamModel}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <ModelCapabilities capabilities={model.capabilities} />
                    </TableCell>
                    <TableCell className="text-center">
                      {model.enabledState === "enabled" ? (
                        <Badge
                          variant="secondary"
                          className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        >
                          {t("common.enabled")}
                        </Badge>
                      ) : model.enabledState === "disabled" ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          {t("common.disabled")}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-700 dark:text-amber-300">
                          {t("models.partiallyEnabled")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <ModelProvider provider={model.provider} />
                    </TableCell>
                    <TableCell className="text-center text-xs">
                      <div title={model.supportTitle}>
                        <span className="inline-flex items-baseline gap-1 tabular-nums">
                          <span
                            className={cn(
                              "font-medium",
                              model.supportedMax > 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-muted-foreground",
                            )}
                          >
                            {model.supportedLabel}
                          </span>
                          <span className="text-muted-foreground">/ {model.totalLabel}</span>
                        </span>
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">
                          {t(
                            model.bindingState === "bound"
                              ? "models.boundAccounts"
                              : model.bindingState === "automatic"
                                ? "models.automaticAccounts"
                                : "models.mixedAccounts",
                          )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(model.lastSyncedAt, i18n.language)}
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
                          {model.routes.map((route) => (
                            <DropdownMenuItem key={route.id} onClick={() => onEdit(route)}>
                              <Pencil />
                              {model.routes.length === 1
                                ? t("common.edit")
                                : t("models.editCapability", {
                                    capability: capabilityLabel(route.capability, t),
                                  })}
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => onDelete(model)}
                          >
                            <Trash2 />
                            {t("common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableActionCell>
                  </TableRow>
                );
              }}
            />
          )}
        </Table>
      ) : null}
    </>
  );
}
