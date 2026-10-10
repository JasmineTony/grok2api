import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { buildAuditFilters } from "@/features/audits/audit-filter-definitions";
import type { AuditFilterOptions } from "@/features/audits/use-audit-filter-options";
import { DataTableFilters } from "@/shared/components/data-table-filters";

export type AuditFiltersToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  modelFilter: string;
  onModelFilterChange: (value: string) => void;
  modelOptions: Array<{ value: string; label: string }>;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  modeFilter: string;
  onModeFilterChange: (value: string) => void;
  keyFilter: string;
  onKeyFilterChange: (value: string) => void;
  accountFilter: string;
  onAccountFilterChange: (value: string) => void;
  filterOptions: AuditFilterOptions;
};

export function AuditFiltersToolbar(props: AuditFiltersToolbarProps) {
  const { t } = useTranslation();
  const filters = buildAuditFilters({
    t,
    model: { value: props.modelFilter, onChange: props.onModelFilterChange, options: props.modelOptions },
    status: { value: props.statusFilter, onChange: props.onStatusFilterChange },
    mode: { value: props.modeFilter, onChange: props.onModeFilterChange },
    key: { value: props.keyFilter, onChange: props.onKeyFilterChange, group: props.filterOptions.keyGroup },
    account: {
      value: props.accountFilter,
      onChange: props.onAccountFilterChange,
      group: props.filterOptions.accountGroup,
    },
  });
  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-8 pl-9 text-xs"
          value={props.search}
          onChange={(event) => props.onSearchChange(event.target.value)}
          placeholder={t("audits.search")}
          aria-label={t("audits.search")}
        />
      </div>
      <DataTableFilters filters={filters} />
    </div>
  );
}
