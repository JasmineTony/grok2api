import { Search } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import type { ModelAccountOptionDTO } from "@/entities/model/model-api";
import type { ModelRouteDTO } from "@/entities/model/types";
import type { ModelForm } from "@/features/models/model-form";
import { cn } from "@/shared/lib/cn";

type ModelEditorDialogProps = {
  editing: ModelRouteDTO | "new" | null;
  form: UseFormReturn<ModelForm>;
  selectedProvider: ModelForm["provider"];
  selectedCapability: ModelForm["capability"];
  modelEnabled: boolean;
  bindingMode: boolean;
  selectedAccountIDs: string[];
  accountSearch: string;
  accountOptionsPending: boolean;
  accountOptionsError: string | null;
  visibleAccountOptions: ModelAccountOptionDTO[];
  updatePending: boolean;
  onClose: () => void;
  onSubmit: (values: ModelForm) => void;
  onAccountSearchChange: (value: string) => void;
  onToggleBoundAccount: (id: string, checked: boolean) => void;
};

export function ModelEditorDialog({
  editing,
  form,
  selectedProvider,
  selectedCapability,
  modelEnabled,
  bindingMode,
  selectedAccountIDs,
  accountSearch,
  accountOptionsPending,
  accountOptionsError,
  visibleAccountOptions,
  updatePending,
  onClose,
  onSubmit,
  onAccountSearchChange,
  onToggleBoundAccount,
}: ModelEditorDialogProps) {
  const { t } = useTranslation();
  const updateMutation = { isPending: updatePending, mutate: onSubmit };
  const accountOptionsQuery = {
    isPending: accountOptionsPending,
    isError: accountOptionsError !== null,
    error: { message: accountOptionsError ?? "" },
  };
  const setAccountSearch = onAccountSearchChange;
  const toggleBoundAccount = onToggleBoundAccount;
  return (
    <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100svh-2rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 text-xs sm:max-w-[600px]">
        <DialogHeader className="shrink-0 px-5 py-4 pr-12">
          <DialogTitle>
            {t(editing === "new" ? "models.createTitle" : "models.editTitle")}
          </DialogTitle>
          <DialogDescription className="truncate">
            {editing === "new" ? t("models.createDescription") : editing?.upstreamModel}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          onSubmit={form.handleSubmit((values) => updateMutation.mutate(values))}
        >
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 pb-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="model-public-id">{t("models.publicId")}</Label>
              <Input id="model-public-id" {...form.register("publicId")} />
              {form.formState.errors.publicId ? (
                <p className="text-xs text-destructive">{form.formState.errors.publicId.message}</p>
              ) : null}
            </div>
            {editing === "new" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t("models.provider")}</Label>
                  <Select value={selectedProvider} disabled>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="grok_build">{t("models.providerGrokBuild")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("models.capability")}</Label>
                  <Select value={selectedCapability} disabled>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="responses">Responses</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="model-upstream-id">{t("models.upstream")}</Label>
                  <Input id="model-upstream-id" {...form.register("upstreamModel")} />
                  {form.formState.errors.upstreamModel ? (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.upstreamModel.message}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
            <section className="rounded-lg bg-muted/25 p-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="model-binding-mode">{t("models.bindAccounts")}</Label>
                    {bindingMode ? (
                      <Badge
                        variant="secondary"
                        className="text-[10px] font-normal tabular-nums"
                        aria-live="polite"
                      >
                        {t("models.selectedAccounts", { count: selectedAccountIDs.length })}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {t("models.bindAccountsDescription")}
                  </p>
                </div>
                <Switch
                  className="mt-0.5 shrink-0"
                  id="model-binding-mode"
                  checked={bindingMode}
                  onCheckedChange={(checked) => {
                    form.setValue("bindingMode", checked);
                    if (!checked) form.clearErrors("accountIds");
                  }}
                />
              </div>
              {bindingMode ? (
                <div className="mt-3">
                  <div className="overflow-hidden rounded-md bg-background/55 p-1">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className="bg-transparent pl-8 shadow-none focus-visible:bg-background/70"
                        value={accountSearch}
                        onChange={(event) => setAccountSearch(event.target.value)}
                        placeholder={t("models.searchAccounts")}
                      />
                    </div>
                    <div className="mt-1 max-h-40 overflow-y-auto overscroll-contain sm:max-h-44">
                      {accountOptionsQuery.isPending ? (
                        <div className="flex min-h-20 items-center justify-center">
                          <Spinner />
                        </div>
                      ) : null}
                      {accountOptionsQuery.isError ? (
                        <p className="p-3 text-center text-xs text-destructive">
                          {accountOptionsQuery.error.message}
                        </p>
                      ) : null}
                      {!accountOptionsQuery.isPending && visibleAccountOptions.length === 0 ? (
                        <p className="p-3 text-center text-xs text-muted-foreground">
                          {t("models.noBindableAccounts")}
                        </p>
                      ) : null}
                      {visibleAccountOptions.map((account) => {
                        const controlId = `model-account-${account.id}`;
                        const checked = selectedAccountIDs.includes(account.id);
                        return (
                          <label
                            key={account.id}
                            htmlFor={controlId}
                            className={cn(
                              "flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-xs transition-colors hover:bg-accent/40",
                              checked && "bg-accent/55",
                            )}
                          >
                            <Checkbox
                              id={controlId}
                              checked={checked}
                              onCheckedChange={(value) =>
                                toggleBoundAccount(account.id, value === true)
                              }
                            />
                            <span className="min-w-0 flex-1 truncate" title={account.name}>
                              {account.name}
                            </span>
                            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                              #{account.id}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  {form.formState.errors.accountIds ? (
                    <p className="mt-2 text-xs text-destructive">
                      {form.formState.errors.accountIds.message}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
            <section className="flex items-center justify-between gap-4 rounded-lg bg-muted/35 px-3 py-2.5">
              <div className="min-w-0">
                <Label htmlFor="model-enabled">
                  {modelEnabled ? t("common.enabled") : t("common.disabled")}
                </Label>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t("models.enabledDescription")}
                </p>
              </div>
              <Switch
                id="model-enabled"
                checked={modelEnabled}
                onCheckedChange={(checked) => form.setValue("enabled", checked)}
              />
            </section>
          </div>
          <DialogFooter className="shrink-0 gap-2 bg-muted/20 px-5 py-3.5 sm:gap-0">
            <Button type="button" variant="secondary" size="sm" onClick={() => onClose()}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? <Spinner /> : null}
              {editing === "new" ? t("common.create") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
