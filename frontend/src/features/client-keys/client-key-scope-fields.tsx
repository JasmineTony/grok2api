import { useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { ChevronDown, CircleHelp } from "lucide-react";
import { useState } from "react";
import { Controller, useWatch, type UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { listModels } from "@/entities/model/model-api";
import type { ProviderScopeValue, TierScopeValue } from "@/features/client-keys/client-keys-api";
import type { ClientKeyFormValues } from "@/features/client-keys/client-key-form-schema";
import { ModelOptionsPanel } from "@/features/client-keys/client-key-model-options";
import { ScopeDropdown } from "@/features/client-keys/client-key-scope-select";
import {
  modelScopeSummary,
  providerScopeSummary,
  providerScopeValues,
  tierScopeSummary,
  tierScopeValues,
} from "@/features/client-keys/client-key-scope-summary";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";

const MODEL_OPTIONS_PAGE_SIZE = 50;

type FormProps = { form: UseFormReturn<ClientKeyFormValues> };
type SetPage = (page: number) => void;

/**
 * 账号/模型范围选择区：provider、tier、模型范围模式与受限模型列表。
 * 范围变化会重置模型列表页码；受限模式下已选模型会被清空并提示。
 */
export function ClientKeyScopeFields({ form }: FormProps) {
  const { t } = useTranslation();
  const modelScopeMode = useWatch({ control: form.control, name: "modelScopeMode" });
  const providerScope = useWatch({ control: form.control, name: "providerScope" });
  const tierScope = useWatch({ control: form.control, name: "tierScope" });
  const selectedModels = useWatch({ control: form.control, name: "allowedModelIds" });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const restricted = modelScopeMode === "restricted";
  const scopeChange = () => applyScopeChange({ form, t, restricted, selectedModels, setPage });
  const modeChange = (value: string) => applyModeChange(form, setPage, value);

  return (
    <div className="overflow-hidden rounded-lg border" data-testid="client-keys-scope-fields">
      <div className="divide-y">
        <ProviderScopeRow form={form} summary={providerScopeSummary(t, providerScope)} onScopeChange={scopeChange} />
        <TierScopeRow form={form} summary={tierScopeSummary(t, tierScope)} onScopeChange={scopeChange} />
        <ModelScopeRow
          form={form}
          summary={modelScopeSummary(t, modelScopeMode, selectedModels.length)}
          onModeChange={modeChange}
        />
      </div>
      <RestrictedModelOptions
        enabled={restricted}
        form={form}
        page={page}
        search={search}
        providerScope={providerScopeValues(providerScope)}
        tierScope={tierScopeValues(tierScope)}
        onPageChange={setPage}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
      />
    </div>
  );
}

type ScopeChangeContext = {
  form: UseFormReturn<ClientKeyFormValues>;
  t: TFunction;
  restricted: boolean;
  selectedModels: string[];
  setPage: SetPage;
};

/** provider/tier 范围变化：重置模型列表页码，受限模式下清空已选模型并提示。 */
function applyScopeChange({ form, t, restricted, selectedModels, setPage }: ScopeChangeContext): void {
  setPage(1);
  if (!restricted || selectedModels.length === 0) return;
  form.setValue("allowedModelIds", [], { shouldDirty: true, shouldValidate: true });
  toast.info(t("keys.modelsClearedForScopeChange"));
}

/** 模型范围模式切换：重置页码；切回「全部模型」时清空已选并清除校验错误。 */
function applyModeChange(form: UseFormReturn<ClientKeyFormValues>, setPage: SetPage, value: string): void {
  setPage(1);
  if (value !== "all") return;
  form.setValue("allowedModelIds", [], { shouldDirty: true, shouldValidate: true });
  form.clearErrors("allowedModelIds");
}

type RestrictedModelOptionsProps = {
  enabled: boolean;
  form: UseFormReturn<ClientKeyFormValues>;
  page: number;
  search: string;
  providerScope: Exclude<ProviderScopeValue, "all">[];
  tierScope: Exclude<TierScopeValue, "all">[];
  onPageChange: SetPage;
  onSearchChange: (value: string) => void;
};

/**
 * 受限模型列表容器：始终保持挂载，让 models 查询的启用/缓存语义与原实现一致；
 * 非受限模式只返回 null，不渲染列表。
 */
function RestrictedModelOptions({
  enabled,
  form,
  page,
  search,
  providerScope,
  tierScope,
  onPageChange,
  onSearchChange,
}: RestrictedModelOptionsProps) {
  const debouncedSearch = useDebouncedValue(search);
  const modelsQuery = useQuery({
    queryKey: ["models", "options", page, debouncedSearch, providerScope.join(","), tierScope.join(",")],
    queryFn: () =>
      listModels({
        page,
        pageSize: MODEL_OPTIONS_PAGE_SIZE,
        search: debouncedSearch,
        providerScope,
        tierScope,
      }),
    enabled,
  });

  if (!enabled) return null;
  return (
    <ModelOptionsPanel
      form={form}
      query={modelsQuery}
      search={search}
      onSearchChange={onSearchChange}
      onPageChange={onPageChange}
    />
  );
}

type ScopeRowProps = FormProps & { summary: string; onScopeChange: () => void };

function ProviderScopeRow({ form, summary, onScopeChange }: ScopeRowProps) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-12 items-center gap-3 px-3">
      <Label className="shrink-0">{t("keys.providerScope")}</Label>
      <Controller
        control={form.control}
        name="providerScope"
        render={({ field }) => (
          <ScopeDropdown
            testId="client-keys-form-provider-scope"
            ariaLabel={t("keys.providerScope")}
            summary={summary}
            value={field.value}
            onChange={(value) => {
              field.onChange(value);
              onScopeChange();
            }}
            normalizeAllWhenComplete
            options={[
              { value: "grok_build", label: "Build" },
              { value: "grok_web", label: "Web" },
              { value: "grok_console", label: "Console" },
            ]}
          />
        )}
      />
    </div>
  );
}

