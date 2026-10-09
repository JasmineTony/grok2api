import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { UseFormReturn } from "react-hook-form";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import type { SettingsForm } from "@/features/settings/settings-schema";
import {
  isByteSizeUnit,
  isDurationUnit,
  type ByteSizeValue,
  type DurationValue,
} from "@/features/settings/settings-units";
import { cn } from "@/shared/lib/cn";

/** 设置页各分页共享的表单实例契约。 */
export type SettingsFormApi = UseFormReturn<SettingsForm>;

export function SettingsPane({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsContent
      value={value}
      forceMount
      data-testid={`settings-pane-${value}`}
      className="m-0 space-y-8 data-[state=inactive]:hidden"
    >
      {children}
    </TabsContent>
  );
}

export function SettingsSection({
  testId,
  title,
  action,
  children,
}: {
  testId?: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3" data-testid={testId}>
      <div className="flex min-h-8 items-center justify-between gap-3 px-1">
        <h2 className="text-sm font-medium tracking-tight">{title}</h2>
        {action}
      </div>
      <div className="min-w-0 w-full">{children}</div>
    </section>
  );
}

export function SettingsField({
  controlId,
  label,
  badge,
  description,
  error,
  className,
  children,
}: {
  controlId: string;
  label: string;
  badge?: string;
  description?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn("min-w-0 py-4", className)} data-testid={`settings-field-${controlId}`}>
      <div className="grid min-w-0 gap-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:items-center sm:gap-8">
        <div className="min-w-0">
          <div className="flex min-h-5 items-center gap-2">
            <Label htmlFor={controlId} className="text-xs font-medium">
              {label}
            </Label>
            {badge ? (
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                {badge}
              </Badge>
            ) : null}
          </div>
          {description ? <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">{description}</p> : null}
          {error ? <p className="mt-1 text-xs text-destructive">{t("settings.invalidValue")}</p> : null}
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

export function ByteSizeInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value?: ByteSizeValue;
  onChange: (value: ByteSizeValue) => void;
}) {
  const { t } = useTranslation();
  const unit = value?.unit ?? "MiB";
  return (
    <div className="flex min-w-0">
      <Input
        id={id}
        type="number"
        min="0.001"
        step="any"
        className="min-w-0 rounded-r-none"
        value={Number.isFinite(value?.value) ? value?.value : ""}
        onChange={(event) =>
          onChange({ value: event.target.value === "" ? Number.NaN : Number(event.target.value), unit })
        }
      />
      <Select
        value={unit}
        onValueChange={(nextUnit) => {
          if (isByteSizeUnit(nextUnit)) onChange({ value: value?.value ?? 1, unit: nextUnit });
        }}
      >
        <SelectTrigger
          className="w-24 shrink-0 rounded-l-none bg-secondary/55"
          aria-label={t("settings.media.sizeUnit")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="MiB">MiB</SelectItem>
          <SelectItem value="GiB">GiB</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export function DurationInput({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value?: DurationValue;
  onChange: (value: DurationValue) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const unit = value?.unit ?? "s";
  return (
    <div className="flex min-w-0">
      <Input
        id={id}
        type="number"
        min="0.001"
        step="any"
        disabled={disabled}
        className="min-w-0 rounded-r-none"
        value={Number.isFinite(value?.value) ? value?.value : ""}
        onChange={(event) =>
          onChange({ value: event.target.value === "" ? Number.NaN : Number(event.target.value), unit })
        }
      />
      <Select
        value={unit}
        disabled={disabled}
        onValueChange={(nextUnit) => {
          if (isDurationUnit(nextUnit)) onChange({ value: value?.value ?? 1, unit: nextUnit });
        }}
      >
        <SelectTrigger className="w-24 shrink-0 rounded-l-none bg-secondary/55" aria-label={t("settings.durationUnit")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="s">{t("settings.units.seconds")}</SelectItem>
          <SelectItem value="m">{t("settings.units.minutes")}</SelectItem>
          <SelectItem value="h">{t("settings.units.hours")}</SelectItem>
          <SelectItem value="d">{t("settings.units.days")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
