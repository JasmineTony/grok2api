import { TriangleAlert } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { type AccountForm } from "@/features/accounts/account-edit-form";

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
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { AccountDTO, BuildRouteMode } from "@/features/accounts/accounts-dto";

type AccountEditDialogProps = {
  editing: AccountDTO | null;
  form: UseFormReturn<AccountForm>;
  pending: boolean;
  accountEnabled: boolean;
  clearCloudflareCookies: boolean;
  buildSuperEntitled: boolean;
  buildRouteMode: BuildRouteMode;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

/** 账号编辑弹窗：基础字段 + Build 权益/路由 + Cloudflare Cookie。 */
export function AccountEditDialog({
  editing,
  form,
  pending,
  accountEnabled,
  clearCloudflareCookies,
  buildSuperEntitled,
  buildRouteMode,
  onClose,
  onSubmit,
}: AccountEditDialogProps): ReactNode {
  const { t } = useTranslation();
  return (
    <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("common.edit")} {editing?.name}
          </DialogTitle>
          <DialogDescription>{editing?.email ?? editing?.userId}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <AccountBasicFields form={form} accountEnabled={accountEnabled} />
          {editing?.provider === "grok_build" ? (
            <BuildEntitlementFields
              form={form}
              editing={editing}
              buildSuperEntitled={buildSuperEntitled}
              buildRouteMode={buildRouteMode}
            />
          ) : null}
          {editing && editing.provider !== "grok_build" ? (
            <CloudflareCookieField form={form} editing={editing} clearCloudflareCookies={clearCloudflareCookies} />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? <Spinner /> : null}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AccountBasicFields({
  form,
  accountEnabled,
}: {
  form: UseFormReturn<AccountForm>;
  accountEnabled: boolean;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="account-name">{t("accounts.name")}</Label>
        <Input id="account-name" {...form.register("name")} />
        {form.formState.errors.name ? (
          <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
        ) : null}
      </div>
      <AccountEnabledField form={form} accountEnabled={accountEnabled} />
      <AccountLimitFields form={form} />
      <AccountMinimumField form={form} />
    </>
  );
}

function BuildEntitlementFields({
  form,
  editing,
  buildSuperEntitled,
  buildRouteMode,
}: {
  form: UseFormReturn<AccountForm>;
  editing: AccountDTO;
  buildSuperEntitled: boolean;
  buildRouteMode: BuildRouteMode;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 rounded-md bg-muted/50 p-3">
        <div className="space-y-1">
          <Label htmlFor="account-build-super-entitled">{t("accounts.buildSuperEntitled.label")}</Label>
          <p className="text-xs text-muted-foreground">{t("accounts.buildSuperEntitled.description")}</p>
        </div>
        <Switch
          id="account-build-super-entitled"
          checked={buildSuperEntitled}
          onCheckedChange={(checked) => form.setValue("buildSuperEntitled", checked, { shouldDirty: true })}
        />
      </div>
      <BuildRouteModeField
        form={form}
        editing={editing}
        buildSuperEntitled={buildSuperEntitled}
        buildRouteMode={buildRouteMode}
      />
    </div>
  );
}

function BuildRouteModeField({
  form,
  editing,
  buildSuperEntitled,
  buildRouteMode,
}: {
  form: UseFormReturn<AccountForm>;
  editing: AccountDTO;
  buildSuperEntitled: boolean;
  buildRouteMode: BuildRouteMode;
}): ReactNode {
  const { t } = useTranslation();
  const showXaiWarning =
    buildRouteMode === "xai" &&
    !buildSuperEntitled &&
    !(editing.quota.type === "paid" && editing.quota.source !== "buildSuperEntitlement");
  return (
    <div className="space-y-2">
      <Label id="account-build-route-mode">{t("accounts.buildRouteMode.label")}</Label>
      <Tabs
        value={buildRouteMode}
        onValueChange={(value) => form.setValue("buildRouteMode", value as BuildRouteMode, { shouldDirty: true })}
      >
        <TabsList aria-labelledby="account-build-route-mode" className="grid h-10 w-full grid-cols-3 p-1">
          {(["auto", "build", "xai"] as BuildRouteMode[]).map((mode) => (
            <TabsTrigger key={mode} value={mode} className="h-8 px-2 font-normal data-[state=active]:font-medium">
              {t(`accounts.buildRouteMode.${mode}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <p className="text-xs text-muted-foreground">{t(`accounts.buildRouteMode.${buildRouteMode}Description`)}</p>
      {showXaiWarning ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {t("accounts.buildRouteMode.xaiUnconfirmedWarning")}
        </p>
      ) : null}
    </div>
  );
}

function CloudflareCookieField({
  form,
  editing,
  clearCloudflareCookies,
}: {
  form: UseFormReturn<AccountForm>;
  editing: AccountDTO;
  clearCloudflareCookies: boolean;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <Label htmlFor="account-cloudflare-cookie">{t("settings.egress.cloudflareCookie")}</Label>
      <Textarea
        id="account-cloudflare-cookie"
        className="min-h-20 font-mono text-xs"
        autoComplete="new-password"
        spellCheck={false}
        disabled={clearCloudflareCookies}
        placeholder={editing.cloudflareCookieConfigured ? t("settings.egress.keepConfigured") : "cf_clearance=..."}
        {...form.register("cloudflareCookies")}
      />
      {editing.cloudflareCookieConfigured ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={clearCloudflareCookies}
            onCheckedChange={(checked) => form.setValue("clearCloudflareCookies", checked === true)}
          />
          {t("common.clear")}
        </label>
      ) : null}
      {form.formState.errors.cloudflareCookies ? (
        <p className="text-xs text-destructive">{form.formState.errors.cloudflareCookies.message}</p>
      ) : null}
    </div>
  );
}

function AccountEnabledField({
  form,
  accountEnabled,
}: {
  form: UseFormReturn<AccountForm>;
  accountEnabled: boolean;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between border-b py-2">
      <Label htmlFor="account-enabled">{accountEnabled ? t("common.enabled") : t("common.disabled")}</Label>
      <Switch
        id="account-enabled"
        checked={accountEnabled}
        onCheckedChange={(checked) => form.setValue("enabled", checked)}
      />
    </div>
  );
}

function AccountLimitFields({ form }: { form: UseFormReturn<AccountForm> }): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="account-priority">{t("accounts.priority")}</Label>
        <Input id="account-priority" type="number" {...form.register("priority", { valueAsNumber: true })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="account-concurrency">{t("accounts.maxConcurrent")}</Label>
        <Input
          id="account-concurrency"
          type="number"
          min="1"
          max="256"
          {...form.register("maxConcurrent", { valueAsNumber: true })}
        />
      </div>
    </div>
  );
}

function AccountMinimumField({ form }: { form: UseFormReturn<AccountForm> }): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <Label htmlFor="account-minimum">{t("accounts.minimumRemaining")}</Label>
      <Input
        id="account-minimum"
        type="number"
        min="0"
        step="0.01"
        {...form.register("minimumRemaining", { valueAsNumber: true })}
      />
    </div>
  );
}
