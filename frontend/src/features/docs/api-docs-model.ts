import type { ModelRouteDTO } from "@/entities/model/types";

export type ExampleLanguage = "curl" | "python" | "javascript";
export type ExampleView = "request" | "response";
export type Method = "GET" | "POST";
export type Capability = ModelRouteDTO["capability"];

export type FieldDefinition = {
  name: string;
  required?: boolean;
  descriptionKey: string;
};

export type EndpointDefinition = {
  key: string;
  category: string;
  title: string;
  method: Method;
  path: string;
  descriptionKey: string;
  capabilities: Capability[];
  fields: FieldDefinition[];
  noteKeys: string[];
  request: (model: string) => Record<string, unknown> | undefined;
  response: Record<string, unknown>;
};

export const exampleLanguages: ExampleLanguage[] = ["curl", "python", "javascript"];

export const endpoints: Record<string, EndpointDefinition> = {
  "chat/completions": {
    key: "chat/completions",
    category: "Chat",
    title: "Chat completions",
    method: "POST",
    path: "/chat/completions",
    descriptionKey: "docs.endpointChat",
    capabilities: ["chat", "responses"],
    fields: [
      { name: "model", required: true, descriptionKey: "docs.reference.fieldModel" },
      { name: "messages", required: true, descriptionKey: "docs.reference.fieldChatMessages" },
      { name: "stream", descriptionKey: "docs.reference.fieldStream" },
      { name: "max_completion_tokens", descriptionKey: "docs.reference.fieldMaxCompletionTokens" },
      { name: "tools", descriptionKey: "docs.reference.fieldTools" },
      { name: "tool_choice", descriptionKey: "docs.reference.fieldToolChoice" },
    ],
    noteKeys: ["docs.reference.noteChatImages", "docs.reference.noteChatTools"],
    request: (model) => ({
      model,
      messages: [
        { role: "system", content: "You are a concise assistant." },
        { role: "user", content: "Explain HTTP streaming." },
      ],
      stream: false,
    }),
    response: {
      id: "chatcmpl_example",
      object: "chat.completion",
      model: "grok-chat-fast",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "HTTP streaming sends response data incrementally.",
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 24, completion_tokens: 12, total_tokens: 36 },
    },
  },
  "chat/responses": {
    key: "chat/responses",
    category: "Chat",
    title: "Responses",
    method: "POST",
    path: "/responses",
    descriptionKey: "docs.endpointResponses",
    capabilities: ["chat", "responses"],
    fields: [
      { name: "model", required: true, descriptionKey: "docs.reference.fieldModel" },
      { name: "input", required: true, descriptionKey: "docs.reference.fieldInput" },
      { name: "instructions", descriptionKey: "docs.reference.fieldInstructions" },
      { name: "stream", descriptionKey: "docs.reference.fieldStream" },
      { name: "store", descriptionKey: "docs.reference.fieldStore" },
      { name: "previous_response_id", descriptionKey: "docs.reference.fieldPreviousResponse" },
      { name: "tools", descriptionKey: "docs.reference.fieldTools" },
    ],
    noteKeys: ["docs.reference.noteResponsesState", "docs.reference.noteResponsesCompact"],
    request: (model) => ({ model, input: "Explain HTTP streaming.", store: false, stream: false }),
    response: {
      id: "resp_example",
      object: "response",
      status: "completed",
      model: "grok-chat-fast",
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            { type: "output_text", text: "HTTP streaming sends response data incrementally." },
          ],
        },
      ],
      usage: { input_tokens: 18, output_tokens: 12, total_tokens: 30 },
    },
  },
  "chat/messages": {
    key: "chat/messages",
    category: "Chat",
    title: "Messages",
    method: "POST",
    path: "/messages",
    descriptionKey: "docs.endpointMessages",
    capabilities: ["chat", "responses"],
    fields: [
      { name: "model", required: true, descriptionKey: "docs.reference.fieldModel" },
      { name: "max_tokens", required: true, descriptionKey: "docs.reference.fieldMaxTokens" },
      { name: "messages", required: true, descriptionKey: "docs.reference.fieldMessages" },
      { name: "system", descriptionKey: "docs.reference.fieldSystem" },
      { name: "stream", descriptionKey: "docs.reference.fieldStream" },
      { name: "tools", descriptionKey: "docs.reference.fieldAnthropicTools" },
      { name: "tool_choice", descriptionKey: "docs.reference.fieldToolChoice" },
    ],
    noteKeys: ["docs.reference.noteMessagesEvents", "docs.reference.noteMessagesLimits"],
    request: (model) => ({
      model,
      max_tokens: 1024,
      system: "You are a concise assistant.",
      messages: [{ role: "user", content: "Explain HTTP streaming." }],
      stream: false,
    }),
    response: {
      id: "msg_example",
      type: "message",
      role: "assistant",
      model: "grok-chat-fast",
      content: [{ type: "text", text: "HTTP streaming sends response data incrementally." }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 18, output_tokens: 12 },
    },
  },
  "image/generations": {
    key: "image/generations",
    category: "Image",
    title: "Image generations",
    method: "POST",
    path: "/images/generations",
    descriptionKey: "docs.endpointImageGeneration",
    capabilities: ["image"],
    fields: [
      { name: "model", required: true, descriptionKey: "docs.reference.fieldModel" },
      { name: "prompt", required: true, descriptionKey: "docs.reference.fieldPrompt" },
      { name: "n", descriptionKey: "docs.reference.fieldImageCount" },
      { name: "aspect_ratio", descriptionKey: "docs.reference.fieldAspectRatio" },
      { name: "resolution", descriptionKey: "docs.reference.fieldResolution" },
      { name: "response_format", descriptionKey: "docs.reference.fieldResponseFormat" },
      { name: "stream", descriptionKey: "docs.reference.fieldImageStream" },
    ],
    noteKeys: ["docs.reference.noteImageCount", "docs.reference.noteImageStorage"],
    request: (model) => ({
      model,
      prompt: "A minimal red chair in a bright studio",
      n: 1,
      response_format: "url",
    }),
    response: {
      created: 1783860000,
      data: [{ url: "http://127.0.0.1:8000/v1/media/images/example" }],
    },
  },
  "image/edits": {
    key: "image/edits",
    category: "Image",
    title: "Image edits",
    method: "POST",
    path: "/images/edits",
    descriptionKey: "docs.endpointImageEdit",
    capabilities: ["image_edit"],
    fields: [
      { name: "model", required: true, descriptionKey: "docs.reference.fieldModel" },
      { name: "prompt", required: true, descriptionKey: "docs.reference.fieldPrompt" },
      { name: "image / images", required: true, descriptionKey: "docs.reference.fieldEditImages" },
      { name: "n", descriptionKey: "docs.reference.fieldImageCount" },
      { name: "response_format", descriptionKey: "docs.reference.fieldResponseFormat" },
    ],
    noteKeys: [
      "docs.reference.noteEditJSON",
      "docs.reference.noteEditSources",
      "docs.reference.noteImageStorage",
    ],
    request: (model) => ({
      model,
      prompt: "Change the chair to black",
      image: { url: "https://example.com/chair.png" },
      n: 1,
      response_format: "url",
    }),
    response: {
      created: 1783860000,
      data: [{ url: "http://127.0.0.1:8000/v1/media/images/example" }],
    },
  },
  "video/generations": {
    key: "video/generations",
    category: "Video",
    title: "Video generations",
    method: "POST",
    path: "/videos/generations",
    descriptionKey: "docs.endpointVideoCreate",
    capabilities: ["video"],
    fields: [
      { name: "model", required: true, descriptionKey: "docs.reference.fieldModel" },
      { name: "prompt", descriptionKey: "docs.reference.fieldVideoPrompt" },
      { name: "duration", descriptionKey: "docs.reference.fieldDuration" },
      { name: "aspect_ratio", descriptionKey: "docs.reference.fieldAspectRatio" },
      { name: "resolution", descriptionKey: "docs.reference.fieldResolution" },
      { name: "image", descriptionKey: "docs.reference.fieldVideoImage" },
      { name: "reference_images", descriptionKey: "docs.reference.fieldReferenceImages" },
    ],
    noteKeys: ["docs.reference.noteVideoAsync", "docs.reference.noteVideoStrict"],
    request: (model) => ({
      model,
      prompt: "A paper airplane flying over a city",
      duration: 8,
      aspect_ratio: "16:9",
      resolution: "720p",
    }),
    response: { request_id: "video_example" },
  },
  "video/get": {
    key: "video/get",
    category: "Video",
    title: "Get video",
    method: "GET",
    path: "/videos/{request_id}",
    descriptionKey: "docs.endpointVideoGet",
    capabilities: ["video"],
    fields: [
      { name: "request_id", required: true, descriptionKey: "docs.reference.fieldRequestId" },
    ],
    noteKeys: ["docs.reference.noteVideoPolling", "docs.reference.noteVideoStatus"],
    request: () => undefined,
    response: {
      status: "done",
      model: "grok-imagine-video",
      progress: 100,
      video: { url: "https://example.com/generated.mp4", duration: 8, respect_moderation: true },
    },
  },
};

