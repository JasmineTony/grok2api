import type { ModelRouteDTO } from "@/entities/model/types";
import type { EndpointDefinition, ExampleLanguage } from "@/features/docs/endpoint-definitions";

/** 按公网 publicId 去重，保持接口返回顺序。 */
export function uniqueModelsByPublicID(models: readonly ModelRouteDTO[]): ModelRouteDTO[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.publicId)) return false;
    seen.add(model.publicId);
    return true;
  });
}

/** 当前端点可用的示例模型：启用、可用且能力与端点匹配。 */
export function selectDocsModels(definition: EndpointDefinition, models: readonly ModelRouteDTO[]): ModelRouteDTO[] {
  return uniqueModelsByPublicID(
    models.filter((model) => model.enabled && model.available && definition.capabilities.includes(model.capability)),
  );
}

/** 示例模型：优先使用仍可用的选择，否则回退到端点默认模型。 */
export function selectExampleModel(
  definition: EndpointDefinition,
  models: readonly ModelRouteDTO[],
  selected: string,
): string {
  if (models.some((model) => model.publicId === selected)) return selected;
  return models[0]?.publicId || fallbackModel(definition.key);
}

export function withExampleModel(response: Record<string, unknown>, model: string): Record<string, unknown> {
  return "model" in response ? { ...response, model } : response;
}

export function fallbackModel(key: string): string {
  if (key.startsWith("image/")) return key === "image/edits" ? "grok-imagine-image-edit" : "grok-imagine-image-lite";
  if (key.startsWith("video/")) return "grok-imagine-video";
  if (key.startsWith("voice/")) {
    if (key === "voice/stt" || key === "voice/audio-transcriptions") return "grok-stt";
    return "grok-voice-latest";
  }
  return "your-enabled-model";
}

export function createExamples(
  definition: EndpointDefinition,
  baseUrl: string,
  model: string,
): Record<ExampleLanguage, string> {
  const request = definition.request(model);
  const path = definition.path.replace("{request_id}", "video_example");
  const url =
    definition.key === "voice/realtime"
      ? `${baseUrl}${path}?model=${encodeURIComponent(model)}`
      : definition.key === "voice/voices"
        ? `${baseUrl}${path}?model=${encodeURIComponent(model)}`
        : `${baseUrl}${path}`;
  const messageHeaders = definition.key === "chat/messages";
  const curlHeaders = messageHeaders
    ? [
        '  -H "x-api-key: $GROK2API_API_KEY"',
        '  -H "anthropic-version: 2023-06-01"',
        '  -H "Content-Type: application/json"',
      ].join(" \\\n")
    : ['  -H "Authorization: Bearer $GROK2API_API_KEY"', '  -H "Content-Type: application/json"'].join(" \\\n");
  const curlBody = request ? ` \\\n  -d '${JSON.stringify(request, null, 2)}'` : "";
  const headers = messageHeaders
    ? { "x-api-key": "g2a_your_api_key", "anthropic-version": "2023-06-01", "Content-Type": "application/json" }
    : { Authorization: "Bearer g2a_your_api_key", "Content-Type": "application/json" };
  const pythonImports = request ? "import json\nimport requests" : "import requests";
  const pythonPayload = request ? `\n\npayload = json.loads(r'''${JSON.stringify(request, null, 2)}''')` : "";
  const pythonBody = request ? ",\n    json=payload" : "";
  const javascriptBody = request ? `,\n  body: JSON.stringify(${JSON.stringify(request, null, 2)})` : "";
  return {
    curl: `export GROK2API_API_KEY="g2a_your_api_key"\n\ncurl -X ${definition.method} "${url}" \\\n${curlHeaders}${curlBody}`,
    python: `${pythonImports}${pythonPayload}\n\nresponse = requests.${definition.method.toLowerCase()}(\n    "${url}",\n    headers=${JSON.stringify(headers, null, 2)}${pythonBody}\n)\nresponse.raise_for_status()\nprint(response.json())`,
    javascript: `const response = await fetch("${url}", {\n  method: "${definition.method}",\n  headers: ${JSON.stringify(headers, null, 2)}${javascriptBody}\n});\n\nif (!response.ok) throw new Error(await response.text());\nconsole.log(await response.json());`,
  };
}
