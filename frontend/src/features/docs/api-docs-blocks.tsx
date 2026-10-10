import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { FieldDefinition, Method } from "@/features/docs/endpoint-definitions";
import { CopyButton } from "@/shared/components/copy-button";
import { cn } from "@/shared/lib/cn";

/** 方法标签：GET 绿色、POST 蓝色，与原实现一致。 */
export function MethodLabel({ method }: { method: Method }) {
  return (
    <span
      className={cn(
        "font-mono text-xs font-semibold",
        method === "GET" ? "text-emerald-600 dark:text-emerald-400" : "text-sky-600 dark:text-sky-400",
      )}
    >
      {method}
    </span>
  );
}

/** 端点签名（方法与路径）与复制入口。 */
export function EndpointSignature({ method, path }: { method: Method; path: string }) {
  return (
    <div
      className="flex h-8 w-fit max-w-full items-center gap-2 rounded-md bg-card px-3"
      data-testid="docs-endpoint-signature"
    >
      <MethodLabel method={method} />
      <code className="min-w-0 truncate text-xs" title={path}>
        {path}
      </code>
      <CopyButton value={path} />
    </div>
  );
}

/** 文档分区：图标 + 标题 + 内容容器。 */
export function DocsSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
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

/** 连接信息条目：标签 + 可复制取值。 */
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

/** 参数表（字段名 + 说明）。 */
export function ParameterTable({ fields }: { fields: FieldDefinition[] }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-hidden rounded-md bg-card" data-testid="docs-parameter-table">
      <div className="hidden grid-cols-[minmax(120px,180px)_minmax(0,1fr)] gap-5 bg-secondary/35 px-4 py-2 text-xs text-muted-foreground sm:grid">
        <span>{t("docs.reference.parameter")}</span>
        <span>{t("docs.reference.description")}</span>
      </div>
      <div>
        {fields.map((field, index) => (
          <ParameterRow key={field.name} field={field} muted={index % 2 === 1} />
        ))}
      </div>
    </div>
  );
}

function ParameterRow({ field, muted }: { field: FieldDefinition; muted: boolean }) {
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
      <div className="min-w-0 text-xs leading-5 text-muted-foreground">{t(field.descriptionKey)}</div>
    </div>
  );
}