export function withExampleModel(
  response: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  return "model" in response ? { ...response, model } : response;
}

export function fallbackModel(key: string): string {
  if (key.startsWith("image/"))
    return key === "image/edits" ? "grok-imagine-image-edit" : "grok-imagine-image";
  if (key.startsWith("video/")) return "grok-imagine-video";
  return "your-enabled-model";
}

export function createExamples(
  definition: EndpointDefinition,
  baseUrl: string,
  model: string,
): Record<ExampleLanguage, string> {
  const request = definition.request(model);
  const url = `${baseUrl}${definition.path.replace("{request_id}", "video_example")}`;
  const messageHeaders = definition.key === "chat/messages";
  const curlHeaders = messageHeaders
    ? [
        '  -H "x-api-key: $GROK2API_API_KEY"',
        '  -H "anthropic-version: 2023-06-01"',
        '  -H "Content-Type: application/json"',
      ].join(" \\\n")
    : [
        '  -H "Authorization: Bearer $GROK2API_API_KEY"',
        '  -H "Content-Type: application/json"',
      ].join(" \\\n");
  const curlBody = request ? ` \\\n  -d '${JSON.stringify(request, null, 2)}'` : "";
  const headers = messageHeaders
    ? {
        "x-api-key": "g2a_your_api_key",
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      }
    : { Authorization: "Bearer g2a_your_api_key", "Content-Type": "application/json" };
  const pythonImports = request ? "import json\nimport requests" : "import requests";
  const pythonPayload = request
    ? `\n\npayload = json.loads(r'''${JSON.stringify(request, null, 2)}''')`
    : "";
  const pythonBody = request ? ",\n    json=payload" : "";
  const javascriptBody = request
    ? `,\n  body: JSON.stringify(${JSON.stringify(request, null, 2)})`
    : "";
  return {
    curl: `export GROK2API_API_KEY="g2a_your_api_key"\n\ncurl -X ${definition.method} "${url}" \\\n${curlHeaders}${curlBody}`,
    python: `${pythonImports}${pythonPayload}\n\nresponse = requests.${definition.method.toLowerCase()}(\n    "${url}",\n    headers=${JSON.stringify(headers, null, 2)}${pythonBody}\n)\nresponse.raise_for_status()\nprint(response.json())`,
    javascript: `const response = await fetch("${url}", {\n  method: "${definition.method}",\n  headers: ${JSON.stringify(headers, null, 2)}${javascriptBody}\n});\n\nif (!response.ok) throw new Error(await response.text());\nconsole.log(await response.json());`,
  };
}
