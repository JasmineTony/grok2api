import { useTranslation } from "react-i18next";

import type { ModelRouteDTO } from "@/entities/model/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { exampleLanguages, type ExampleLanguage, type ExampleView } from "@/features/docs/endpoint-definitions";
import { CopyButton } from "@/shared/components/copy-button";

type ExamplePanelProps = {
  view: ExampleView;
  onViewChange: (view: ExampleView) => void;
  language: ExampleLanguage;
  onLanguageChange: (language: ExampleLanguage) => void;
  code: string;
  models: ModelRouteDTO[];
  selectedModel: string;
  onModelChange: (model: string) => void;
};

/** 请求/响应示例：视图切换、语言与示例模型选择、复制与代码块。 */
export function ExamplePanel(props: ExamplePanelProps) {
  return (
    <div className="overflow-hidden rounded-lg bg-card" data-testid="docs-example-panel">
      <ExampleToolbar {...props} />
      <pre
        className="max-h-[480px] overflow-auto bg-secondary/45 p-4 text-xs leading-5 text-foreground"
        data-testid="docs-example-code"
      >
        <code>{props.code}</code>
      </pre>
    </div>
  );
}

function ExampleToolbar({
  view,
  onViewChange,
  language,
  onLanguageChange,
  code,
  models,
  selectedModel,
  onModelChange,
}: ExamplePanelProps) {
  return (
    <div className="flex min-h-12 flex-wrap items-center gap-2 px-3 py-2">
      <ExampleViewTabs view={view} onViewChange={onViewChange} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
        {view === "request" ? <ExampleLanguageSelect language={language} onLanguageChange={onLanguageChange} /> : null}
        {models.length > 0 ? (
          <ExampleModelSelect models={models} selectedModel={selectedModel} onModelChange={onModelChange} />
        ) : null}
        <CopyButton value={code} />
      </div>
    </div>
  );
}

function ExampleViewTabs({ view, onViewChange }: { view: ExampleView; onViewChange: (view: ExampleView) => void }) {
  const { t } = useTranslation();
  return (
    <Tabs value={view} onValueChange={(value) => onViewChange(value as ExampleView)}>
      <TabsList>
        <TabsTrigger value="request">{t("docs.reference.request")}</TabsTrigger>
        <TabsTrigger value="response">{t("docs.reference.response")}</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

function ExampleLanguageSelect({
  language,
  onLanguageChange,
}: {
  language: ExampleLanguage;
  onLanguageChange: (language: ExampleLanguage) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select value={language} onValueChange={(value) => onLanguageChange(value as ExampleLanguage)}>
      <SelectTrigger
        className="h-8 w-28 bg-background text-xs"
        aria-label={t("docs.exampleLanguage")}
        data-testid="docs-example-language"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {exampleLanguages.map((item) => (
          <SelectItem key={item} value={item}>
            {exampleLanguageLabel(item)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function exampleLanguageLabel(language: ExampleLanguage): string {
  if (language === "javascript") return "JavaScript";
  if (language === "python") return "Python";
  return "cURL";
}

function ExampleModelSelect({
  models,
  selectedModel,
  onModelChange,
}: {
  models: ModelRouteDTO[];
  selectedModel: string;
  onModelChange: (model: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select value={selectedModel} onValueChange={onModelChange}>
      <SelectTrigger
        className="h-8 w-[190px] max-w-full bg-background text-xs"
        aria-label={t("docs.reference.exampleModel")}
        data-testid="docs-example-model"
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
  );
}
