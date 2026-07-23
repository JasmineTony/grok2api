import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ModelRouteDTO } from "@/entities/model/types";
import {
  type ExampleLanguage,
  exampleLanguages,
  type ExampleView,
  type FieldDefinition,
  type Method,
} from "@/features/docs/api-docs-model";
import { CopyButton } from "@/shared/components/copy-button";
import { cn } from "@/shared/lib/cn";

export function MethodLabel({ method }: { method: Method }) {
  return (
    <span
      className={cn(
        "font-mono text-xs font-semibold",
        method === "GET"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-sky-600 dark:text-sky-400",
      )}
    >
      {method}
    </span>
  );
}

export function EndpointSignature({ method, path }: { method: Method; path: string }) {
  return (
    <div className="flex h-8 w-fit max-w-full items-center gap-2 rounded-md bg-card px-3">
      <MethodLabel method={method} />
      <code className="min-w-0 truncate text-xs" title={path}>
        {path}
      </code>
      <CopyButton value={path} />
    </div>
  );
}

export function DocsSection({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3.5">
      <div className="flex items-center gap-2 text-sm font-medium [&_svg]:size-4 [&_svg]:text-muted-foreground">
        {icon}
        {title}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function ConnectionItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-xs text-muted-foreground">{label}</div>
      <div className="flex h-8 min-w-0 items-center rounded-md bg-secondary/55 pl-3 pr-0.5">
        <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={value}>
          {value}
        </code>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

export function ParameterItem({ field, muted }: { field: FieldDefinition; muted: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-1.5 px-4 py-3 sm:grid-cols-[minmax(120px,180px)_minmax(0,1fr)] sm:gap-5",
        muted && "bg-secondary/20",
      )}
    >
      <div className="min-w-0">
        <code className="break-all text-xs font-medium text-foreground">
          {field.name}
          {field.required ? (
            <span className="ml-1 text-destructive" title={t("docs.reference.required")}>
              *
            </span>
          ) : null}
        </code>
      </div>
      <div className="min-w-0 text-xs leading-5 text-muted-foreground">
        {t(field.descriptionKey)}
      </div>
    </div>
  );
}

export function ExamplePanel({
  view,
  onViewChange,
  language,
  onLanguageChange,
  code,
  models,
  selectedModel,
  onModelChange,
}: {
  view: ExampleView;
  onViewChange: (view: ExampleView) => void;
  language: ExampleLanguage;
  onLanguageChange: (language: ExampleLanguage) => void;
  code: string;
  models: ModelRouteDTO[];
  selectedModel: string;
  onModelChange: (model: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="overflow-hidden rounded-lg bg-card">
      <div className="flex min-h-12 flex-wrap items-center gap-2 px-3 py-2">
        <Tabs value={view} onValueChange={(value) => onViewChange(value as ExampleView)}>
          <TabsList>
            <TabsTrigger value="request">{t("docs.reference.request")}</TabsTrigger>
            <TabsTrigger value="response">{t("docs.reference.response")}</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          {view === "request" ? (
            <Select
              value={language}
              onValueChange={(value) => onLanguageChange(value as ExampleLanguage)}
            >
              <SelectTrigger
                className="h-8 w-28 bg-background text-xs"
                aria-label={t("docs.exampleLanguage")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {exampleLanguages.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item === "javascript" ? "JavaScript" : item === "python" ? "Python" : "cURL"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {models.length > 0 ? (
            <Select value={selectedModel} onValueChange={onModelChange}>
              <SelectTrigger
                className="h-8 w-[190px] max-w-full bg-background text-xs"
                aria-label={t("docs.reference.exampleModel")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => (
                  <SelectItem key={model.id} value={model.publicId}>
                    {model.publicId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <CopyButton value={code} />
        </div>
      </div>

      <pre className="max-h-[480px] overflow-auto bg-secondary/45 p-4 text-xs leading-5 text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}
