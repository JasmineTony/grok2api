import { CircleAlert, CircleHelp } from "lucide-react";
import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { EgressScope } from "@/features/settings/settings-api";

export function ScopeSelect({
  id,
  value,
  onChange,
  scopeLabel,
}: {
  id: string;
  value: EgressScope;
  onChange: (value: EgressScope) => void;
  scopeLabel: (scope: EgressScope) => string;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as EgressScope)}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(
          [
            "grok_build",
            "grok_web",
            "grok_console",
            "grok_web_asset",
            "grok_console_asset",
          ] as EgressScope[]
        ).map((scope) => (
          <SelectItem key={scope} value={scope}>
            {scopeLabel(scope)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function OperationSectionHeader({
  title,
  help,
  children,
}: {
  title: string;
  help: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-3 px-1">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-medium tracking-tight">{title}</h3>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label={help}
            >
              <CircleHelp className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-80">{help}</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}
export function ActionTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-80">{label}</TooltipContent>
    </Tooltip>
  );
}
export function AutomationRow({
  controlId,
  label,
  description,
  error,
  children,
}: {
  controlId: string;
  label: string;
  description: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 py-4">
      <div className="grid min-w-0 gap-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:items-center sm:gap-8">
        <div className="min-w-0">
          <div className="flex min-h-5 items-center">
            <Label htmlFor={controlId} className="text-xs font-medium">
              {label}
            </Label>
          </div>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">{description}</p>
          {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
export function IntervalInput({
  id,
  value,
  unit,
  onChange,
}: {
  id: string;
  value: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex min-w-0">
      <Input
        id={id}
        className="min-w-0 rounded-r-none"
        type="number"
        min={60}
        max={86400}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className="flex h-8 shrink-0 items-center rounded-r-md bg-secondary/55 px-3 text-xs text-foreground">
        {unit}
      </div>
    </div>
  );
}
export function SourceError({ message }: { message: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex shrink-0 cursor-help text-destructive"
          tabIndex={0}
          aria-label={message}
        >
          <CircleAlert className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-80">{message}</TooltipContent>
    </Tooltip>
  );
}
export function Control({
  controlId,
  label,
  children,
}: {
  controlId: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={controlId} className="text-xs font-medium">
        {label}
      </Label>
      {children}
    </div>
  );
}
export function ToggleControl({
  controlId,
  label,
  checked,
  onChange,
}: {
  controlId: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-4 rounded-md bg-muted/45 px-3">
      <Label htmlFor={controlId} className="text-xs font-medium">
        {label}
      </Label>
      <Switch id={controlId} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
