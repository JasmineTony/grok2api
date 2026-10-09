import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWatch } from "react-hook-form";

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { listModelAccountOptions, type ModelAccountOptionDTO } from "@/entities/model/model-api";
import type { ModelDialogsController } from "@/features/models/use-model-dialogs";
import type { ModelForm, ModelFormReturn } from "@/features/models/use-model-form";
import { cn } from "@/shared/lib/cn";

// 模型创建/编辑弹窗：对外仍是 models-page 的 <ModelEditDialog />，
// 内部按“身份字段 / 账号绑定 / 启用状态 / 页脚”拆成可独立阅读的小组件。

type ModelAccountOptions = UseQueryResult<{ items: ModelAccountOptionDTO[] }, Error>;

type ModelEditDialogProps = {
  dialogs: ModelDialogsController;
  save: { isPending: boolean; mutate: (values: ModelForm) => void };
};

export function ModelEditDialog({ dialogs, save }: ModelEditDialogProps) {
  const { t } = useTranslation();
  const { form, editing } = dialogs;
  const selectedProvider = useWatch({ control: form.control, name: "provider" });
  const accountOptions = useQuery({
    queryKey: ["models", "account-options", selectedProvider],
    queryFn: () => listModelAccountOptions(selectedProvider),
    enabled: editing !== null,
  });

  return (
    <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && dialogs.closeEditor()}>
      <DialogContent
        className="flex max-h-[calc(100svh-2rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 text-xs sm:max-w-[600px]"
        data-testid="models-edit-dialog"
      >
        <DialogHeader className="shrink-0 px-5 py-4 pr-12">
          <DialogTitle>{t(editing === "new" ? "models.createTitle" : "models.editTitle")}</DialogTitle>
          <DialogDescription className="truncate">
            {editing === "new" ? t("models.createDescription") : editing?.upstreamModel}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
        >
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 pb-4 pt-2">
            <ModelIdentityFields form={form} isCreating={editing === "new"} />
            <ModelBindingSection form={form} dialogs={dialogs} accountOptions={accountOptions} />
            <ModelEnabledSection form={form} />
          </div>
          <ModelDialogFooter isCreating={editing === "new"} isPending={save.isPending} onClose={dialogs.closeEditor} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ModelIdentityFields({ form, isCreating }: { form: ModelFormReturn; isCreating: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="model-public-id">{t("models.publicId")}</Label>
        <Input id="model-public-id" {...form.register("publicId")} />
        {form.formState.errors.publicId ? (
          <p className="text-xs text-destructive">{form.formState.errors.publicId.message}</p>
        ) : null}
      </div>
      {isCreating ? <ModelCreateOnlyFields form={form} /> : null}
    </>
  );
}

function ModelCreateOnlyFields({ form }: { form: ModelFormReturn }) {
  const { t } = useTranslation();
  const selectedProvider = useWatch({ control: form.control, name: "provider" });
  const selectedCapability = useWatch({ control: form.control, name: "capability" });
  return (
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
          <p className="text-xs text-destructive">{form.formState.errors.upstreamModel.message}</p>
        ) : null}
      </div>
    </div>
  );
}

type ModelBindingSectionProps = {
  form: ModelFormReturn;
  dialogs: ModelDialogsController;
  accountOptions: ModelAccountOptions;
};

