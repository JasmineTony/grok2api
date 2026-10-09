import { CircleHelp } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fallbackNodeCandidates } from "@/features/settings/egress-fallback";
import { egressScopes } from "@/features/settings/egress-scopes";
import type {
  EgressFallbackConfigDTO,
  EgressFallbackMode,
  EgressNodeDTO,
  EgressOperationsConfigDTO,
  EgressScope,
} from "@/features/settings/settings-api";

export type EgressOperationsForm = Omit<EgressOperationsConfigDTO, "updatedAt">;

const fallbackDescriptionKeys: Record<EgressScope, string> = {
  grok_build: "settings.egress.fallbackBuildHelp",
  grok_web: "settings.egress.fallbackWebHelp",
  grok_console: "settings.egress.fallbackConsoleHelp",
  grok_web_asset: "settings.egress.fallbackWebAssetHelp",
  grok_console_asset: "settings.egress.fallbackConsoleAssetHelp",
};

export type EgressAutomationSettingsProps = {
  form: EgressOperationsForm;
  nodes: EgressNodeDTO[];
  scopeLabel: (scope: EgressScope) => string;
  onChange: (form: EgressOperationsForm) => void;
  onFallback: (scope: EgressScope, fallback: EgressFallbackConfigDTO) => void;
  onFallbackMode: (scope: EgressScope, mode: EgressFallbackMode) => void;
};

/** 出口自动化参数区：探测/分配参数 + 各作用域兜底策略。 */
export function EgressAutomationSettings(props: EgressAutomationSettingsProps) {
  return (
    <div className="space-y-0">
      <EgressProbeRows form={props.form} onChange={props.onChange} />
      <EgressAssignmentRows form={props.form} onChange={props.onChange} />
      <EgressFallbackSection
        form={props.form}
        nodes={props.nodes}
        scopeLabel={props.scopeLabel}
        onFallback={props.onFallback}
        onFallbackMode={props.onFallbackMode}
      />
    </div>
  );
}

function EgressProbeRows({
  form,
  onChange,
}: {
  form: EgressOperationsForm;
  onChange: (form: EgressOperationsForm) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <AutomationRow
        controlId="egress-probe-provider"
        label={t("settings.egress.probeProvider")}
        description={t("settings.egress.probeProviderHelp")}
      >
        <Select
          value={form.probeProvider}
          onValueChange={(probeProvider: "ipinfo" | "cloudflare") => onChange({ ...form, probeProvider })}
        >
          <SelectTrigger id="egress-probe-provider" className="h-8 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ipinfo">IPinfo</SelectItem>
            <SelectItem value="cloudflare">Cloudflare</SelectItem>
          </SelectContent>
        </Select>
      </AutomationRow>
      <AutomationRow
        controlId="egress-probe-interval"
        label={t("settings.egress.probeInterval")}
        description={t("settings.egress.probeIntervalHelp")}
      >
        <IntervalInput
          id="egress-probe-interval"
          value={form.probeIntervalSeconds}
          unit={t("settings.units.seconds")}
          onChange={(probeIntervalSeconds) => onChange({ ...form, probeIntervalSeconds })}
        />
      </AutomationRow>
    </>
  );
}

function EgressAssignmentRows({
  form,
  onChange,
}: {
  form: EgressOperationsForm;
  onChange: (form: EgressOperationsForm) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <AutomationRow
        controlId="egress-assignment-interval"
        label={t("settings.egress.assignmentInterval")}
        description={t("settings.egress.assignmentIntervalHelp")}
      >
        <IntervalInput
          id="egress-assignment-interval"
          value={form.assignmentIntervalSeconds}
          unit={t("settings.units.seconds")}
          onChange={(assignmentIntervalSeconds) => onChange({ ...form, assignmentIntervalSeconds })}
        />
      </AutomationRow>
      <EgressSwitchRow
        controlId="egress-auto-assign"
        label={t("settings.egress.autoAssign")}
        description={t("settings.egress.autoAssignHelp")}
        checked={form.autoAssignEnabled}
        onChange={(autoAssignEnabled) => onChange({ ...form, autoAssignEnabled })}
      />
      <EgressSwitchRow
        controlId="egress-auto-balance"
        label={t("settings.egress.autoBalance")}
        description={t("settings.egress.autoBalanceHelp")}
        checked={form.autoBalanceEnabled}
        onChange={(autoBalanceEnabled) => onChange({ ...form, autoBalanceEnabled })}
      />
    </>
  );
}

function EgressSwitchRow({
  controlId,
  label,
  description,
  checked,
  onChange,
}: {
  controlId: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <AutomationRow controlId={controlId} label={label} description={description}>
      <div className="flex h-8 items-center">
        <Switch id={controlId} checked={checked} onCheckedChange={onChange} />
      </div>
    </AutomationRow>
  );
}

