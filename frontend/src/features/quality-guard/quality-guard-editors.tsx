import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, RotateCcw, Zap } from "lucide-react";
import { type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
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
import {
  type QualityGuardPolicy,
  type QualityGuardStatus,
  updateQualityGuardPolicy,
} from "@/features/quality-guard/quality-guard-api";
import { formatDuration, formatTPS } from "@/features/quality-guard/quality-guard-utils";
import { type EgressNodeDTO, type EgressNodeInput } from "@/features/settings";
import { useApiClient } from "@/shared/api/use-api-client";
import { cn } from "@/shared/lib/cn";

export function NodeEditor({
  open,
  editingNode,
  form,
  onFormChange,
  onOpenChange,
  onSave,
  saving,
}: {
  open: boolean;
  editingNode: EgressNodeDTO | null | undefined;
  form: EgressNodeInput;
  onFormChange: (form: EgressNodeInput) => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const proxyConfigured = Boolean(editingNode?.proxyConfigured || form.proxyURL?.trim());
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader className="pr-8">
          <DialogTitle>
            {editingNode ? t("settings.egress.editTitle") : t("settings.egress.addTitle")}
          </DialogTitle>
          <DialogDescription>{t("qualityGuard.nodeEditorDescription")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <div className="flex items-center justify-between gap-4 rounded-md bg-muted/45 px-3 py-2.5">
            <Label htmlFor="quality-node-enabled">{t("settings.egress.enabled")}</Label>
            <Switch
              id="quality-node-enabled"
              checked={form.enabled}
              onCheckedChange={(enabled) => onFormChange({ ...form, enabled })}
            />
          </div>
          <NodeField label={t("settings.egress.name")} controlId="quality-node-name">
            <Input
              id="quality-node-name"
              value={form.name}
              onChange={(event) => onFormChange({ ...form, name: event.target.value })}
            />
          </NodeField>
          <NodeField label={t("settings.egress.scope")} controlId="quality-node-scope">
            <div
              id="quality-node-scope"
              className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground"
            >
              {t("settings.egress.scopeBuild")}
            </div>
          </NodeField>
          <NodeField
            label={t("settings.egress.capacity")}
            controlId="quality-node-capacity"
            help={t("qualityGuard.nodeCapacityHelp")}
          >
            <Input
              id="quality-node-capacity"
              type="number"
              min={0}
              max={100000}
              placeholder={t("settings.egress.unlimited")}
              value={form.accountCapacity || ""}
              onChange={(event) =>
                onFormChange({ ...form, accountCapacity: Number(event.target.value) })
              }
            />
          </NodeField>
          <NodeField
            label={t("settings.egress.proxyURL")}
            controlId="quality-node-proxy"
            help={t("settings.egress.proxyProtocols")}
          >
            <Input
              id="quality-node-proxy"
              type="password"
              autoComplete="new-password"
              placeholder={
                editingNode?.proxyConfigured
                  ? t("settings.egress.keepConfigured")
                  : "socks5h://user:pass@host:port"
              }
              value={form.proxyURL ?? ""}
              onChange={(event) => {
                const proxyURL = event.target.value;
                onFormChange({
                  ...form,
                  proxyURL,
                  proxyPool:
                    editingNode?.proxyConfigured || proxyURL.trim()
                      ? (form.proxyPool ?? false)
                      : false,
                });
              }}
            />
          </NodeField>
          <div className="flex items-start justify-between gap-4 rounded-md bg-muted/45 px-3 py-2.5">
            <div className="space-y-1">
              <Label htmlFor="quality-node-proxy-pool">{t("settings.egress.proxyPool")}</Label>
              <p className="max-w-[390px] text-xs leading-5 text-muted-foreground">
                {t("settings.egress.proxyPoolHelp")}
              </p>
            </div>
            <Switch
              id="quality-node-proxy-pool"
              className="mt-0.5"
              checked={form.proxyPool ?? false}
              disabled={!proxyConfigured}
              onCheckedChange={(proxyPool) => onFormChange({ ...form, proxyPool })}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={!form.name.trim() || saving}>
              {saving ? <Spinner /> : null}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NodeField({
  label,
  controlId,
  help,
  children,
}: {
  label: string;
  controlId: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={controlId}>{label}</Label>
      {children}
      {help ? (
        <p className="whitespace-pre-line text-xs leading-5 text-muted-foreground">{help}</p>
      ) : null}
    </div>
  );
}

export function Policy({ status, onEdit }: { status: QualityGuardStatus; onEdit: () => void }) {
  const { t } = useTranslation();
  const config = status.config;
  if (!config) return null;
  const rows = [
    [t("qualityGuard.softThreshold"), `${formatTPS(config.soft_tps)} × ${config.consecutive_soft}`],
    [t("qualityGuard.hardThreshold"), formatTPS(config.hard_tps)],
    [t("qualityGuard.activeInterval"), formatDuration(config.active_interval_seconds)],
    [t("qualityGuard.passiveInterval"), formatDuration(config.passive_poll_seconds)],
    [t("qualityGuard.quarantineDuration"), formatDuration(config.quarantine_seconds)],
    [t("qualityGuard.minimumNodes"), String(config.min_healthy_nodes)],
  ];
  return (
    <section className="rounded-lg bg-card p-4 sm:p-5" aria-labelledby="guard-policy-title">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Zap className="size-4 text-muted-foreground" />
          <h2 id="guard-policy-title" className="text-sm font-medium">
            {t("qualityGuard.policy")}
          </h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onEdit}
          disabled={!status.editable}
        >
          <Pencil />
          {t("qualityGuard.editPolicy")}
        </Button>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-sm font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const policySchema = z
  .object({
    mode: z.enum(["active", "passive", "hybrid"]),
    activeIntervalSeconds: z.number().int().min(60).max(86400),
    passivePollSeconds: z.number().int().min(1).max(300),
    softTPS: z.number().min(1).max(10000),
    hardTPS: z.number().min(1).max(10000),
    consecutiveSoft: z.number().int().min(1).max(20),
    consecutiveErrors: z.number().int().min(1).max(20),
    quarantineSeconds: z.number().int().min(30).max(86400),
    minHealthyNodes: z.number().int().min(1).max(1000),
  })
  .refine((value) => value.softTPS < value.hardTPS, {
    path: ["hardTPS"],
    message: "softThresholdMustBeLower",
  });

const DEFAULT_POLICY: QualityGuardPolicy = {
  mode: "hybrid",
  activeIntervalSeconds: 1800,
  passivePollSeconds: 5,
  softTPS: 500,
  hardTPS: 1000,
  consecutiveSoft: 2,
  consecutiveErrors: 2,
  quarantineSeconds: 300,
  minHealthyNodes: 3,
};

export function PolicyEditor({
  open,
  onOpenChange,
  status,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: QualityGuardStatus;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  const nodeCount = status.config?.node_ids.length ?? 1;
  const form = useForm<QualityGuardPolicy>({
    resolver: zodResolver(policySchema),
    defaultValues: policyFromStatus(status),
  });
  const mode = useWatch({ control: form.control, name: "mode" });
  const softTPS = useWatch({ control: form.control, name: "softTPS" });
  const hardTPS = useWatch({ control: form.control, name: "hardTPS" });
  const thresholdsInvalid =
    Number.isFinite(softTPS) && Number.isFinite(hardTPS) && softTPS >= hardTPS;
  const mutation = useMutation({
    mutationFn: (policy: QualityGuardPolicy) => updateQualityGuardPolicy(apiClient, policy),
    onSuccess: () => {
      toast.success(t("qualityGuard.policySaved"));
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ["quality-guard"] });
      window.setTimeout(
        () => void queryClient.invalidateQueries({ queryKey: ["quality-guard"] }),
        1_500,
      );
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("errors.generic")),
  });

  const setMode = (value: QualityGuardPolicy["mode"]) =>
    form.setValue("mode", value, { shouldDirty: true, shouldValidate: true });
  const resetDefaults = () =>
    form.reset({
      ...DEFAULT_POLICY,
      minHealthyNodes: Math.min(DEFAULT_POLICY.minHealthyNodes, nodeCount),
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("qualityGuard.editPolicyTitle")}</DialogTitle>
          <DialogDescription>{t("qualityGuard.editPolicyDescription")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={form.handleSubmit((value) => mutation.mutate(value))}>
          <div className="space-y-2">
            <Label>{t("qualityGuard.mode")}</Label>
            <div
              role="radiogroup"
              aria-label={t("qualityGuard.mode")}
              className="grid grid-cols-3 rounded-md bg-secondary p-1"
            >
              {(["passive", "hybrid", "active"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => setMode(value)}
                  className={cn(
                    "h-8 rounded-sm px-2 text-xs text-muted-foreground transition-colors",
                    mode === value && "bg-background font-medium text-foreground shadow-sm",
                  )}
                >
                  {t(`qualityGuard.modes.${value}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <PolicyField
              id="guard-active-interval"
              label={t("qualityGuard.activeIntervalSeconds")}
              error={form.formState.errors.activeIntervalSeconds?.message}
            >
              <Input
                id="guard-active-interval"
                type="number"
                min={60}
                max={86400}
                step={60}
                {...form.register("activeIntervalSeconds", { valueAsNumber: true })}
              />
            </PolicyField>
            <PolicyField
              id="guard-passive-interval"
              label={t("qualityGuard.passiveIntervalSeconds")}
              error={form.formState.errors.passivePollSeconds?.message}
            >
              <Input
                id="guard-passive-interval"
                type="number"
                min={1}
                max={300}
                {...form.register("passivePollSeconds", { valueAsNumber: true })}
              />
            </PolicyField>
            <PolicyField
              id="guard-soft-tps"
              label={t("qualityGuard.softThreshold")}
              error={form.formState.errors.softTPS?.message}
            >
              <Input
                id="guard-soft-tps"
                type="number"
                min={1}
                max={10000}
                step="any"
                {...form.register("softTPS", { valueAsNumber: true })}
              />
            </PolicyField>
            <PolicyField
              id="guard-hard-tps"
              label={t("qualityGuard.hardThreshold")}
              error={form.formState.errors.hardTPS?.message}
            >
              <Input
                id="guard-hard-tps"
                type="number"
                min={1}
                max={10000}
                step="any"
                {...form.register("hardTPS", { valueAsNumber: true })}
              />
            </PolicyField>
            <PolicyField
              id="guard-soft-strikes"
              label={t("qualityGuard.consecutiveSoft")}
              error={form.formState.errors.consecutiveSoft?.message}
            >
              <Input
                id="guard-soft-strikes"
                type="number"
                min={1}
                max={20}
                {...form.register("consecutiveSoft", { valueAsNumber: true })}
              />
            </PolicyField>
            <PolicyField
              id="guard-error-strikes"
              label={t("qualityGuard.consecutiveErrors")}
              error={form.formState.errors.consecutiveErrors?.message}
            >
              <Input
                id="guard-error-strikes"
                type="number"
                min={1}
                max={20}
                {...form.register("consecutiveErrors", { valueAsNumber: true })}
              />
            </PolicyField>
            <PolicyField
              id="guard-quarantine-seconds"
              label={t("qualityGuard.quarantineSeconds")}
              error={form.formState.errors.quarantineSeconds?.message}
            >
              <Input
                id="guard-quarantine-seconds"
                type="number"
                min={30}
                max={86400}
                step={30}
                {...form.register("quarantineSeconds", { valueAsNumber: true })}
              />
            </PolicyField>
            <PolicyField
              id="guard-minimum-nodes"
              label={t("qualityGuard.minimumNodes")}
              error={form.formState.errors.minHealthyNodes?.message}
            >
              <Input
                id="guard-minimum-nodes"
                type="number"
                min={1}
                max={nodeCount}
                {...form.register("minHealthyNodes", { valueAsNumber: true, max: nodeCount })}
              />
            </PolicyField>
          </div>
          {thresholdsInvalid ? (
            <p className="text-xs text-destructive">{t("qualityGuard.softThresholdMustBeLower")}</p>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="ghost" size="sm" onClick={resetDefaults}>
              <RotateCcw />
              {t("qualityGuard.restoreDefaults")}
            </Button>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={mutation.isPending}>
                {t("common.save")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PolicyField({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error: string | undefined;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && error !== "softThresholdMustBeLower" ? (
        <p className="text-xs text-destructive">{t("qualityGuard.invalidPolicyValue")}</p>
      ) : null}
    </div>
  );
}

function policyFromStatus(status: QualityGuardStatus): QualityGuardPolicy {
  const config = status.config;
  if (!config) return DEFAULT_POLICY;
  return {
    mode: config.mode,
    activeIntervalSeconds: config.active_interval_seconds,
    passivePollSeconds: config.passive_poll_seconds,
    softTPS: config.soft_tps,
    hardTPS: config.hard_tps,
    consecutiveSoft: config.consecutive_soft,
    consecutiveErrors: config.consecutive_errors,
    quarantineSeconds: config.quarantine_seconds,
    minHealthyNodes: config.min_healthy_nodes,
  };
}
