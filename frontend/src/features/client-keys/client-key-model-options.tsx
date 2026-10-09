import type { UseQueryResult } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { ModelRouteDTO } from "@/entities/model/types";
import type { ClientKeyFormValues } from "@/features/client-keys/client-key-form-schema";
import type { PaginatedDTO } from "@/shared/api/client";
import { LoadingState } from "@/shared/components/data-state";
import { cn } from "@/shared/lib/cn";

type ModelQuery = UseQueryResult<PaginatedDTO<ModelRouteDTO>, Error>;

type ModelOptionsPanelProps = {
  form: UseFormReturn<ClientKeyFormValues>;
  query: ModelQuery;
  search: string;
  onSearchChange: (value: string) => void;
  onPageChange: (page: number) => void;
};

/** 受限模型范围下的模型多选列表（含搜索与分页）。 */
export function ModelOptionsPanel({ form, query, search, onSearchChange, onPageChange }: ModelOptionsPanelProps) {
  const selected = useWatch({ control: form.control, name: "allowedModelIds" });

  function toggleModel(id: string): void {
    const current = form.getValues("allowedModelIds");
    form.setValue(
      "allowedModelIds",
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
      { shouldDirty: true, shouldValidate: true },
    );
  }

  const error = form.formState.errors.allowedModelIds?.message;
  return (
    <div className="min-w-0 border-t p-3" data-testid="client-keys-model-options">
      <div className="min-w-0 overflow-hidden rounded-md bg-muted/25 p-1">
        <ModelOptionsSearch value={search} onChange={onSearchChange} />
        <div className="mt-1 max-h-40 overflow-y-auto overscroll-contain sm:max-h-44">
          <ModelOptionsList query={query} selected={selected} onToggle={toggleModel} />
        </div>
        {query.data && query.data.total > query.data.pageSize ? (
          <ModelOptionPagination
            page={query.data.page}
            pageSize={query.data.pageSize}
            total={query.data.total}
            onPageChange={onPageChange}
          />
        ) : null}
      </div>
      {error ? (
        <p className="mt-1.5 text-xs text-destructive" data-testid="client-keys-form-models-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ModelOptionsSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="bg-transparent pl-8 shadow-none focus-visible:bg-background/70"
        data-testid="client-keys-model-search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("keys.modelSearch")}
        aria-label={t("keys.modelSearch")}
      />
    </div>
  );
}

function ModelOptionsList({
  query,
  selected,
  onToggle,
}: {
  query: ModelQuery;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (query.isPending) return <LoadingState className="min-h-20" />;
  return (
    <>
      {query.data?.items.map((model) => (
        <ModelOptionRow
          key={model.id}
          model={model}
          checked={selected.includes(model.id)}
          onToggle={() => onToggle(model.id)}
        />
      ))}
      {query.data?.items.length === 0 ? (
        <p className="p-3 text-center text-xs text-muted-foreground">{t("common.noData")}</p>
      ) : null}
    </>
  );
}

function ModelOptionRow({
  model,
  checked,
  onToggle,
}: {
  model: ModelRouteDTO;
  checked: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const controlId = `allowed-model-${model.id}`;
  return (
    <label
      htmlFor={controlId}
      data-testid={`client-keys-model-option-${model.id}`}
      className={cn(
        "flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-xs transition-colors hover:bg-accent/40",
        checked && "bg-accent/55",
      )}
    >
      <Checkbox
        id={controlId}
        checked={checked}
        onCheckedChange={onToggle}
        aria-label={t("common.selectItem", { name: model.publicId })}
      />
      <span className="min-w-0 flex-1 truncate" title={model.publicId}>
        {model.publicId}
      </span>
      <span
        className="hidden max-w-[42%] shrink-0 truncate text-[11px] text-muted-foreground sm:block"
        title={model.upstreamModel}
      >
        {model.upstreamModel}
      </span>
      {!model.enabled ? (
        <Badge variant="secondary" className="shrink-0 text-[10px] font-normal text-muted-foreground">
          {t("common.disabled")}
        </Badge>
      ) : null}
    </label>
  );
}

function ModelOptionPagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex h-9 items-center justify-between border-t bg-muted/20 px-2">
      <span className="px-1 text-xs text-muted-foreground">{t("common.pageOf", { page, pages })}</span>
      <div className="flex items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label={t("common.previousPage")}
        >
          <ChevronLeft />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
          aria-label={t("common.nextPage")}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