function ModelBindingSection({ form, dialogs, accountOptions }: ModelBindingSectionProps) {
  const { t } = useTranslation();
  const bindingMode = useWatch({ control: form.control, name: "bindingMode" });
  const selectedAccountIDs = useWatch({ control: form.control, name: "accountIds" });
  return (
    <section className="rounded-lg bg-muted/25 p-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Label htmlFor="model-binding-mode">{t("models.bindAccounts")}</Label>
            {bindingMode ? (
              <Badge variant="secondary" className="text-[10px] font-normal tabular-nums" aria-live="polite">
                {t("models.selectedAccounts", { count: selectedAccountIDs.length })}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("models.bindAccountsDescription")}</p>
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
      {bindingMode ? <ModelAccountPicker form={form} dialogs={dialogs} accountOptions={accountOptions} /> : null}
    </section>
  );
}

function ModelAccountPicker({ form, dialogs, accountOptions }: ModelBindingSectionProps) {
  const selectedAccountIDs = useWatch({ control: form.control, name: "accountIds" });
  const accounts = accountOptions.data?.items ?? [];
  const normalizedSearch = dialogs.accountSearch.trim().toLocaleLowerCase();
  const visibleAccounts = normalizedSearch
    ? accounts.filter(
        (account) =>
          account.name.toLocaleLowerCase().includes(normalizedSearch) || account.id.includes(normalizedSearch),
      )
    : accounts;
  return (
    <div className="mt-3">
      <div className="overflow-hidden rounded-md bg-background/55 p-1">
        <ModelAccountSearch dialogs={dialogs} />
        <div className="mt-1 max-h-40 overflow-y-auto overscroll-contain sm:max-h-44">
          <ModelAccountListStatus accountOptions={accountOptions} isEmpty={visibleAccounts.length === 0} />
          <ModelAccountOptionList
            accounts={visibleAccounts}
            selectedAccountIDs={selectedAccountIDs}
            onToggle={dialogs.toggleBoundAccount}
          />
        </div>
      </div>
      {form.formState.errors.accountIds ? (
        <p className="mt-2 text-xs text-destructive">{form.formState.errors.accountIds.message}</p>
      ) : null}
    </div>
  );
}

function ModelAccountSearch({ dialogs }: { dialogs: ModelDialogsController }) {
  const { t } = useTranslation();
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="bg-transparent pl-8 shadow-none focus-visible:bg-background/70"
        value={dialogs.accountSearch}
        onChange={(event) => dialogs.setAccountSearch(event.target.value)}
        placeholder={t("models.searchAccounts")}
        data-testid="models-account-search"
      />
    </div>
  );
}

function ModelAccountListStatus({
  accountOptions,
  isEmpty,
}: {
  accountOptions: ModelAccountOptions;
  isEmpty: boolean;
}) {
  const { t } = useTranslation();
  if (accountOptions.isPending) {
    return (
      <div className="flex min-h-20 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (accountOptions.isError) {
    return <p className="p-3 text-center text-xs text-destructive">{accountOptions.error.message}</p>;
  }
  if (isEmpty) {
    return <p className="p-3 text-center text-xs text-muted-foreground">{t("models.noBindableAccounts")}</p>;
  }
  return null;
}

type ModelAccountOptionListProps = {
  accounts: ModelAccountOptionDTO[];
  selectedAccountIDs: string[];
  onToggle: (id: string, checked: boolean) => void;
};

function ModelAccountOptionList({ accounts, selectedAccountIDs, onToggle }: ModelAccountOptionListProps) {
  return (
    <>
      {accounts.map((account) => {
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
              onCheckedChange={(value) => onToggle(account.id, value === true)}
            />
            <span className="min-w-0 flex-1 truncate" title={account.name}>
              {account.name}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">#{account.id}</span>
          </label>
        );
      })}
    </>
  );
}

function ModelEnabledSection({ form }: { form: ModelFormReturn }) {
  const { t } = useTranslation();
  const modelEnabled = useWatch({ control: form.control, name: "enabled" });
  return (
    <section className="flex items-center justify-between gap-4 rounded-lg bg-muted/35 px-3 py-2.5">
      <div className="min-w-0">
        <Label htmlFor="model-enabled">{modelEnabled ? t("common.enabled") : t("common.disabled")}</Label>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("models.enabledDescription")}</p>
      </div>
      <Switch
        id="model-enabled"
        checked={modelEnabled}
        onCheckedChange={(checked) => form.setValue("enabled", checked)}
      />
    </section>
  );
}

type ModelDialogFooterProps = {
  isCreating: boolean;
  isPending: boolean;
  onClose: () => void;
};

function ModelDialogFooter({ isCreating, isPending, onClose }: ModelDialogFooterProps) {
  const { t } = useTranslation();
  return (
    <DialogFooter className="shrink-0 gap-2 bg-muted/20 px-5 py-3.5 sm:gap-0">
      <Button type="button" variant="secondary" size="sm" onClick={onClose}>
        {t("common.cancel")}
      </Button>
      <Button type="submit" size="sm" disabled={isPending} data-testid="models-submit">
        {isPending ? <Spinner /> : null}
        {isCreating ? t("common.create") : t("common.save")}
      </Button>
    </DialogFooter>
  );
}
