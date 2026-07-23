import { CircleHelp, Copy, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Controller } from "react-hook-form";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
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
import {
  BillingUsage,
  ClientKeyStatus,
  ModelOptionPagination,
} from "@/features/client-keys/client-key-components";
import { ClientKeyDialogs } from "@/features/client-keys/client-key-dialogs";
import type { ClientKeysPageController } from "@/features/client-keys/use-client-keys-page-controller";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  TableLoadingRow,
} from "@/shared/components/data-state";
import { DataTableFilters } from "@/shared/components/data-table-filters";
import { DataTableShell } from "@/shared/components/data-table-shell";
import { DateTimePicker } from "@/shared/components/date-time-picker";
import { Pagination } from "@/shared/components/pagination";
import { SortableTableHead } from "@/shared/components/sortable-table-head";
import { VirtualTableBody } from "@/shared/components/virtual-table-body";
import { cn } from "@/shared/lib/cn";
import { formatDateTime } from "@/shared/lib/format";

export function ClientKeysView({ controller }: { controller: ClientKeysPageController }) {
  const {
    t,
    i18n,
    setPage,
    setPageSize,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    modelScopeFilter,
    setModelScopeFilter,
    sort,
    selected,
    setBatchDeleteOpen,
    editing,
    setEditing,
    setDeleting,
    setModelOptionsPage,
    modelOptionsSearch,
    setModelOptionsSearch,
    statusReferenceTime,
    form,
    keyEnabled,
    selectedModels,
    expiryUnlimited,
    rpmUnlimited,
    concurrencyUnlimited,
    billingUnlimited,
    keysQuery,
    modelsQuery,
    saveMutation,
    copyMutation,
    batchUpdateMutation,
    beginCreate,
    beginEdit,
    toggleModel,
    result,
    selectedOnPage,
    allPageSelected,
    togglePage,
    toggleKey,
    changeSort,
  } = controller;
  return (
    <div className="space-y-5">
      <header className="flex min-h-8 items-center">
        <h1 className="text-xl font-medium">{t("keys.title")}</h1>
        <p className="sr-only">{t("keys.description")}</p>
      </header>

      <DataTableShell
        toolbar={
          <>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 pl-9 text-xs"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder={t("keys.search")}
                  aria-label={t("keys.search")}
                />
              </div>
              <DataTableFilters
                filters={[
                  {
                    id: "status",
                    label: t("keys.status"),
                    value: statusFilter,
                    onChange: (value) => {
                      setStatusFilter(value);
                      setPage(1);
                    },
                    options: [
                      { value: "active", label: t("keys.statusActive") },
                      { value: "disabled", label: t("common.disabled") },
                      { value: "expired", label: t("keys.statusExpired") },
                    ],
                  },
                  {
                    id: "modelScope",
                    label: t("keys.models"),
                    value: modelScopeFilter,
                    onChange: (value) => {
                      setModelScopeFilter(value);
                      setPage(1);
                    },
                    options: [
                      { value: "all", label: t("keys.allModels") },
                      { value: "restricted", label: t("keys.restrictedModels") },
                    ],
                  },
                ]}
              />
            </div>
            {selected.size > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-muted-foreground">
                  {t("common.selectedCount", { count: selected.size })}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => batchUpdateMutation.mutate(true)}
                >
                  {t("common.enable")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => batchUpdateMutation.mutate(false)}
                >
                  {t("common.disable")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setBatchDeleteOpen(true)}
                >
                  {t("common.delete")}
                </Button>
              </div>
            ) : (
              <Button size="sm" onClick={beginCreate}>
                <Plus />
                {t("keys.create")}
              </Button>
            )}
          </>
        }
        footer={
          result && result.total > 0 ? (
            <Pagination
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
              onPageChange={setPage}
              onPageSizeChange={(value) => {
                setPageSize(value);
                setPage(1);
              }}
            />
          ) : undefined
        }
      >
        {keysQuery.isError ? (
          <ErrorState message={keysQuery.error.message} onRetry={() => void keysQuery.refetch()} />
        ) : null}
        {result && result.items.length === 0 ? <EmptyState /> : null}
        {keysQuery.isPending || (result && result.items.length > 0) ? (
          <Table viewportRows={20} rowHeight={56} className="min-w-[1120px] table-fixed text-xs">
            <colgroup>
              <col className="w-10" />
              <col className="w-36" />
              <col className="w-56" />
              <col className="w-20" />
              <col className="w-18" />
              <col className="w-20" />
              <col className="w-40" />
              <col className="w-36" />
              <col className="w-36" />
              <col className="w-10" />
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>
                  <Checkbox
                    checked={
                      allPageSelected ? true : selectedOnPage.length > 0 ? "indeterminate" : false
                    }
                    onCheckedChange={(checked) => togglePage(checked === true)}
                    aria-label={t("common.selectPage")}
                  />
                </TableHead>
                <SortableTableHead
                  field="name"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  onSort={changeSort}
                >
                  {t("keys.name")}
                </SortableTableHead>
                <SortableTableHead
                  field="prefix"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  onSort={changeSort}
                >
                  {t("keys.prefix")}
                </SortableTableHead>
                <SortableTableHead
                  field="status"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  align="center"
                  onSort={changeSort}
                >
                  {t("keys.status")}
                </SortableTableHead>
                <SortableTableHead
                  field="rpmLimit"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  align="center"
                  onSort={changeSort}
                >
                  {t("keys.rpmShort")}
                </SortableTableHead>
                <SortableTableHead
                  field="maxConcurrent"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  align="center"
                  onSort={changeSort}
                >
                  {t("keys.concurrencyShort")}
                </SortableTableHead>
                <SortableTableHead
                  field="billingLimit"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  initialOrder="desc"
                  onSort={changeSort}
                >
                  {t("keys.billingLimit")}
                </SortableTableHead>
                <SortableTableHead
                  field="expiresAt"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  initialOrder="desc"
                  onSort={changeSort}
                >
                  {t("keys.expires")}
                </SortableTableHead>
                <SortableTableHead
                  field="lastUsedAt"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  initialOrder="desc"
                  onSort={changeSort}
                >
                  {t("keys.lastUsed")}
                </SortableTableHead>
                <TableActionHead />
              </TableRow>
            </TableHeader>
            {keysQuery.isPending ? (
              <TableBody>
                <TableLoadingRow colSpan={10} />
              </TableBody>
            ) : (
              <VirtualTableBody
                items={result?.items ?? []}
                colSpan={10}
                rowHeight={56}
                renderRow={(key) => (
                  <TableRow
                    className="group h-14"
                    key={key.id}
                    data-state={selected.has(key.id) ? "selected" : undefined}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selected.has(key.id)}
                        onCheckedChange={(checked) => toggleKey(key.id, checked === true)}
                        aria-label={t("common.selectItem", { name: key.name })}
                      />
                    </TableCell>
                    <TableCell className="min-w-0">
                      <span className="block truncate font-medium" title={key.name}>
                        {key.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                        {key.allowedModelIds.length === 0
                          ? t("keys.allModels")
                          : t("keys.selectedModels", { count: key.allowedModelIds.length })}
                      </span>
                    </TableCell>
                    <TableCell className="overflow-hidden">
                      <div className="flex w-full min-w-0 items-center gap-1">
                        <code
                          className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-1 text-xs text-muted-foreground"
                          title={`g2a_${key.prefix}_********`}
                        >
                          g2a_{key.prefix}_********
                        </code>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7 shrink-0"
                              disabled={copyMutation.isPending}
                              aria-label={t("keys.copySecret")}
                              onClick={() => copyMutation.mutate(key.id)}
                            >
                              {copyMutation.isPending && copyMutation.variables === key.id ? (
                                <Spinner className="size-3.5" />
                              ) : (
                                <Copy className="size-3.5" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t("keys.copySecret")}</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <ClientKeyStatus value={key} referenceTime={statusReferenceTime} />
                    </TableCell>
                    <TableCell className="text-center text-xs tabular-nums">
                      {key.rpmLimit > 0 ? key.rpmLimit : t("keys.unlimited")}
                    </TableCell>
                    <TableCell className="text-center text-xs tabular-nums">
                      {key.maxConcurrent > 0 ? key.maxConcurrent : t("keys.unlimited")}
                    </TableCell>
                    <TableCell>
                      <BillingUsage value={key} />
                    </TableCell>
                    <TableCell
                      className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground"
                      title={
                        key.expiresAt
                          ? formatDateTime(key.expiresAt, i18n.language)
                          : t("keys.neverExpires")
                      }
                    >
                      {key.expiresAt
                        ? formatDateTime(key.expiresAt, i18n.language)
                        : t("keys.neverExpires")}
                    </TableCell>
                    <TableCell
                      className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground"
                      title={formatDateTime(key.lastUsedAt, i18n.language)}
                    >
                      {formatDateTime(key.lastUsedAt, i18n.language)}
                    </TableCell>
                    <TableActionCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={t("common.actions")}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => beginEdit(key)}>
                            <Pencil />
                            {t("common.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleting(key)}
                          >
                            <Trash2 />
                            {t("common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableActionCell>
                  </TableRow>
                )}
              />
            )}
          </Table>
        ) : null}
      </DataTableShell>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="flex max-h-[calc(100svh-2rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 text-xs sm:max-w-[560px]">
          <DialogHeader className="shrink-0 px-5 py-4 pr-12">
            <DialogTitle>
              {editing === "new" ? t("keys.createTitle") : t("keys.editTitle")}
            </DialogTitle>
            <DialogDescription>
              {editing === "new" ? t("keys.description") : editing?.prefix}
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
          >
            <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 pb-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="key-name">{t("keys.name")}</Label>
                <Input id="key-name" {...form.register("name")} />
                {form.formState.errors.name ? (
                  <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="key-rpm">{t("keys.rpm")}</Label>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{t("keys.unlimited")}</span>
                      <Switch
                        id="key-rpm-unlimited"
                        checked={rpmUnlimited}
                        onCheckedChange={(checked) =>
                          form.setValue("rpmUnlimited", checked, { shouldDirty: true })
                        }
                      />
                    </div>
                  </div>
                  <Input
                    id="key-rpm"
                    type="number"
                    min="1"
                    max="100000"
                    disabled={rpmUnlimited}
                    {...form.register("rpmLimit", { valueAsNumber: true })}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="key-concurrency">{t("keys.maxConcurrent")}</Label>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{t("keys.unlimited")}</span>
                      <Switch
                        id="key-concurrency-unlimited"
                        checked={concurrencyUnlimited}
                        onCheckedChange={(checked) =>
                          form.setValue("concurrencyUnlimited", checked, { shouldDirty: true })
                        }
                      />
                    </div>
                  </div>
                  <Input
                    id="key-concurrency"
                    type="number"
                    min="1"
                    max="1024"
                    disabled={concurrencyUnlimited}
                    {...form.register("maxConcurrent", { valueAsNumber: true })}
                  />
                </div>
              </div>
              <div className="grid items-start gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex h-5 items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Label htmlFor="key-billing-unlimited">{t("keys.billingLimit")}</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="text-muted-foreground transition-colors hover:text-foreground"
                            aria-label={t("keys.billingLimitDescription")}
                          >
                            <CircleHelp className="size-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-72">
                          {t("keys.billingLimitDescription")}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{t("keys.unlimited")}</span>
                      <Switch
                        id="key-billing-unlimited"
                        checked={billingUnlimited}
                        onCheckedChange={(checked) =>
                          form.setValue("billingUnlimited", checked, { shouldDirty: true })
                        }
                      />
                    </div>
                  </div>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      $
                    </span>
                    <Input
                      className="pl-7"
                      type="number"
                      min="0.01"
                      step="0.01"
                      disabled={billingUnlimited}
                      {...form.register("billingLimitUsd", { valueAsNumber: true })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex h-5 items-center justify-between gap-3">
                    <Label htmlFor="key-expiry-unlimited">{t("keys.expires")}</Label>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{t("keys.unlimited")}</span>
                      <Switch
                        id="key-expiry-unlimited"
                        checked={expiryUnlimited}
                        onCheckedChange={(checked) => {
                          form.setValue("expiryUnlimited", checked, { shouldDirty: true });
                          if (checked) form.clearErrors("expiresAt");
                        }}
                      />
                    </div>
                  </div>
                  <Controller
                    control={form.control}
                    name="expiresAt"
                    render={({ field }) => (
                      <DateTimePicker
                        value={expiryUnlimited ? "" : field.value}
                        onChange={field.onChange}
                        disabled={expiryUnlimited}
                        placeholder={
                          expiryUnlimited ? t("keys.neverExpires") : t("keys.selectExpiry")
                        }
                      />
                    )}
                  />
                  {form.formState.errors.expiresAt ? (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.expiresAt.message}
                    </p>
                  ) : null}
                </div>
              </div>
              <fieldset className="min-w-0 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <legend className="text-xs font-medium">{t("keys.models")}</legend>
                  <Badge
                    variant="secondary"
                    className="min-w-0 max-w-[55%] truncate text-[10px] font-normal"
                  >
                    {selectedModels.length === 0
                      ? t("keys.allModels")
                      : t("keys.selectedModels", { count: selectedModels.length })}
                  </Badge>
                </div>
                <div className="min-w-0 overflow-hidden rounded-md bg-muted/25 p-1">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="bg-transparent pl-8 shadow-none"
                      value={modelOptionsSearch}
                      onChange={(event) => {
                        setModelOptionsSearch(event.target.value);
                        setModelOptionsPage(1);
                      }}
                      placeholder={t("keys.modelSearch")}
                      aria-label={t("keys.modelSearch")}
                    />
                  </div>
                  <div className="mt-1 max-h-40 overflow-y-auto overscroll-contain sm:max-h-44">
                    {modelsQuery.isPending ? (
                      <LoadingState className="min-h-20" />
                    ) : (
                      modelsQuery.data?.items.map((model) => {
                        const checked = selectedModels.includes(model.id);
                        const controlId = `allowed-model-${model.id}`;
                        return (
                          <label
                            key={model.id}
                            htmlFor={controlId}
                            className={cn(
                              "flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-xs transition-colors hover:bg-accent/55",
                              checked && "bg-accent",
                            )}
                          >
                            <Checkbox
                              id={controlId}
                              checked={checked}
                              onCheckedChange={() => toggleModel(model.id)}
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
                              <Badge
                                variant="secondary"
                                className="shrink-0 text-[10px] font-normal text-muted-foreground"
                              >
                                {t("common.disabled")}
                              </Badge>
                            ) : null}
                          </label>
                        );
                      })
                    )}
                    {modelsQuery.data?.items.length === 0 ? (
                      <p className="p-3 text-center text-xs text-muted-foreground">
                        {t("common.noData")}
                      </p>
                    ) : null}
                  </div>
                  {modelsQuery.data && modelsQuery.data.total > modelsQuery.data.pageSize ? (
                    <ModelOptionPagination
                      page={modelsQuery.data.page}
                      pageSize={modelsQuery.data.pageSize}
                      total={modelsQuery.data.total}
                      onPageChange={setModelOptionsPage}
                    />
                  ) : null}
                </div>
              </fieldset>
              <section className="flex items-center justify-between gap-4 rounded-lg bg-muted/25 px-3 py-2.5">
                <div className="min-w-0">
                  <Label htmlFor="key-enabled">
                    {keyEnabled ? t("common.enabled") : t("common.disabled")}
                  </Label>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {t("keys.enabledDescription")}
                  </p>
                </div>
                <Switch
                  className="shrink-0"
                  id="key-enabled"
                  checked={keyEnabled}
                  onCheckedChange={(checked) => form.setValue("enabled", checked)}
                />
              </section>
            </div>
            <DialogFooter className="shrink-0 gap-2 bg-muted/20 px-5 py-3 sm:gap-0">
              <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? <Spinner /> : null}
                {editing === "new" ? t("common.create") : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ClientKeyDialogs controller={controller} />
    </div>
  );
}
