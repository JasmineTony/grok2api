import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

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
import {
  ModelAccountSupportCell,
  ModelCapabilities,
  ModelEnabledStateBadge,
  ModelProvider,
} from "@/features/models/model-cells";
import { capabilityLabel, type ModelRouteGroup } from "@/features/models/model-display";
import { pageSelectionState } from "@/features/models/model-selection";
import type { ModelListController } from "@/features/models/use-model-list";
import type { ModelSelectionController } from "@/features/models/use-model-selection";
import { EmptyState, ErrorState, TableLoadingRow } from "@/shared/components/data-state";
import { SortableTableHead } from "@/shared/components/sortable-table-head";
import { VirtualTableBody } from "@/shared/components/virtual-table-body";
import { formatDateTime } from "@/shared/lib/format";
import type { SortOrder } from "@/shared/lib/table-sort";

// 模型分组表格：表头排序、整页/整组选择、行内编辑与删除入口。

type ModelsTableProps = {
  list: ModelListController;
  selection: ModelSelectionController;
  onEdit: (model: ModelRouteDTO) => void;
  onDelete: (group: ModelRouteGroup) => void;
};

export function ModelsTable({ list, selection, onEdit, onDelete }: ModelsTableProps) {
  const { query, result } = list;
  return (
    <>
      {query.isError ? <ErrorState message={query.error.message} onRetry={() => void query.refetch()} /> : null}
      {!query.isPending && !query.isError && result?.items.length === 0 ? <EmptyState /> : null}
      {query.isPending || (result && result.items.length > 0) ? (
        <Table viewportRows={20} rowHeight={56} className="min-w-[1120px] table-fixed text-xs">
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
          <ModelTableHead list={list} selection={selection} />
          {query.isPending ? (
            <TableBody>
              <TableLoadingRow colSpan={9} />
            </TableBody>
          ) : (
            <VirtualTableBody
              items={result?.items ?? []}
              colSpan={9}
              rowHeight={56}
              renderRow={(model) => (
                <ModelTableRow
                  key={model.key}
                  model={model}
                  selected={selection.selected}
                  onToggleGroup={selection.toggleGroup}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              )}
            />
          )}
        </Table>
      ) : null}
    </>
  );
}

type ModelSortHeadProps = {
  field: string;
  label: string;
  list: ModelListController;
  align?: "left" | "center" | "right";
  initialOrder?: SortOrder;
};

function ModelSortHead({ field, label, list, align, initialOrder }: ModelSortHeadProps) {
  return (
    <SortableTableHead
      field={field}
      sortBy={list.sort.field}
      sortOrder={list.sort.order}
      align={align}
      initialOrder={initialOrder}
      onSort={list.changeSort}
    >
      {label}
    </SortableTableHead>
  );
}

function ModelTableHead({ list, selection }: { list: ModelListController; selection: ModelSelectionController }) {
  const { t } = useTranslation();
  const { allPageSelected, selectedOnPage } = pageSelectionState(list.pageIDs, selection.selected);
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        <TableHead className="px-2 text-center">
          <Checkbox
            checked={allPageSelected ? true : selectedOnPage.length > 0 ? "indeterminate" : false}
            onCheckedChange={(checked) => selection.togglePage(list.pageIDs, checked === true)}
            aria-label={t("common.selectPage")}
            data-testid="models-select-page"
          />
        </TableHead>
        <ModelSortHead field="publicId" label={t("models.model")} list={list} />
        <ModelSortHead field="upstreamModel" label={t("models.upstream")} list={list} />
        <TableHead className="text-center">{t("models.capability")}</TableHead>
        <ModelSortHead field="status" label={t("models.status")} list={list} align="center" />
        <ModelSortHead field="provider" label={t("models.provider")} list={list} align="center" />
        <ModelSortHead
          field="accountSupport"
          label={t("models.accountSupport")}
          list={list}
          align="center"
          initialOrder="desc"
        />
        <ModelSortHead field="lastSyncedAt" label={t("models.lastSyncedAt")} list={list} initialOrder="desc" />
        <TableActionHead />
      </TableRow>
    </TableHeader>
  );
}

type ModelTableRowProps = {
  model: ModelRouteGroup;
  selected: Set<string>;
  onToggleGroup: (routes: ModelRouteDTO[], checked: boolean) => void;
  onEdit: (model: ModelRouteDTO) => void;
  onDelete: (group: ModelRouteGroup) => void;
};

function ModelTableRow({ model, selected, onToggleGroup, onEdit, onDelete }: ModelTableRowProps) {
  const { t, i18n } = useTranslation();
  const selectedRoutes = model.routes.filter((route) => selected.has(route.id)).length;
  return (
    <TableRow
      className="group h-14"
      data-state={selectedRoutes > 0 ? "selected" : undefined}
      data-testid={`models-row-${model.key}`}
    >
      <TableCell className="px-2 text-center">
        <Checkbox
          checked={selectedRoutes === model.routes.length ? true : selectedRoutes > 0 ? "indeterminate" : false}
          onCheckedChange={(checked) => onToggleGroup(model.routes, checked === true)}
          aria-label={t("common.selectItem", { name: model.publicId })}
        />
      </TableCell>
      <TableCell className="min-w-0">
        <span className="block truncate text-xs font-medium" title={model.publicId}>
          {model.publicId}
        </span>
      </TableCell>
      <TableCell className="min-w-0">
        <span className="block truncate text-xs text-muted-foreground" title={model.upstreamModel}>
          {model.upstreamModel}
        </span>
      </TableCell>
      <TableCell className="text-center">
        <ModelCapabilities capabilities={model.capabilities} />
      </TableCell>
      <TableCell className="text-center">
        <ModelEnabledStateBadge state={model.enabledState} />
      </TableCell>
      <TableCell className="text-center">
        <ModelProvider provider={model.provider} />
      </TableCell>
      <TableCell className="text-center text-xs">
        <ModelAccountSupportCell model={model} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        {formatDateTime(model.lastSyncedAt, i18n.language)}
      </TableCell>
      <TableActionCell>
        <ModelRowActions model={model} onEdit={onEdit} onDelete={onDelete} />
      </TableActionCell>
    </TableRow>
  );
}

type ModelRowActionsProps = {
  model: ModelRouteGroup;
  onEdit: (model: ModelRouteDTO) => void;
  onDelete: (group: ModelRouteGroup) => void;
};

function ModelRowActions({ model, onEdit, onDelete }: ModelRowActionsProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={t("common.actions")}
          data-testid={`models-row-actions-${model.key}`}
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
              : t("models.editCapability", { capability: capabilityLabel(route.capability, t) })}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => onDelete(model)}
          data-testid={`models-row-delete-${model.key}`}
        >
          <Trash2 />
          {t("common.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
