import { Code2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useParams } from "react-router-dom";

import { DocsSection } from "@/features/docs/api-docs-blocks";
import { ExamplePanel } from "@/features/docs/api-docs-example-panel";
import {
  ApiDocsConnectionSection,
  ApiDocsHeader,
  ApiDocsNotesSection,
  ApiDocsParametersSection,
} from "@/features/docs/api-docs-sections";
import {
  endpoints,
  type EndpointDefinition,
  type ExampleLanguage,
  type ExampleView,
} from "@/features/docs/endpoint-definitions";
import { useApiDocsExample } from "@/features/docs/use-api-docs-example";

/**
 * API 文档页：解析路由参数后渲染对应端点文档。
 * 未知端点保持原有重定向语义（回落到 chat/completions）。
 */
export function ApiDocsPage() {
  const { category, endpoint } = useParams();
  const definition = endpoints[`${category ?? ""}/${endpoint ?? ""}`];
  if (!definition) return <Navigate to="/docs/chat/completions" replace />;
  return <ApiDocsContent definition={definition} />;
}

/** 示例语言/视图/模型选择状态由本组件持有；查询与示例代码生成在 useApiDocsExample。 */
function ApiDocsContent({ definition }: { definition: EndpointDefinition }) {
  const { t } = useTranslation();
  const [language, setLanguage] = useState<ExampleLanguage>("curl");
  const [exampleView, setExampleView] = useState<ExampleView>("request");
  const [selectedModel, setSelectedModel] = useState("");
  const example = useApiDocsExample(definition, selectedModel);

  return (
    <div className="w-full space-y-10">
      <ApiDocsHeader definition={definition} />
      <div className="space-y-10">
        <ApiDocsConnectionSection definition={definition} baseUrl={example.baseUrl} />
        <ApiDocsParametersSection definition={definition} />
        <DocsSection icon={<Code2 />} title={t("docs.reference.example")}>
          <ExamplePanel
            view={exampleView}
            onViewChange={setExampleView}
            language={language}
            onLanguageChange={setLanguage}
            code={exampleView === "request" ? example.examples[language] : example.responseExample}
            models={example.models}
            selectedModel={example.exampleModel}
            onModelChange={setSelectedModel}
          />
        </DocsSection>
        <ApiDocsNotesSection definition={definition} />
      </div>
    </div>
  );
}
