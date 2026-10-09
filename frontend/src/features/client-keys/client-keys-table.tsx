import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ClientKeyDTO, ProviderScopeValue, TierScopeValue } from "@/features/client-keys/client-keys-api";
import { BillingUsage } from "@/features/client-keys/client-key-billing-usage";
import { ClientKeyStatus } from "@/features/client-keys/client-key-status";
import { providerScopeLabels, tierScopeLabels } from "@/features/client-keys/client-key-scope-summary";
import type { PaginatedDTO } from "@/shared/api/client";
import { EmptyState, ErrorState, TableLoadingRow } from "@/shared/components/data-state";
import { SortableTableHead } from "@/shared/components/sortable-table-head";
import { VirtualTableBody } from "@/shared/components/virtual-table-body";
import { formatDateTime } from "@/shared/lib/format";
import type { SortOrder, TableSort } from "@/shared/lib/table-sort";

const COLUMN_COUNT = 11;
const ROW_HEIGHT = 56;
const TABLE_CLASS = "min-w-[1200px] table-fixed text-xs";
const CELL_CLASS = "overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground";

type ClientKeysTableProps = {
  result: PaginatedDTO<ClientKeyDTO> | undefined;
  isPending: boolean;
  isError: boolean;
  errorMessage: string;
  onRetry: () => void;
  selected: Set<string>;
  onTogglePage: (checked: boolean) => void;
  onToggleKey: (id: string, checked: boolean) => void;
  sort: TableSort;
  onSort: (field: string, initialOrder: SortOrder) => void;
  referenceTime: number;
  copyPending: boolean;
  copyPendingId: string | undefined;
  onCopySecret: (id: string) => void;
  onEdit: (key: ClientKeyDTO) => void;
  onDelete: (key: ClientKeyDTO) => void;
};

/** 密钥列表：失败/空态与表格本体分离，便于分别断言用户可见结果。 */
export function ClientKeysTable(props: ClientKeysTableProps) {
  const { result, isPending, isError, errorMessage, onRetry } = props;
  return (
    <>
      {isError ? (
        <div data-testid="client-keys-error">
          <ErrorState message={errorMessage} onRetry={onRetry} />
        </div>
      ) : null}
      {result && result.items.length === 0 ? (
        <div data-testid="client-keys-empty">
          <EmptyState />
        </div>
      ) : null}
      {isPending || (result && result.items.length > 0) ? <ClientKeysTableView {...props} /> : null}
    </>
  );
}

function ClientKeysTableView({
  result,
  isPending,
  selected,
  sort,
  onSort,
  onTogglePage,
  referenceTime,
  copyPending,
  copyPendingId,
  onToggleKey,
  onCopySecret,
  onEdit,
  onDelete,
}: ClientKeysTableProps) {
  const pageIDs = result?.items.map((key) => key.id) ?? [];
  const selectedOnPage = pageIDs.filter((id) => selected.has(id));
  const allPageSelected = pageIDs.length > 0 && selectedOnPage.length === pageIDs.length;
  const rowProps = { referenceTime, copyPending, copyPendingId, onToggleKey, onCopySecret, onEdit, onDelete };
  const headerProps = { allPageSelected, selectedOnPage, sort, onSort, onTogglePage };
  return (
    <Table viewportRows={20} rowHeight={ROW_HEIGHT} className={TABLE_CLASS} data-testid="client-keys-table">
      <ClientKeysColumnGroup />
      <TableHeader>
        <ClientKeysHeaderRow {...headerProps} />
      </TableHeader>
      {isPending ? (
        <TableBody>
          <TableLoadingRow colSpan={COLUMN_COUNT} />
        </TableBody>
      ) : (
        <VirtualTableBody
          items={result?.items ?? []}
          colSpan={COLUMN_COUNT}
          rowHeight={ROW_HEIGHT}
          renderRow={(key) => <ClientKeyRow key={key.id} value={key} selected={selected.has(key.id)} {...rowProps} />}
        />
      )}
    </Table>
  );
}

function ClientKeysColumnGroup() {
  return (
    <colgroup>
      <col className="w-10" />
      <col className="w-36" />
      <col className="w-56" />
      <col className="w-20" />
      <col className="w-24" />
      <col className="w-18" />
      <col className="w-20" />
      <col className="w-40" />
      <col className="w-36" />
      <col className="w-36" />
      <col className="w-10" />
    </colgroup>
  );
}