function EgressFallbackSection(props: Omit<EgressAutomationSettingsProps, "onChange">) {
  const { t } = useTranslation();
  return (
    <div className="pt-4">
      <div className="flex items-center gap-1.5 px-0.5">
        <h3 className="text-sm font-medium tracking-tight">{t("settings.egress.fallback")}</h3>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label={t("settings.egress.fallbackHelp")}
            >
              <CircleHelp className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-80">{t("settings.egress.fallbackHelp")}</TooltipContent>
        </Tooltip>
      </div>
      <div className="mt-3 space-y-2" data-testid="egress-fallback-list">
        {egressScopes.map((scope) => (
          <EgressFallbackRow
            key={scope}
            scope={scope}
            fallback={props.form.fallbacks[scope]}
            candidates={fallbackNodeCandidates(props.nodes, scope)}
            scopeLabel={props.scopeLabel}
            onFallback={props.onFallback}
            onFallbackMode={props.onFallbackMode}
          />
        ))}
      </div>
    </div>
  );
}

function EgressFallbackRow({
  scope,
  fallback,
  candidates,
  scopeLabel,
  onFallback,
  onFallbackMode,
}: {
  scope: EgressScope;
  fallback: EgressFallbackConfigDTO;
  candidates: EgressNodeDTO[];
  scopeLabel: (scope: EgressScope) => string;
  onFallback: (scope: EgressScope, fallback: EgressFallbackConfigDTO) => void;
  onFallbackMode: (scope: EgressScope, mode: EgressFallbackMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="grid min-w-0 gap-2.5 py-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:items-center sm:gap-8"
      data-testid={`egress-fallback-row-${scope}`}
    >
      <div className="min-w-0">
        <div className="flex min-h-5 items-center">
          <Label className="text-xs font-medium">{scopeLabel(scope)}</Label>
        </div>
        <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">{t(fallbackDescriptionKeys[scope])}</p>
      </div>
      <EgressFallbackSelects
        scope={scope}
        fallback={fallback}
        candidates={candidates}
        scopeLabel={scopeLabel}
        onFallback={onFallback}
        onFallbackMode={onFallbackMode}
      />
    </div>
  );
}

function EgressFallbackSelects({
  scope,
  fallback,
  candidates,
  scopeLabel,
  onFallback,
  onFallbackMode,
}: {
  scope: EgressScope;
  fallback: EgressFallbackConfigDTO;
  candidates: EgressNodeDTO[];
  scopeLabel: (scope: EgressScope) => string;
  onFallback: (scope: EgressScope, fallback: EgressFallbackConfigDTO) => void;
  onFallbackMode: (scope: EgressScope, mode: EgressFallbackMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={fallback.mode === "fixed" ? "grid min-w-0 gap-2 sm:grid-cols-2" : "grid min-w-0"}>
      <Select value={fallback.mode} onValueChange={(mode) => onFallbackMode(scope, mode as EgressFallbackMode)}>
        <SelectTrigger aria-label={t("settings.egress.fallbackMode", { scope: scopeLabel(scope) })}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t("settings.egress.fallbackNone")}</SelectItem>
          <SelectItem value="direct">{t("settings.egress.fallbackDirect")}</SelectItem>
          <SelectItem value="fixed" disabled={candidates.length === 0}>
            {t("settings.egress.fallbackFixed")}
          </SelectItem>
        </SelectContent>
      </Select>
      <EgressFallbackNodeSelect
        scope={scope}
        fallback={fallback}
        candidates={candidates}
        scopeLabel={scopeLabel}
        onFallback={onFallback}
      />
    </div>
  );
}

function AutomationRow({
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

function IntervalInput({
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
      <div className="flex h-8 w-16 shrink-0 items-center rounded-r-md bg-secondary/55 px-3 text-xs text-foreground">
        {unit}
      </div>
    </div>
  );
}

function EgressFallbackNodeSelect({
  scope,
  fallback,
  candidates,
  scopeLabel,
  onFallback,
}: {
  scope: EgressScope;
  fallback: EgressFallbackConfigDTO;
  candidates: EgressNodeDTO[];
  scopeLabel: (scope: EgressScope) => string;
  onFallback: (scope: EgressScope, fallback: EgressFallbackConfigDTO) => void;
}) {
  const { t } = useTranslation();
  const selectedAvailable = candidates.some((node) => node.id === fallback.nodeId);
  if (fallback.mode !== "fixed") return null;
  return (
    <Select
      value={selectedAvailable ? (fallback.nodeId ?? "unavailable") : "unavailable"}
      disabled={candidates.length === 0}
      onValueChange={(nodeId) => onFallback(scope, { mode: "fixed", nodeId })}
    >
      <SelectTrigger aria-label={t("settings.egress.fallbackNode", { scope: scopeLabel(scope) })}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {!selectedAvailable ? (
          <SelectItem value="unavailable" disabled>
            {t("settings.egress.fallbackNodeUnavailable")}
          </SelectItem>
        ) : null}
        {candidates.map((node) => (
          <SelectItem key={node.id} value={node.id}>
            {node.name} ({scopeLabel(node.scope)})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
