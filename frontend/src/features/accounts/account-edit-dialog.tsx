import type { UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";

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
import type {
  AccountDTO,
  BuildRouteMode,
} from "@/features/accounts/accounts-api";
import type { AccountFormValues } from "@/features/accounts/account-form";

export function AccountEditDialog({
  account,
  form,
  enabled,
  clearCloudflareCookies,
  buildSuperEntitled,
  buildRouteMode,
  pending,
  onClose,
  onSubmit,
}: {
  account: AccountDTO | null;
  form: UseFormReturn<AccountFormValues>;
  enabled: boolean;
  clearCloudflareCookies: boolean;
  buildSuperEntitled: boolean;
  buildRouteMode: BuildRouteMode;
  pending: boolean;
  onClose: () => void;
  onSubmit: (values: AccountFormValues) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={Boolean(account)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("common.edit")} {account?.name}
          </DialogTitle>
          <DialogDescription>
            {account?.email ?? account?.userId}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <Label htmlFor="account-name">{t("accounts.name")}</Label>
            <Input id="account-name" {...form.register("name")} />
            {form.formState.errors.name ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.name.message}
              </p>
            ) : null}
          </div>
          <div className="flex items-center justify-between border-b py-2">
            <Label htmlFor="account-enabled">
              {enabled ? t("common.enabled") : t("common.disabled")}
            </Label>
            <Switch
              id="account-enabled"
              checked={enabled}
              onCheckedChange={(checked) => form.setValue("enabled", checked)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="account-priority">{t("accounts.priority")}</Label>
              <Input
                id="account-priority"
                type="number"
                {...form.register("priority", { valueAsNumber: true })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-concurrency">
                {t("accounts.maxConcurrent")}
              </Label>
              <Input
                id="account-concurrency"
                type="number"
                min="1"
                max="256"
                {...form.register("maxConcurrent", { valueAsNumber: true })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-minimum">
              {t("accounts.minimumRemaining")}
            </Label>
            <Input
              id="account-minimum"
              type="number"
              min="0"
              step="0.01"
              {...form.register("minimumRemaining", { valueAsNumber: true })}
            />
          </div>
          {account?.provider === "grok_build" ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4 rounded-md bg-muted/50 p-3">
                <div className="space-y-1">
                  <Label htmlFor="account-build-super-entitled">
                    {t("accounts.buildSuperEntitled.label")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t("accounts.buildSuperEntitled.description")}
                  </p>
                </div>
                <Switch
                  id="account-build-super-entitled"
                  checked={buildSuperEntitled}
                  onCheckedChange={(checked) =>
                    form.setValue("buildSuperEntitled", checked, {
                      shouldDirty: true,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label id="account-build-route-mode">
                  {t("accounts.buildRouteMode.label")}
                </Label>
                <Tabs
                  value={buildRouteMode}
                  onValueChange={(value) =>
                    form.setValue("buildRouteMode", value as BuildRouteMode, {
                      shouldDirty: true,
                    })
                  }
                >
                  <TabsList
                    aria-labelledby="account-build-route-mode"
                    className="grid h-10 w-full grid-cols-3 p-1"
                  >
                    {(["auto", "build", "xai"] as BuildRouteMode[]).map(
                      (mode) => (
                        <TabsTrigger
                          key={mode}
                          value={mode}
                          className="h-8 px-2 font-normal data-[state=active]:font-medium"
                        >
                          {t(`accounts.buildRouteMode.${mode}`)}
                        </TabsTrigger>
                      ),
                    )}
                  </TabsList>
                </Tabs>
                <p className="text-xs text-muted-foreground">
                  {t(`accounts.buildRouteMode.${buildRouteMode}Description`)}
                </p>
                {buildRouteMode === "xai" &&
                !buildSuperEntitled &&
                !(
                  account.quota.type === "paid" &&
                  account.quota.source !== "buildSuperEntitlement"
                ) ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {t("accounts.buildRouteMode.xaiUnconfirmedWarning")}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
          {account && account.provider !== "grok_build" ? (
            <div className="space-y-2">
              <Label htmlFor="account-cloudflare-cookie">
                {t("settings.egress.cloudflareCookie")}
              </Label>
              <Textarea
                id="account-cloudflare-cookie"
                className="min-h-20 font-mono text-xs"
                autoComplete="new-password"
                spellCheck={false}
                disabled={clearCloudflareCookies}
                placeholder={
                  account.cloudflareCookieConfigured
                    ? t("settings.egress.keepConfigured")
                    : "cf_clearance=..."
                }
                {...form.register("cloudflareCookies")}
              />
              {account.cloudflareCookieConfigured ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={clearCloudflareCookies}
                    onCheckedChange={(checked) =>
                      form.setValue("clearCloudflareCookies", checked === true)
                    }
                  />
                  {t("common.clear")}
                </label>
              ) : null}
              {form.formState.errors.cloudflareCookies ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.cloudflareCookies.message}
                </p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onClose}
            >
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
