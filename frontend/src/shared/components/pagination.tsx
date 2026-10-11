import { ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/shared/lib/cn";

const PAGE_SIZE_OPTIONS = [20, 100, 500, 1000, 2000] as const;

type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  className?: string;
};

type CursorPaginationProps = {
  page: number;
  pageSize: number;
  hasMore: boolean;
  disabled?: boolean;
  onFirstPage: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onPageSizeChange: (pageSize: number) => void;
  className?: string;
};

type PaginationNavButtonProps = {
  label: string;
  disabled: boolean;
  onClick: () => void;
  icon: ReactNode;
};

/** 分页导航按钮：图标 + aria-label，禁用态由调用方按边界判定。 */
function PaginationNavButton({ label, disabled, onClick, icon }: PaginationNavButtonProps) {
  return (
    <Button variant="ghost" size="icon" className="size-8" disabled={disabled} onClick={onClick} aria-label={label}>
      {icon}
    </Button>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  className,
}: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className={cn("flex w-full flex-wrap items-center justify-between gap-3", className)}>
      <PageNumberNav page={page} pages={pages} onPageChange={onPageChange} />
      {onPageSizeChange ? (
        <PageSizeSelector pageSize={pageSize} options={pageSizeOptions} onChange={onPageSizeChange} />
      ) : (
        <span />
      )}
    </div>
  );
}

type PageNumberNavProps = {
  page: number;
  pages: number;
  onPageChange: (page: number) => void;
};

/** 首页/上一页/页码/下一页/末页导航；边界按钮由当前页决定禁用。 */
function PageNumberNav({ page, pages, onPageChange }: PageNumberNavProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1">
      <PaginationNavButton
        label={t("common.firstPage")}
        disabled={page <= 1}
        onClick={() => onPageChange(1)}
        icon={<ChevronsLeft />}
      />
      <PaginationNavButton
        label={t("common.previousPage")}
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        icon={<ChevronLeft />}
      />
      <span className="min-w-20 px-2 text-center text-xs text-muted-foreground">
        {t("common.pageOf", { page, pages })}
      </span>
      <PaginationNavButton
        label={t("common.nextPage")}
        disabled={page >= pages}
        onClick={() => onPageChange(page + 1)}
        icon={<ChevronRight />}
      />
      <PaginationNavButton
        label={t("common.lastPage")}
        disabled={page >= pages}
        onClick={() => onPageChange(pages)}
        icon={<ChevronsRight />}
      />
    </div>
  );
}

export function CursorPagination({
  page,
  pageSize,
  hasMore,
  disabled = false,
  onFirstPage,
  onPreviousPage,
  onNextPage,
  onPageSizeChange,
  className,
}: CursorPaginationProps) {
  const { t } = useTranslation();

  return (
    <div className={cn("flex w-full flex-wrap items-center justify-between gap-3", className)}>
      <div className="flex items-center gap-1">
        <PaginationNavButton
          label={t("common.firstPage")}
          disabled={disabled || page <= 1}
          onClick={onFirstPage}
          icon={<ChevronsLeft />}
        />
        <PaginationNavButton
          label={t("common.previousPage")}
          disabled={disabled || page <= 1}
          onClick={onPreviousPage}
          icon={<ChevronLeft />}
        />
        <span className="min-w-20 px-2 text-center text-xs text-muted-foreground">
          {t("audits.cursorPage", { page })}
        </span>
        <PaginationNavButton
          label={t("common.nextPage")}
          disabled={disabled || !hasMore}
          onClick={onNextPage}
          icon={<ChevronRight />}
        />
      </div>
      <PageSizeSelector
        pageSize={pageSize}
        disabled={disabled}
        options={PAGE_SIZE_OPTIONS}
        onChange={onPageSizeChange}
      />
    </div>
  );
}

function PageSizeSelector({
  pageSize,
  disabled = false,
  options,
  onChange,
}: {
  pageSize: number;
  disabled?: boolean;
  options: readonly number[];
  onChange: (pageSize: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>{t("common.perPage")}</span>
      <Select value={String(pageSize)} disabled={disabled} onValueChange={(value) => onChange(Number(value))}>
        <SelectTrigger
          className="h-8 w-[76px] rounded-md bg-secondary px-3 text-xs shadow-none"
          aria-label={t("common.perPage")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {options.map((value) => (
            <SelectItem key={value} value={String(value)}>
              {value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span>{t("common.rows")}</span>
    </div>
  );
}
