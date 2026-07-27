import { CircleHelp, Network, Shuffle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  fallbackDescriptionKeys,
  fallbackNodeCandidates,
  fallbackScopes,
} from "@/features/settings/egress-operations-model";
import {
  ActionTooltip,
  AutomationRow,
  IntervalInput,
  OperationSectionHeader,
} from "@/features/settings/egress-operations-ui";
import type {
  EgressFallbackConfigDTO,
  EgressFallbackMode,
  EgressNodeDTO,
  EgressOperationsConfigDTO,
  EgressScope,
} from "@/features/settings/settings-api";
import { ErrorState, LoadingState } from "@/shared/components/data-state";

type OperationsForm = Omit<EgressOperationsConfigDTO, "updatedAt">;

type EgressAutomationPanelProps = {
  form: OperationsForm;
  nodes: EgressNodeDTO[];
  scopeLabel: (scope: EgressScope) => string;
  loading: boolean;
  error: Error | null;
  dirty: boolean;
  saving: boolean;
  testing: boolean;
  rebalancing: boolean;
  onRetry: () => void;
  onChange: (next: OperationsForm) => void;
  onFallbackChange: (scope: EgressScope, fallback: EgressFallbackConfigDTO) => void;
  onFallbackModeChange: (scope: EgressScope, mode: EgressFallbackMode) => void;
  onSave: () => void;
  onTestAll: () => void;
  onRebalance: () => void;
};

export function EgressAutomationPanel({
  form,
  nodes,
  scopeLabel,
  loading,
  error,
  dirty,
  saving,
  testing,
  rebalancing,
  onRetry,
  onChange,
  onFallbackChange,
  onFallbackModeChange,
  onSave,
  onTestAll,
  onRebalance,
}: EgressAutomationPanelProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <OperationSectionHeader
        title={t("settings.egress.automation")}
        help={t("settings.egress.automationHelp")}
      >
        <ActionTooltip label={t("settings.egress.testAllHelp")}>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={testing}
            onClick={onTestAll}
          >
            {testing ? <Spinner /> : <Network />}
            {t("settings.egress.testAll")}
          </Button>
        </ActionTooltip>
        <ActionTooltip label={t("settings.egress.rebalanceHelp")}>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={rebalancing}
            onClick={onRebalance}
          >
            {rebalancing ? <Spinner /> : <Shuffle />}
            {t("settings.egress.rebalance")}
          </Button>
        </ActionTooltip>
        <ActionTooltip label={t("settings.egress.saveAutomationHelp")}>
          <Button type="button" size="sm" disabled={!dirty || saving} onClick={onSave}>
            {saving ? <Spinner /> : null}
            {t("common.save")}
          </Button>
        </ActionTooltip>
      </OperationSectionHeader>

      {error ? (
        <ErrorState message={error.message} onRetry={onRetry} />
      ) : loading ? (
        <LoadingState />
      ) : (
        <div className="space-y-0">
          <AutomationRow
            controlId="egress-probe-provider"
            label={t("egressProbeProvider.label")}
            description={t("egressProbeProvider.help")}
          >
            <Select
              value={form.probeProvider}
              onValueChange={(probeProvider: "ipinfo" | "cloudflare") =>
                onChange({ ...form, probeProvider })
              }
            >
              <SelectTrigger id="egress-probe-provider" className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cloudflare">Cloudflare</SelectItem>
                <SelectItem value="ipinfo">IPinfo</SelectItem>
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
          <AutomationRow
            controlId="egress-assignment-interval"
            label={t("settings.egress.assignmentInterval")}
            description={t("settings.egress.assignmentIntervalHelp")}
          >
            <IntervalInput
              id="egress-assignment-interval"
              value={form.assignmentIntervalSeconds}
              unit={t("settings.units.seconds")}
              onChange={(assignmentIntervalSeconds) =>
                onChange({ ...form, assignmentIntervalSeconds })
              }
            />
          </AutomationRow>
          <AutomationRow
            controlId="egress-auto-assign"
            label={t("settings.egress.autoAssign")}
            description={t("settings.egress.autoAssignHelp")}
          >
            <div className="flex h-8 items-center">
              <Switch
                id="egress-auto-assign"
                checked={form.autoAssignEnabled}
                onCheckedChange={(autoAssignEnabled) => onChange({ ...form, autoAssignEnabled })}
              />
            </div>
          </AutomationRow>
          <AutomationRow
            controlId="egress-auto-balance"
            label={t("settings.egress.autoBalance")}
            description={t("settings.egress.autoBalanceHelp")}
          >
            <div className="flex h-8 items-center">
              <Switch
                id="egress-auto-balance"
                checked={form.autoBalanceEnabled}
                onCheckedChange={(autoBalanceEnabled) => onChange({ ...form, autoBalanceEnabled })}
              />
            </div>
          </AutomationRow>
          <div className="pt-4">
            <div className="flex items-center gap-1.5 px-0.5">
              <h3 className="text-sm font-medium tracking-tight">
                {t("settings.egress.fallback")}
              </h3>
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
                <TooltipContent className="max-w-80">
                  {t("settings.egress.fallbackHelp")}
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="mt-3 space-y-2">
              {fallbackScopes.map((scope) => {
                const fallback = form.fallbacks[scope];
                const candidates = fallbackNodeCandidates(nodes, scope);
                const selectedAvailable = candidates.some((node) => node.id === fallback.nodeId);
                return (
                  <div
                    className="grid min-w-0 gap-2.5 py-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:items-center sm:gap-8"
                    key={scope}
                  >
                    <div className="min-w-0">
                      <div className="flex min-h-5 items-center">
                        <Label className="text-xs font-medium">{scopeLabel(scope)}</Label>
                      </div>
                      <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                        {t(fallbackDescriptionKeys[scope])}
                      </p>
                    </div>
                    <div
                      className={
                        fallback.mode === "fixed"
                          ? "grid min-w-0 gap-2 sm:grid-cols-2"
                          : "grid min-w-0"
                      }
                    >
                      <Select
                        value={fallback.mode}
                        onValueChange={(mode) =>
                          onFallbackModeChange(scope, mode as EgressFallbackMode)
                        }
                      >
                        <SelectTrigger
                          aria-label={t("settings.egress.fallbackMode", {
                            scope: scopeLabel(scope),
                          })}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("settings.egress.fallbackNone")}</SelectItem>
                          <SelectItem value="direct">
                            {t("settings.egress.fallbackDirect")}
                          </SelectItem>
                          <SelectItem value="fixed" disabled={candidates.length === 0}>
                            {t("settings.egress.fallbackFixed")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {fallback.mode === "fixed" ? (
                        <Select
                          value={
                            selectedAvailable ? (fallback.nodeId ?? "unavailable") : "unavailable"
                          }
                          disabled={candidates.length === 0}
                          onValueChange={(nodeId) =>
                            onFallbackChange(scope, { mode: "fixed", nodeId })
                          }
                        >
                          <SelectTrigger
                            aria-label={t("settings.egress.fallbackNode", {
                              scope: scopeLabel(scope),
                            })}
                          >
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
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