type ClientKeysHeaderRowProps = {
  allPageSelected: boolean;
  selectedOnPage: string[];
  sort: TableSort;
  onSort: (field: string, initialOrder: SortOrder) => void;
  onTogglePage: (checked: boolean) => void;
};

function ClientKeysHeaderRow({
  allPageSelected,
  selectedOnPage,
  sort,
  onSort,
  onTogglePage,
}: ClientKeysHeaderRowProps) {
  const { t } = useTranslation();
  const sortable = { sort, onSort };
  return (
    <TableRow className="hover:bg-transparent">
      <TableHead>
        <Checkbox
          checked={allPageSelected ? true : selectedOnPage.length > 0 ? "indeterminate" : false}
          onCheckedChange={(checked) => onTogglePage(checked === true)}
          aria-label={t("common.selectPage")}
          data-testid="client-keys-select-page"
        />
      </TableHead>
      <ClientKeysSortableHeader field="name" label={t("keys.name")} {...sortable} />
      <ClientKeysSortableHeader field="prefix" label={t("keys.prefix")} {...sortable} />
      <ClientKeysSortableHeader field="status" label={t("keys.status")} align="center" {...sortable} />
      <TableHead className="text-center">{t("keys.accountScope")}</TableHead>
      <ClientKeysSortableHeader field="rpmLimit" label={t("keys.rpmShort")} align="center" {...sortable} />
      <ClientKeysSortableHeader field="maxConcurrent" label={t("keys.concurrencyShort")} align="center" {...sortable} />
      <ClientKeysSortableHeader field="billingLimit" label={t("keys.billingLimit")} initialOrder="desc" {...sortable} />
      <ClientKeysSortableHeader field="expiresAt" label={t("keys.expires")} initialOrder="desc" {...sortable} />
      <ClientKeysSortableHeader field="lastUsedAt" label={t("keys.lastUsed")} initialOrder="desc" {...sortable} />
      <TableActionHead />
    </TableRow>
  );
}

type ClientKeysSortableHeaderProps = {
  field: string;
  label: string;
  sort: TableSort;
  onSort: (field: string, initialOrder: SortOrder) => void;
  align?: "left" | "center" | "right";
  initialOrder?: SortOrder;
};

function ClientKeysSortableHeader({ field, label, sort, onSort, align, initialOrder }: ClientKeysSortableHeaderProps) {
  return (
    <SortableTableHead
      field={field}
      sortBy={sort.field}
      sortOrder={sort.order}
      align={align}
      initialOrder={initialOrder}
      onSort={onSort}
    >
      {label}
    </SortableTableHead>
  );
}

type ClientKeyRowProps = {
  value: ClientKeyDTO;
  selected: boolean;
  referenceTime: number;
  copyPending: boolean;
  copyPendingId: string | undefined;
  onToggleKey: (id: string, checked: boolean) => void;
  onCopySecret: (id: string) => void;
  onEdit: (key: ClientKeyDTO) => void;
  onDelete: (key: ClientKeyDTO) => void;
};

function ClientKeyRow({
  value,
  selected,
  referenceTime,
  copyPending,
  copyPendingId,
  onToggleKey,
  onCopySecret,
  onEdit,
  onDelete,
}: ClientKeyRowProps) {
  const { t, i18n } = useTranslation();
  const expiresAt = value.expiresAt ? formatDateTime(value.expiresAt, i18n.language) : t("keys.neverExpires");
  const lastUsedAt = formatDateTime(value.lastUsedAt, i18n.language);
  return (
    <TableRow
      className="group h-14"
      data-state={selected ? "selected" : undefined}
      data-testid={`client-keys-row-${value.id}`}
    >
      <ClientKeySelectCell value={value} selected={selected} onToggleKey={onToggleKey} />
      <ClientKeyNameCell value={value} />
      <ClientKeySecretCell
        value={value}
        copyPending={copyPending}
        isCopying={copyPending && copyPendingId === value.id}
        onCopySecret={onCopySecret}
      />
      <TableCell className="text-center">
        <ClientKeyStatus value={value} referenceTime={referenceTime} />
      </TableCell>
      <TableCell className="text-center">
        <AccountScopeSummary providerScope={value.providerScope ?? ["all"]} tierScope={value.tierScope ?? ["all"]} />
      </TableCell>
      <ClientKeyLimitCell value={value.rpmLimit} />
      <ClientKeyLimitCell value={value.maxConcurrent} />
      <TableCell>
        <BillingUsage value={value} />
      </TableCell>
      <TableCell className={CELL_CLASS} title={expiresAt}>
        {expiresAt}
      </TableCell>
      <TableCell className={CELL_CLASS} title={lastUsedAt}>
        {lastUsedAt}
      </TableCell>
      <ClientKeyActionsCell value={value} onEdit={onEdit} onDelete={onDelete} />
    </TableRow>
  );
}

