import { useQuery } from "@tanstack/react-query";
import { Braces, Code2, Info, Link2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useParams } from "react-router-dom";

import { listModels } from "@/entities/model/model-api";
import { getSystemInfo } from "@/entities/system/system-api";
import {
  ConnectionItem,
  DocsSection,
  EndpointSignature,
  ExamplePanel,
  ParameterItem,
} from "@/features/docs/api-docs-components";
import {
  createExamples,
  endpoints,
  fallbackModel,
  type ExampleLanguage,
  type ExampleView,
  withExampleModel,
} from "@/features/docs/api-docs-model";
import { useApiClient } from "@/shared/api/use-api-client";
import { runtimeConfig } from "@/shared/config/runtime-config";

export function ApiDocsPage() {
  const { t } = useTranslation();
  const apiClient = useApiClient();
  const { category, endpoint } = useParams();
  const definition = endpoints[`${category ?? ""}/${endpoint ?? ""}`];
  const [language, setLanguage] = useState<ExampleLanguage>("curl");
  const [exampleView, setExampleView] = useState<ExampleView>("request");
  const [selectedModel, setSelectedModel] = useState("");

  const systemQuery = useQuery({
    queryKey: ["system-info"],
    queryFn: () => getSystemInfo(apiClient),
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });
  const modelsQuery = useQuery({
    queryKey: ["docs", "available-models"],
    queryFn: () => listModels(apiClient, { page: 1, pageSize: 100 }),
    staleTime: 30_000,
  });

  if (!definition) return <Navigate to="/docs/chat/completions" replace />;

  const publicApiBaseUrl = systemQuery.data?.publicApiBaseURL || runtimeConfig.publicApiBaseUrl;
  const baseUrl = `${publicApiBaseUrl.replace(/\/$/, "")}/v1`;
  const availableModels = (modelsQuery.data?.items ?? []).filter(
    (model) =>
      model.enabled && model.available && definition.capabilities.includes(model.capability),
  );
  const selectedModelAvailable = availableModels.some((model) => model.publicId === selectedModel);
  const exampleModel =
    (selectedModelAvailable ? selectedModel : availableModels[0]?.publicId) ||
    fallbackModel(definition.key);
  const examples = createExamples(definition, baseUrl, exampleModel);
  const responseExample = JSON.stringify(
    withExampleModel(definition.response, exampleModel),
    null,
    2,
  );

  return (
    <div className="w-full space-y-10">
      <header className="space-y-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-medium text-foreground">{definition.title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {t(definition.descriptionKey)}
          </p>
        </div>
        <EndpointSignature method={definition.method} path={`/v1${definition.path}`} />
      </header>

      <div className="space-y-10">
        <DocsSection icon={<Link2 />} title={t("docs.reference.connection")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <ConnectionItem label={t("docs.baseUrl")} value={baseUrl} />
            <ConnectionItem
              label={t("docs.authentication")}
              value={
                definition.key === "chat/messages"
                  ? "x-api-key: g2a_..."
                  : "Authorization: Bearer g2a_..."
              }
            />
            {definition.key === "chat/messages" ? (
              <ConnectionItem label="anthropic-version" value="2023-06-01" />
            ) : null}
          </div>
        </DocsSection>

        <DocsSection
          icon={<Braces />}
          title={
            definition.method === "GET"
              ? t("docs.reference.pathParameters")
              : t("docs.reference.requestBody")
          }
        >
          <div className="overflow-hidden rounded-md bg-card">
            <div className="hidden grid-cols-[minmax(120px,180px)_minmax(0,1fr)] gap-5 bg-secondary/35 px-4 py-2 text-xs text-muted-foreground sm:grid">
              <span>{t("docs.reference.parameter")}</span>
              <span>{t("docs.reference.description")}</span>
            </div>
            <div>
              {definition.fields.map((field, index) => (
                <ParameterItem key={field.name} field={field} muted={index % 2 === 1} />
              ))}
            </div>
          </div>
        </DocsSection>

        <DocsSection icon={<Code2 />} title={t("docs.reference.example")}>
          <ExamplePanel
            view={exampleView}
            onViewChange={setExampleView}
            language={language}
            onLanguageChange={setLanguage}
            code={exampleView === "request" ? examples[language] : responseExample}
            models={availableModels}
            selectedModel={exampleModel}
            onModelChange={setSelectedModel}
          />
        </DocsSection>

        {definition.noteKeys.length > 0 ? (
          <DocsSection icon={<Info />} title={t("docs.reference.notes")}>
            <ul className="space-y-2 rounded-md bg-secondary/35 px-4 py-3 text-xs leading-5 text-muted-foreground">
              {definition.noteKeys.map((key) => (
                <li
                  key={key}
                  className="relative pl-3 before:absolute before:left-0 before:top-[0.55rem] before:size-1 before:rounded-full before:bg-muted-foreground/55"
                >
                  {t(key)}
                </li>
              ))}
            </ul>
          </DocsSection>
        ) : null}
      </div>
    </div>
  );
}