function TierScopeRow({ form, summary, onScopeChange }: ScopeRowProps) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-12 items-center gap-3 px-3">
      <div className="flex shrink-0 items-center gap-1.5">
        <Label>{t("keys.tierScope")}</Label>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label={t("keys.accountScopeDescription")}
              data-testid="client-keys-form-tier-help"
            >
              <CircleHelp className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-80 leading-relaxed">{t("keys.accountScopeDescription")}</TooltipContent>
        </Tooltip>
      </div>
      <Controller
        control={form.control}
        name="tierScope"
        render={({ field }) => (
          <ScopeDropdown
            testId="client-keys-form-tier-scope"
            ariaLabel={t("keys.tierScope")}
            summary={summary}
            value={field.value}
            onChange={(value) => {
              field.onChange(value);
              onScopeChange();
            }}
            allLabel={t("keys.allTiersIncludingUnknown")}
            options={[
              { value: "free", label: "Free" },
              { value: "super", label: "Super" },
            ]}
          />
        )}
      />
    </div>
  );
}

type ModelScopeRowProps = FormProps & { summary: string; onModeChange: (value: string) => void };

function ModelScopeRow({ form, summary, onModeChange }: ModelScopeRowProps) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-12 items-center gap-3 px-3">
      <Label className="shrink-0">{t("keys.modelScope")}</Label>
      <Controller
        control={form.control}
        name="modelScopeMode"
        render={({ field }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto h-8 min-w-0 max-w-[70%] justify-end gap-1.5 px-2 font-normal"
                aria-label={t("keys.modelScope")}
                data-testid="client-keys-form-model-scope"
              >
                <span className="truncate">{summary}</span>
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuRadioGroup
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value);
                  onModeChange(value);
                }}
              >
                <DropdownMenuRadioItem value="all">{t("keys.allModels")}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="restricted">{t("keys.restrictedModels")}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />
    </div>
  );
}
