import { CircleHelp } from "lucide-react";
import { Controller, useWatch, type UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MAX_BILLING_LIMIT_USD, type ClientKeyFormValues } from "@/features/client-keys/client-key-form-schema";
import { DateTimePicker } from "@/shared/components/date-time-picker";

type FormProps = { form: UseFormReturn<ClientKeyFormValues> };

export function KeyNameField({ form }: FormProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <Label htmlFor="key-name">{t("keys.name")}</Label>
      <Input id="key-name" data-testid="client-keys-form-name" {...form.register("name")} />
      {form.formState.errors.name ? (
        <p className="text-xs text-destructive" data-testid="client-keys-form-name-error">
          {form.formState.errors.name.message}
        </p>
      ) : null}
    </div>
  );
}

type NumericLimitFieldProps = FormProps & {
  id: string;
  label: string;
  name: "rpmLimit" | "maxConcurrent";
  unlimitedName: "rpmUnlimited" | "concurrencyUnlimited";
  max: number;
};

/** 速率/并发上限共用的「数值 + 不限开关」输入组。 */
function NumericLimitField({ form, id, label, name, unlimitedName, max }: NumericLimitFieldProps) {
  const { t } = useTranslation();
  const unlimited = useWatch({ control: form.control, name: unlimitedName });
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("keys.unlimited")}</span>
          <Switch
            id={`${id}-unlimited`}
            data-testid={`${id}-unlimited`}
            checked={unlimited}
            onCheckedChange={(checked) => form.setValue(unlimitedName, checked, { shouldDirty: true })}
          />
        </div>
      </div>
      <Input
        id={id}
        data-testid={id}
        type="number"
        min="1"
        max={max}
        disabled={unlimited}
        {...form.register(name, { valueAsNumber: true })}
      />
    </div>
  );
}

export function KeyLimitFields({ form }: FormProps) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <NumericLimitField
        form={form}
        id="key-rpm"
        label={t("keys.rpm")}
        name="rpmLimit"
        unlimitedName="rpmUnlimited"
        max={100_000}
      />
      <NumericLimitField
        form={form}
        id="key-concurrency"
        label={t("keys.maxConcurrent")}
        name="maxConcurrent"
        unlimitedName="concurrencyUnlimited"
        max={1_024}
      />
    </div>
  );
}

export function KeyBillingLimitField({ form }: FormProps) {
  const { t } = useTranslation();
  const billingUnlimited = useWatch({ control: form.control, name: "billingUnlimited" });
  return (
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
                data-testid="client-keys-form-billing-help"
              >
                <CircleHelp className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">{t("keys.billingLimitDescription")}</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("keys.unlimited")}</span>
          <Switch
            id="key-billing-unlimited"
            data-testid="key-billing-unlimited"
            checked={billingUnlimited}
            onCheckedChange={(checked) => form.setValue("billingUnlimited", checked, { shouldDirty: true })}
          />
        </div>
      </div>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          $
        </span>
        <Input
          className="pl-7"
          data-testid="key-billing-limit"
          type="number"
          min="0.01"
          max={MAX_BILLING_LIMIT_USD}
          step="0.01"
          disabled={billingUnlimited}
          {...form.register("billingLimitUsd", { valueAsNumber: true })}
        />
      </div>
    </div>
  );
}

export function KeyExpiryField({ form }: FormProps) {
  const { t } = useTranslation();
  const expiryUnlimited = useWatch({ control: form.control, name: "expiryUnlimited" });
  return (
    <div className="space-y-2">
      <div className="flex h-5 items-center justify-between gap-3">
        <Label htmlFor="key-expiry-unlimited">{t("keys.expires")}</Label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("keys.unlimited")}</span>
          <Switch
            id="key-expiry-unlimited"
            data-testid="key-expiry-unlimited"
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
            placeholder={expiryUnlimited ? t("keys.neverExpires") : t("keys.selectExpiry")}
          />
        )}
      />
      {form.formState.errors.expiresAt ? (
        <p className="text-xs text-destructive" data-testid="client-keys-form-expires-at-error">
          {form.formState.errors.expiresAt.message}
        </p>
      ) : null}
    </div>
  );
}

export function KeyModelAliasesSection({ form }: FormProps) {
  const { t } = useTranslation();
  const allowModelAliases = useWatch({ control: form.control, name: "allowModelAliases" });
  return (
    <section className="flex items-center justify-between gap-4 rounded-lg bg-muted/25 px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <Label htmlFor="key-model-aliases">{t("keys.modelAliases")}</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label={t("keys.modelAliasesDescription")}
                data-testid="client-keys-form-aliases-help"
              >
                <CircleHelp className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-96 space-y-2 py-2 text-left leading-relaxed">
              <p>{t("keys.modelAliasesDescription")}</p>
              <ul className="list-disc space-y-1 pl-4 text-primary-foreground/80">
                <li>{t("keys.modelAliasesBuildSupport")}</li>
                <li>{t("keys.modelAliasesConsoleSupport")}</li>
                <li>{t("keys.modelAliasesUnsupported")}</li>
              </ul>
            </TooltipContent>
          </Tooltip>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {allowModelAliases ? t("keys.modelAliasesOn") : t("keys.modelAliasesOff")}
        </p>
      </div>
      <Switch
        className="shrink-0"
        id="key-model-aliases"
        data-testid="key-model-aliases"
        checked={allowModelAliases}
        onCheckedChange={(checked) => form.setValue("allowModelAliases", checked, { shouldDirty: true })}
      />
    </section>
  );
}

export function KeyEnabledSection({ form }: FormProps) {
  const { t } = useTranslation();
  const keyEnabled = useWatch({ control: form.control, name: "enabled" });
  return (
    <section className="flex items-center justify-between gap-4 rounded-lg bg-muted/25 px-3 py-2.5">
      <div className="min-w-0">
        <Label htmlFor="key-enabled">{keyEnabled ? t("common.enabled") : t("common.disabled")}</Label>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("keys.enabledDescription")}</p>
      </div>
      <Switch
        className="shrink-0"
        id="key-enabled"
        data-testid="key-enabled"
        checked={keyEnabled}
        onCheckedChange={(checked) => form.setValue("enabled", checked)}
      />
    </section>
  );
}
