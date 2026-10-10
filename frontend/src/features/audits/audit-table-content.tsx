import { useTranslation } from "react-i18next";

import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AuditCursorPageDTO, AuditDTO } from "@/features/audits/request-audits-api";
import type { AuditListQueryState } from "@/features/audits/use-audit-list";
import { EmptyState, ErrorState, TableLoadingRow } from "@/shared/components/data-state";
import { SortableTableHead } from "@/shared/components/sortable-table-head";
import { VirtualTableBody } from "@/shared/components/virtual-table-body";
import { cn } from "@/shared/lib/cn";
import type { SortOrder, TableSort } from "@/shared/lib/table-sort";

const AUDIT_ROW_HEIGHT = 96;
const AUDIT_TABLE_VIEWPORT_ROWS = 20;
const AUDIT_TABLE_COLUMNS = 7;
const AUDIT_COLUMN_WIDTHS = ["w-36", "w-24", "w-24", "w-64", "w-24", "w-40", "w-40"];

type AuditColumn = {
  field: string;
  labelKey: string;
  initialOrder?: SortOrder;
  align?: "center";
  className?: string;
};

const AUDIT_COLUMNS: readonly AuditColumn[] = [
  { field: "model", labelKey: "audits.model" },
  { field: "egress", labelKey: "audits.egress", align: "center" },
  { field: "billing", labelKey: "audits.billing", initialOrder: "desc" },
  { field: "tokens", labelKey: "audits.tokens", initialOrder: "desc", className: "px-3" },
  { field: "status", labelKey: "audits.status", align: "center" },
  { field: "duration", labelKey: "audits.responsePerformance", initialOrder: "desc" },
  { field: "createdAt", labelKey: "audits.createdAt", initialOrder: "desc" },
];

const SORTABLE_FIELDS = new Set(["model", "billing", "tokens", "status", "duration", "createdAt"]);

function AuditTableHead({
  sort,
  onSort,
}: {
  sort: TableSort;
  onSort: (field: string, initialOrder: SortOrder) => void;
}) {
  const { t } = useTranslation();
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        {AUDIT_COLUMNS.map((column) =>
          SORTABLE_FIELDS.has(column.field) ? (
            <SortableTableHead
              key={column.field}
              field={column.field}
              sortBy={sort.field}
              sortOrder={sort.order}
              initialOrder={column.initialOrder}
              align={column.align}
              className={column.className}
              onSort={onSort}
            >
              {t(column.labelKey)}
            </SortableTableHead>
          ) : (
            <TableHead key={column.field} className={cn(column.align === "center" && "text-center")}>
              {t(column.labelKey)}
            </TableHead>
          ),
        )}
      </TableRow>
    </TableHeader>
  );
}

type AuditTableProps = {
  query: AuditListQueryState<AuditCursorPageDTO>;
  renderRow: (audit: AuditDTO) => React.ReactNode;
  sort: TableSort;
  onSort: (field: string, initialOrder: SortOrder) => void;
};

function AuditTable(props: AuditTableProps) {
  return (
    <Table
      viewportRows={AUDIT_TABLE_VIEWPORT_ROWS}
      rowHeight={AUDIT_ROW_HEIGHT}
      aria-busy={props.query.isFetching}
      className={cn(
        "min-w-[1008px] table-fixed text-xs transition-opacity",
        props.query.isPlaceholderData && "pointer-events-none opacity-60",
      )}
    >
      <colgroup>
        {AUDIT_COLUMN_WIDTHS.map((width) => (
          <col key={width} className={width} />
        ))}
      </colgroup>
      <AuditTableHead sort={props.sort} onSort={props.onSort} />
      {props.query.isPending ? (
        <TableBody>
          <TableLoadingRow colSpan={AUDIT_TABLE_COLUMNS} />
        </TableBody>
      ) : (
        <VirtualTableBody
          items={props.query.data?.items ?? []}
          colSpan={AUDIT_TABLE_COLUMNS}
          rowHeight={AUDIT_ROW_HEIGHT}
          overscan={6}
          renderRow={props.renderRow}
        />
      )}
    </Table>
  );
}

export function AuditTableContent(props: AuditTableProps) {
  const result = props.query.data;
  const showTable = props.query.isPending || Boolean(result && result.items.length > 0);
  return (
    <>
      {props.query.isError ? (
        <ErrorState message={props.query.error?.message ?? ""} onRetry={() => void props.query.refetch()} />
      ) : null}
      {result && result.items.length === 0 ? <EmptyState /> : null}
      {showTable ? <AuditTable {...props} /> : null}
    </>
  );
}
