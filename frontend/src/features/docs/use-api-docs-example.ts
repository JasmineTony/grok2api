import { useQuery } from "@tanstack/react-query";

import type { ModelRouteDTO } from "@/entities/model/types";
import { listModels } from "@/entities/model/model-api";
import { getSystemInfo } from "@/entities/system/system-api";
import {
  createExamples,
  selectDocsModels,
  selectExampleModel,
  withExampleModel,
} from "@/features/docs/api-docs-examples";
import type { EndpointDefinition, ExampleLanguage } from "@/features/docs/endpoint-definitions";
import { runtimeConfig } from "@/shared/config/runtime-config";

export type ApiDocsExample = {
  baseUrl: string;
  models: ModelRouteDTO[];
  exampleModel: string;
  examples: Record<ExampleLanguage, string>;
  responseExample: string;
};

/**
 * 文档示例数据：系统信息与可用模型查询、示例代码与响应样例生成。
 * 页面只持有语言/视图/模型选择状态，查询 key 与示例语义保持原实现。
 */
export function useApiDocsExample(definition: EndpointDefinition, selectedModel: string): ApiDocsExample {
  const systemQuery = useQuery({
    queryKey: ["system-info"],
    queryFn: getSystemInfo,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });
  const modelsQuery = useQuery({
    queryKey: ["docs", "available-models"],
    queryFn: () => listModels({ page: 1, pageSize: 100 }),
    staleTime: 30_000,
  });

  const publicApiBaseUrl = systemQuery.data?.publicApiBaseURL || runtimeConfig.publicApiBaseUrl;
  const baseUrl = `${publicApiBaseUrl.replace(/\/$/, "")}/v1`;
  const models = selectDocsModels(definition, modelsQuery.data?.items ?? []);
  const exampleModel = selectExampleModel(definition, models, selectedModel);

  return {
    baseUrl,
    models,
    exampleModel,
    examples: createExamples(definition, baseUrl, exampleModel),
    responseExample: JSON.stringify(withExampleModel(definition.response, exampleModel), null, 2),
  };
}
