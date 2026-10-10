import {
  CreativeApiError,
  parseJSON,
  readResponseError,
  type ChatMessage,
  type ChatStreamSnapshot,
  type ReasoningEffort,
} from "@/features/creative-console/creative-api-core";
import {
  consumeResponsesFrame,
  createResponsesStreamEmitter,
  createResponsesStreamState,
  readResponseReasoning,
  readResponseText,
  readResponseTools,
  snapshotResponsesStream,
  splitSSEFrames,
} from "@/features/creative-console/creative-responses-protocol";

export type CreateChatResponseInput = {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  promptCacheKey?: string;
  reasoningEffort: ReasoningEffort;
  webSearch: boolean;
  xSearch: boolean;
  onUpdate?: (snapshot: ChatStreamSnapshot) => void;
  signal?: AbortSignal;
};

export async function createChatResponse(input: CreateChatResponseInput): Promise<ChatStreamSnapshot> {
  return streamResponses(input.apiKey, buildChatRequestBody(input), input.onUpdate, input.signal);
}

export function buildChatRequestBody(input: CreateChatResponseInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    input: input.messages.map(({ role, content }) => ({ role, content })),
    stream: true,
    store: false,
  };
  if (input.promptCacheKey) body.prompt_cache_key = input.promptCacheKey;
  if (input.reasoningEffort === "auto") body.reasoning = { summary: "auto" };
  else if (input.reasoningEffort !== "none") body.reasoning = { effort: input.reasoningEffort, summary: "auto" };
  else body.reasoning = { effort: "none" };
  const tools: Array<{ type: string }> = [];
  if (input.webSearch) tools.push({ type: "web_search" });
  if (input.xSearch) tools.push({ type: "x_search" });
  if (tools.length > 0) body.tools = tools;
  return body;
}

export async function streamResponses(
  apiKey: string,
  body: Record<string, unknown>,
  onUpdate?: (snapshot: ChatStreamSnapshot) => void,
  signal?: AbortSignal,
): Promise<ChatStreamSnapshot> {
  const response = await fetch("/v1/responses", {
    method: "POST",
    headers: new Headers({
      Accept: "text/event-stream",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw await readResponseError(response);
  if (!response.headers.get("content-type")?.includes("text/event-stream")) return readBufferedChatResult(response);
  if (!response.body)
    throw new CreativeApiError(response.status, "The Responses API stream was empty", "invalid_response");
  return readResponsesBody(response.body, response.status, onUpdate);
}

async function readBufferedChatResult(response: Response): Promise<ChatStreamSnapshot> {
  const payload = parseJSON(await response.text());
  return requireDisplayableChatResult(response.status, {
    text: readResponseText(payload),
    reasoning: readResponseReasoning(payload),
    tools: readResponseTools(payload),
  });
}

async function readResponsesBody(
  body: ReadableStream<Uint8Array>,
  status: number,
  onUpdate?: (snapshot: ChatStreamSnapshot) => void,
): Promise<ChatStreamSnapshot> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const state = createResponsesStreamState();
  const emit = createResponsesStreamEmitter(state, onUpdate);
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer = (buffer + decoder.decode(value, { stream: !done })).replaceAll("\r\n", "\n");
      const { frames, remainder } = splitSSEFrames(buffer);
      for (const frame of frames) consumeResponsesFrame(state, frame, status, emit);
      buffer = remainder;
      if (done) break;
    }
    if (buffer.trim()) consumeResponsesFrame(state, buffer, status, emit);
  } catch (error) {
    // 协议错误时不继续读取，主动关闭 reader，避免上游连接悬挂。
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return requireDisplayableChatResult(status, snapshotResponsesStream(state));
}

export function requireDisplayableChatResult(status: number, result: ChatStreamSnapshot): ChatStreamSnapshot {
  if (!result.text.trim() && !result.reasoning.trim() && result.tools.length === 0)
    throw new CreativeApiError(status, "The Responses API did not return any displayable output", "invalid_response");
  return result;
}
