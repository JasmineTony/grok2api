import {
  CreativeApiError,
  isRecord,
  parseJSON,
  readError,
  type ChatStreamSnapshot,
  type ChatToolActivity,
} from "@/features/creative-console/creative-api-core";

/**
 * `/v1/responses` 流式协议：SSE 分帧 + 事件解码。
 * 状态与副作用分离：解码只写入 ResponsesStreamState，是否通知调用方由 emit 决定，
 * 以保证事件顺序、结束语义与错误语义与拆分前完全一致。
 */
export type ResponsesStreamState = {
  text: string;
  reasoning: string;
  tools: Map<string, ChatToolActivity>;
};

export type ResponsesEventEmitter = () => void;

export function createResponsesStreamState(): ResponsesStreamState {
  return { text: "", reasoning: "", tools: new Map<string, ChatToolActivity>() };
}

export function snapshotResponsesStream(state: ResponsesStreamState): ChatStreamSnapshot {
  return { text: state.text, reasoning: state.reasoning, tools: Array.from(state.tools.values()) };
}

export function createResponsesStreamEmitter(
  state: ResponsesStreamState,
  onUpdate?: (snapshot: ChatStreamSnapshot) => void,
): ResponsesEventEmitter {
  return () => onUpdate?.(snapshotResponsesStream(state));
}

/** 取出一个 SSE 事件块里的 data 行并拼接；分片重组后的换行已统一为 \n。 */
export function readSSEDataBlock(block: string): string {
  return block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
}

/** 按空行切分已就绪的事件块，返回完整块与剩余尾巴（尾巴可能仍是不完整分片）。 */
export function splitSSEFrames(buffer: string): { frames: string[]; remainder: string } {
  const frames: string[] = [];
  let remainder = buffer;
  let boundary = remainder.indexOf("\n\n");
  while (boundary >= 0) {
    frames.push(remainder.slice(0, boundary));
    remainder = remainder.slice(boundary + 2);
    boundary = remainder.indexOf("\n\n");
  }
  return { frames, remainder };
}

export function consumeResponsesFrame(
  state: ResponsesStreamState,
  frame: string,
  status: number,
  emit: ResponsesEventEmitter,
): void {
  const data = readSSEDataBlock(frame);
  if (!data || data === "[DONE]") return;
  const payload = parseJSON(data);
  if (!isRecord(payload)) return;
  applyResponsesStreamPayload(state, payload, status, emit);
}

export function applyResponsesStreamPayload(
  state: ResponsesStreamState,
  payload: Record<string, unknown>,
  status: number,
  emit: ResponsesEventEmitter,
): void {
  const type = typeof payload.type === "string" ? payload.type : "";
  if (applyTextEvent(state, type, payload, emit)) return;
  if (applyReasoningEvent(state, type, payload, emit)) return;
  if (applyOutputItemEvent(state, type, payload, emit)) return;
  if (applyToolEvent(state, type, payload, emit)) return;
  if (applyEnvelopeEvent(state, type, payload, status, emit)) return;
  throwStreamFailure(type, payload, status);
}

function applyTextEvent(
  state: ResponsesStreamState,
  type: string,
  payload: Record<string, unknown>,
  emit: ResponsesEventEmitter,
): boolean {
  if (type === "response.output_text.delta" && typeof payload.delta === "string") {
    state.text += payload.delta;
    emit();
    return true;
  }
  if (type === "response.output_text.done" && typeof payload.text === "string") {
    state.text = payload.text;
    emit();
    return true;
  }
  return false;
}

function applyReasoningEvent(
  state: ResponsesStreamState,
  type: string,
  payload: Record<string, unknown>,
  emit: ResponsesEventEmitter,
): boolean {
  if (!isReasoningType(type)) return false;
  if (isDoneType(type)) {
    if (typeof payload.text !== "string") return true;
    state.reasoning = payload.text;
    emit();
    return true;
  }
  if (typeof payload.delta !== "string") return true;
  state.reasoning += payload.delta;
  emit();
  return true;
}

function isReasoningType(type: string): boolean {
  return (
    type === "response.reasoning_summary_text.delta" ||
    type === "response.reasoning_text.delta" ||
    type === "response.reasoning_summary_text.done" ||
    type === "response.reasoning_text.done"
  );
}

function isDoneType(type: string): boolean {
  return type === "response.reasoning_summary_text.done" || type === "response.reasoning_text.done";
}

function applyOutputItemEvent(
  state: ResponsesStreamState,
  type: string,
  payload: Record<string, unknown>,
  emit: ResponsesEventEmitter,
): boolean {
  if (type !== "response.output_item.added" && type !== "response.output_item.done") return false;
  const item = isRecord(payload.item) ? payload.item : undefined;
  if (!item) return true;
  if (item.type === "message") {
    const itemText = readContentText(item.content);
    if (type === "response.output_item.done" && itemText) state.text = itemText;
  } else if (item.type === "reasoning") {
    const itemReasoning = readReasoningItem(item);
    if (itemReasoning) state.reasoning = itemReasoning;
  } else {
    const tool = readToolItem(item, type === "response.output_item.done" ? "completed" : "in_progress");
    if (tool) state.tools.set(tool.id, tool);
  }
  emit();
  return true;
}

