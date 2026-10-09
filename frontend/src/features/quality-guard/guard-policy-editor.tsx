import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { useForm, useWatch, type UseFormReturn } from "react-hook-form";
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
import {
  updateQualityGuardPolicy,
  type QualityGuardPolicy,
  type QualityGuardStatus,
} from "@/features/quality-guard/quality-guard-api";
import { cn } from "@/shared/lib/cn";

// 策略编辑弹窗：从 quality-guard-page.tsx 拆出。schema、默认值、热加载失效语义（立即 + 1.5s 后各一次）保持不变。

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
  .refine((value) => value.softTPS < value.hardTPS, { path: ["hardTPS"], message: "softThresholdMustBeLower" });

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

type PolicyNumberKey =
  | "activeIntervalSeconds"
  | "passivePollSeconds"
  | "softTPS"
  | "hardTPS"
  | "consecutiveSoft"
  | "consecutiveErrors"
  | "quarantineSeconds"
  | "minHealthyNodes";

type PolicyNumberFieldSpec = {
  id: string;
  label: string;
  name: PolicyNumberKey;
  min: number;
  max: number;
  step?: number | "any";
  registerMax?: boolean;
};

function policyNumberFieldSpecs(t: TFunction, nodeCount: number): PolicyNumberFieldSpec[] {
  return [
    {
      id: "guard-active-interval",
      label: t("qualityGuard.activeIntervalSeconds"),
      name: "activeIntervalSeconds",
      min: 60,
      max: 86400,
      step: 60,
    },
    {
      id: "guard-passive-interval",
      label: t("qualityGuard.passiveIntervalSeconds"),
      name: "passivePollSeconds",
      min: 1,
      max: 300,
    },
    { id: "guard-soft-tps", label: t("qualityGuard.softThreshold"), name: "softTPS", min: 1, max: 10000, step: "any" },
    { id: "guard-hard-tps", label: t("qualityGuard.hardThreshold"), name: "hardTPS", min: 1, max: 10000, step: "any" },
    { id: "guard-soft-strikes", label: t("qualityGuard.consecutiveSoft"), name: "consecutiveSoft", min: 1, max: 20 },
    {
      id: "guard-error-strikes",
      label: t("qualityGuard.consecutiveErrors"),
      name: "consecutiveErrors",
      min: 1,
      max: 20,
    },
    {
      id: "guard-quarantine-seconds",
      label: t("qualityGuard.quarantineSeconds"),
      name: "quarantineSeconds",
      min: 30,
      max: 86400,
      step: 30,
    },
    {
      id: "guard-minimum-nodes",
      label: t("qualityGuard.minimumNodes"),
      name: "minHealthyNodes",
      min: 1,
      max: nodeCount,
      registerMax: true,
    },
  ];
}

function PolicyField({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
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

function PolicyNumberField({ spec, form }: { spec: PolicyNumberFieldSpec; form: UseFormReturn<QualityGuardPolicy> }) {
  const rules = spec.registerMax ? { valueAsNumber: true, max: spec.max } : { valueAsNumber: true };
  return (
    <PolicyField id={spec.id} label={spec.label} error={form.formState.errors[spec.name]?.message}>
      <Input
        id={spec.id}
        type="number"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        data-testid={spec.id}
        {...form.register(spec.name, rules)}
      />
    </PolicyField>
  );
}

function PolicyModePicker({
  mode,
  onModeChange,
}: {
  mode: QualityGuardPolicy["mode"];
  onModeChange: (mode: QualityGuardPolicy["mode"]) => void;
}) {
  const { t } = useTranslation();
  return (
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
            onClick={() => onModeChange(value)}
            className={cn(
              "h-8 rounded-sm px-2 text-xs text-muted-foreground transition-colors",
              mode === value && "bg-background font-medium text-foreground shadow-sm",
            )}
            data-testid={`guard-policy-mode-${value}`}
          >
            {t(`qualityGuard.modes.${value}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

// 表单状态、校验与热加载失效集中在这里，弹窗组件只负责结构。
function useGuardPolicyForm(status: QualityGuardStatus, onSaved: () => void) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const nodeCount = status.config?.node_ids.length ?? 1;
  const form = useForm<QualityGuardPolicy>({
    resolver: zodResolver(policySchema),
    defaultValues: policyFromStatus(status),
  });
  const mode = useWatch({ control: form.control, name: "mode" });
  const softTPS = useWatch({ control: form.control, name: "softTPS" });
  const hardTPS = useWatch({ control: form.control, name: "hardTPS" });
  const mutation = useMutation({
    mutationFn: updateQualityGuardPolicy,
    onSuccess: () => {
      toast.success(t("qualityGuard.policySaved"));
      onSaved();
      void queryClient.invalidateQueries({ queryKey: ["quality-guard"] });
      window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["quality-guard"] }), 1_500);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("errors.generic")),
  });
  return {
    form,
    nodeCount,
    mode,
    thresholdsInvalid: Number.isFinite(softTPS) && Number.isFinite(hardTPS) && softTPS >= hardTPS,
    mutation,
    setMode: (value: QualityGuardPolicy["mode"]) =>
      form.setValue("mode", value, { shouldDirty: true, shouldValidate: true }),
    resetDefaults: () =>
      form.reset({ ...DEFAULT_POLICY, minHealthyNodes: Math.min(DEFAULT_POLICY.minHealthyNodes, nodeCount) }),
  };
}

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
  const editor = useGuardPolicyForm(status, () => onOpenChange(false));
  const { form, mode, setMode, mutation, resetDefaults, nodeCount } = editor;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" data-testid="guard-policy-editor">
        <DialogHeader>
          <DialogTitle>{t("qualityGuard.editPolicyTitle")}</DialogTitle>
          <DialogDescription>{t("qualityGuard.editPolicyDescription")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={form.handleSubmit((value) => mutation.mutate(value))}>
          <PolicyModePicker mode={mode} onModeChange={setMode} />
          <div className="grid gap-4 sm:grid-cols-2">
            {policyNumberFieldSpecs(t, nodeCount).map((spec) => (
              <PolicyNumberField key={spec.id} spec={spec} form={form} />
            ))}
          </div>
          {editor.thresholdsInvalid ? (
            <p className="text-xs text-destructive">{t("qualityGuard.softThresholdMustBeLower")}</p>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="ghost" size="sm" onClick={resetDefaults} data-testid="guard-policy-reset">
              <RotateCcw />
              {t("qualityGuard.restoreDefaults")}
            </Button>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={mutation.isPending} data-testid="guard-policy-save">
                {t("common.save")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