function ClientKeySelectCell({
  value,
  selected,
  onToggleKey,
}: {
  value: ClientKeyDTO;
  selected: boolean;
  onToggleKey: (id: string, checked: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <TableCell>
      <Checkbox
        checked={selected}
        onCheckedChange={(checked) => onToggleKey(value.id, checked === true)}
        aria-label={t("common.selectItem", { name: value.name })}
        data-testid={`client-keys-select-${value.id}`}
      />
    </TableCell>
  );
}

function ClientKeyNameCell({ value }: { value: ClientKeyDTO }) {
  const { t } = useTranslation();
  const modelScope =
    value.allowedModelIds.length === 0
      ? t("keys.allModels")
      : t("keys.selectedModels", { count: value.allowedModelIds.length });
  return (
    <TableCell className="min-w-0">
      <span className="block truncate font-medium" title={value.name}>
        {value.name}
      </span>
      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
        {modelScope}
        {value.allowModelAliases ? ` · ${t("keys.modelAliases")}` : ""}
      </span>
    </TableCell>
  );
}

/** RPM / 并发上限单元格：0 表示不限。 */
function ClientKeyLimitCell({ value }: { value: number }) {
  const { t } = useTranslation();
  return <TableCell className="text-center text-xs tabular-nums">{value > 0 ? value : t("keys.unlimited")}</TableCell>;
}

function ClientKeySecretCell({
  value,
  copyPending,
  isCopying,
  onCopySecret,
}: {
  value: ClientKeyDTO;
  copyPending: boolean;
  isCopying: boolean;
  onCopySecret: (id: string) => void;
}) {
  const { t } = useTranslation();
  const masked = `g2a_${value.prefix}_********`;
  return (
    <TableCell className="overflow-hidden">
      <div className="flex w-full min-w-0 items-center gap-1">
        <code
          className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-1 text-xs text-muted-foreground"
          title={masked}
          data-testid={`client-keys-prefix-${value.id}`}
        >
          {masked}
        </code>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              disabled={copyPending}
              aria-label={t("keys.copySecret")}
              data-testid={`client-keys-copy-${value.id}`}
              onClick={() => onCopySecret(value.id)}
            >
              {isCopying ? <Spinner className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("keys.copySecret")}</TooltipContent>
        </Tooltip>
      </div>
    </TableCell>
  );
}

function ClientKeyActionsCell({
  value,
  onEdit,
  onDelete,
}: {
  value: ClientKeyDTO;
  onEdit: (key: ClientKeyDTO) => void;
  onDelete: (key: ClientKeyDTO) => void;
}) {
  const { t } = useTranslation();
  return (
    <TableActionCell>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t("common.actions")}
            data-testid={`client-keys-actions-${value.id}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEdit(value)} data-testid={`client-keys-edit-${value.id}`}>
            <Pencil />
            {t("common.edit")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => onDelete(value)}
            data-testid={`client-keys-delete-${value.id}`}
          >
            <Trash2 />
            {t("common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </TableActionCell>
  );
}

/** 渠道/订阅范围摘要单元格。 */
export function AccountScopeSummary({
  providerScope,
  tierScope,
}: {
  providerScope: ProviderScopeValue[];
  tierScope: TierScopeValue[];
}) {
  const { t } = useTranslation();
  const providerLabels = providerScopeLabels(t);
  const tierLabels = tierScopeLabels(t);
  return (
    <span className="inline-flex max-w-full flex-col items-start gap-0.5 text-left text-[10px] leading-4">
      <span className="max-w-full truncate text-foreground">
        {providerScope.map((value) => providerLabels[value]).join(" · ")}
      </span>
      <span className="max-w-full truncate text-muted-foreground">
        {tierScope.map((value) => tierLabels[value]).join(" · ")}
      </span>
    </span>
  );
}