function applyToolEvent(
  state: ResponsesStreamState,
  type: string,
  payload: Record<string, unknown>,
  emit: ResponsesEventEmitter,
): boolean {
  if (type === "response.function_call_arguments.delta" || type === "response.custom_tool_call_input.delta") {
    updateToolDetail(state.tools, payload, typeof payload.delta === "string" ? payload.delta : "", true);
    emit();
    return true;
  }
  if (type === "response.function_call_arguments.done" || type === "response.custom_tool_call_input.done") {
    const detail =
      typeof payload.arguments === "string"
        ? payload.arguments
        : typeof payload.input === "string"
          ? payload.input
          : "";
    updateToolDetail(state.tools, payload, detail, false);
    emit();
    return true;
  }
  return false;
}

function applyEnvelopeEvent(
  state: ResponsesStreamState,
  type: string,
  payload: Record<string, unknown>,
  status: number,
  emit: ResponsesEventEmitter,
): boolean {
  if (!isEnvelopeType(type)) return false;
  if (type === "response.completed" || type === "response.incomplete") {
    const envelope = isRecord(payload.response) ? payload.response : undefined;
    applyResponsesEnvelope(state, envelope);
    emit();
    if (type === "response.incomplete") {
      throw new CreativeApiError(
        status,
        readIncompleteReason(envelope) || "The response ended before completion",
        "incomplete_response",
      );
    }
  }
  return true;
}

function isEnvelopeType(type: string): boolean {
  return (
    type === "response.created" ||
    type === "response.in_progress" ||
    type === "response.completed" ||
    type === "response.incomplete"
  );
}

function throwStreamFailure(type: string, payload: Record<string, unknown>, status: number): void {
  if (type !== "response.failed" && type !== "error") return;
  const error = readError(isRecord(payload.response) ? payload.response : payload);
  throw new CreativeApiError(status, error.message ?? "The Responses API stream failed", error.code);
}

function applyResponsesEnvelope(state: ResponsesStreamState, envelope: Record<string, unknown> | undefined): void {
  const finalText = readResponseText(envelope);
  const finalReasoning = readResponseReasoning(envelope);
  const finalTools = readResponseTools(envelope);
  if (finalText) state.text = finalText;
  if (finalReasoning) state.reasoning = finalReasoning;
  for (const tool of finalTools) state.tools.set(tool.id, tool);
}

export function readResponseText(payload: unknown): string {
  if (!isRecord(payload)) return "";
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  if (!Array.isArray(payload.output)) return "";
  return payload.output
    .flatMap((item) => {
      if (!isRecord(item) || item.type !== "message") return [];
      return [readContentText(item.content)];
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function readResponseReasoning(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.output)) return "";
  return payload.output
    .flatMap((item) => {
      if (!isRecord(item) || item.type !== "reasoning") return [];
      return [readReasoningItem(item)];
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function readResponseTools(payload: unknown): ChatToolActivity[] {
  if (!isRecord(payload) || !Array.isArray(payload.output)) return [];
  return payload.output.flatMap((item) => {
    if (!isRecord(item) || item.type === "message" || item.type === "reasoning") return [];
    const tool = readToolItem(item, "completed");
    return tool ? [tool] : [];
  });
}

function readReasoningItem(item: Record<string, unknown>): string {
  const summary = readContentText(item.summary);
  return summary || readContentText(item.content);
}

function readToolItem(
  item: Record<string, unknown>,
  fallbackStatus: ChatToolActivity["status"],
): ChatToolActivity | null {
  const type = typeof item.type === "string" ? item.type.trim() : "";
  if (!type) return null;
  const id = firstString(item.id, item.call_id) || `${type}-${firstString(item.name) || "tool"}`;
  const name = firstString(item.name) || toolNameFromType(type);
  const action = isRecord(item.action) ? item.action : undefined;
  const detail = firstString(item.arguments, item.input, action?.query, item.query);
  return { id, type, name, status: readToolStatus(item.status, fallbackStatus), detail };
}

function updateToolDetail(
  tools: Map<string, ChatToolActivity>,
  payload: Record<string, unknown>,
  detail: string,
  append: boolean,
): void {
  const id = firstString(payload.item_id, payload.call_id);
  if (!id) return;
  const current = tools.get(id) ?? {
    id,
    type: "function_call",
    name: "tool",
    status: "in_progress" as const,
    detail: "",
  };
  tools.set(id, { ...current, detail: append ? current.detail + detail : detail || current.detail });
}

function readToolStatus(value: unknown, fallback: ChatToolActivity["status"]): ChatToolActivity["status"] {
  if (value === "completed") return "completed";
  if (value === "failed" || value === "incomplete") return "failed";
  if (value === "in_progress" || value === "searching") return "in_progress";
  return fallback;
}

function toolNameFromType(type: string): string {
  if (type === "web_search_call" || type === "web_search") return "web_search";
  if (type === "x_search_call" || type === "x_search") return "x_search";
  return type.replace(/_call$/, "");
}

function readIncompleteReason(payload: unknown): string {
  if (!isRecord(payload) || !isRecord(payload.incomplete_details)) return "";
  const reason = firstString(payload.incomplete_details.reason);
  return reason ? `The response was incomplete: ${reason}` : "";
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readContentText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (!isRecord(item)) return "";
      return typeof item.text === "string" ? item.text : typeof item.content === "string" ? item.content : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}
