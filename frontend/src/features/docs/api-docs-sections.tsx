import { Braces, Info, Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ConnectionItem, DocsSection, EndpointSignature, ParameterTable } from "@/features/docs/api-docs-blocks";
import type { EndpointDefinition } from "@/features/docs/endpoint-definitions";

/** 端点标题、描述与签名。 */
export function ApiDocsHeader({ definition }: { definition: EndpointDefinition }) {
  const { t } = useTranslation();
  return (
    <header className="space-y-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-medium text-foreground">{definition.title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t(definition.descriptionKey)}</p>
      </div>
      <EndpointSignature method={definition.method} path={`/v1${definition.path}`} />
    </header>
  );
}

/** 连接信息：服务地址与鉴权头（Anthropic Messages 额外展示版本头）。 */
export function ApiDocsConnectionSection({ definition, baseUrl }: { definition: EndpointDefinition; baseUrl: string }) {
  const { t } = useTranslation();
  const isMessagesEndpoint = definition.key === "chat/messages";
  return (
    <DocsSection icon={<Link2 />} title={t("docs.reference.connection")}>
      <div className="grid gap-4 sm:grid-cols-2" data-testid="docs-connection">
        <ConnectionItem label={t("docs.baseUrl")} value={baseUrl} />
        <ConnectionItem
          label={t("docs.authentication")}
          value={isMessagesEndpoint ? "x-api-key: g2a_..." : "Authorization: Bearer g2a_..."}
        />
        {isMessagesEndpoint ? <ConnectionItem label="anthropic-version" value="2023-06-01" /> : null}
      </div>
    </DocsSection>
  );
}

/** 请求参数或路径参数表。 */
export function ApiDocsParametersSection({ definition }: { definition: EndpointDefinition }) {
  const { t } = useTranslation();
  return (
    <DocsSection
      icon={<Braces />}
      title={definition.method === "GET" ? t("docs.reference.pathParameters") : t("docs.reference.requestBody")}
    >
      <ParameterTable fields={definition.fields} />
    </DocsSection>
  );
}

/** 端点备注；无备注时不渲染该分区。 */
export function ApiDocsNotesSection({ definition }: { definition: EndpointDefinition }) {
  const { t } = useTranslation();
  if (definition.noteKeys.length === 0) return null;
  return (
    <DocsSection icon={<Info />} title={t("docs.reference.notes")}>
      <ul
        className="space-y-2 rounded-md bg-secondary/35 px-4 py-3 text-xs leading-5 text-muted-foreground"
        data-testid="docs-notes"
      >
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
  );
}
