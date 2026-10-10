import { useCallback, useEffect, useRef, useState } from "react";

import { isAbortError, type CreativeChatRequest } from "@/features/creative-console/chat-session-model";
import { readErrorMessage } from "@/features/creative-console/creative-api-core";
import type { ChatStreamSnapshot } from "@/features/creative-console/creative-console-api";
import { createChatResponse } from "@/features/creative-console/creative-console-api";

export type CreativeChatStreamHandlers = {
  onSnapshot: (messageId: string, snapshot: ChatStreamSnapshot) => void;
  onSuccess: (messageId: string, snapshot: ChatStreamSnapshot) => void;
  onFailure: (messageId: string, snapshot: ChatStreamSnapshot, aborted: boolean) => void;
  onStop: (messageId: string, snapshot: ChatStreamSnapshot) => void;
};

export type CreativeChatStreamController = {
  isPending: boolean;
  errorMessage: string;
  start: (request: CreativeChatRequest) => void;
  stop: () => void;
  cancel: () => void;
  reset: () => void;
};

type StreamRuntime = {
  snapshot: ChatStreamSnapshot;
  frame: number | null;
  controller: AbortController | null;
  requestSeq: number;
  activeSeq: number;
  messageId: string;
  pending: boolean;
};

type StreamSettleParams = {
  runtime: StreamRuntime;
  handlers: CreativeChatStreamHandlers;
  setPending: (value: boolean) => void;
  messageId: string;
  requestSeq: number;
};

function emptySnapshot(): ChatStreamSnapshot {
  return { text: "", reasoning: "", tools: [] };
}

function createStreamRuntime(): StreamRuntime {
  return {
    snapshot: emptySnapshot(),
    frame: null,
    controller: null,
    requestSeq: 0,
    activeSeq: 0,
    messageId: "",
    pending: false,
  };
}

export function cancelStreamRequest(runtime: StreamRuntime): void {
  if (runtime.frame !== null) {
    cancelAnimationFrame(runtime.frame);
    runtime.frame = null;
  }
  runtime.controller?.abort();
  runtime.controller = null;
  // 0 = 没有请求拥有流回调，旧请求随后返回的结果一律丢弃。
  runtime.activeSeq = 0;
  runtime.snapshot = emptySnapshot();
}

function releaseStreamRequest(runtime: StreamRuntime, setPending: (value: boolean) => void): void {
  runtime.controller = null;
  runtime.activeSeq = 0;
  runtime.pending = false;
  setPending(false);
}

function scheduleStreamSnapshot(
  runtime: StreamRuntime,
  handlers: CreativeChatStreamHandlers,
  messageId: string,
  requestSeq: number,
): void {
  if (runtime.frame !== null) return;
  runtime.frame = requestAnimationFrame(() => {
    runtime.frame = null;
    if (runtime.activeSeq !== requestSeq) return;
    handlers.onSnapshot(messageId, runtime.snapshot);
  });
}

function settleStreamSuccess(params: StreamSettleParams & { result: ChatStreamSnapshot }): void {
  const { runtime, handlers, messageId, requestSeq, result, setPending } = params;
  if (runtime.activeSeq !== requestSeq) return;
  if (runtime.frame !== null) cancelAnimationFrame(runtime.frame);
  runtime.frame = null;
  handlers.onSuccess(messageId, result);
  releaseStreamRequest(runtime, setPending);
}

function settleStreamFailure(params: StreamSettleParams & { error: unknown; setError: (value: string) => void }): void {
  const { runtime, handlers, messageId, requestSeq, error, setError, setPending } = params;
  if (runtime.activeSeq !== requestSeq) return;
  if (runtime.frame !== null) cancelAnimationFrame(runtime.frame);
  runtime.frame = null;
  const aborted = isAbortError(error);
  handlers.onFailure(messageId, runtime.snapshot, aborted);
  setError(aborted ? "" : readErrorMessage(error));
  releaseStreamRequest(runtime, setPending);
}

function startStreamRequest(params: {
  runtime: StreamRuntime;
  handlers: CreativeChatStreamHandlers;
  request: CreativeChatRequest;
  setPending: (value: boolean) => void;
  setError: (value: string) => void;
}): void {
  const { runtime, handlers, request, setPending, setError } = params;
  runtime.snapshot = emptySnapshot();
  const controller = new AbortController();
  runtime.controller = controller;
  runtime.requestSeq += 1;
  const requestSeq = runtime.requestSeq;
  runtime.activeSeq = requestSeq;
  runtime.messageId = request.assistantMessageId;
  runtime.pending = true;
  setError("");
  setPending(true);
  void createChatResponse({
    apiKey: request.apiKey,
    model: request.model,
    messages: request.messages,
    promptCacheKey: request.promptCacheKey || undefined,
    reasoningEffort: request.reasoningEffort,
    webSearch: request.webSearch,
    xSearch: request.xSearch,
    signal: controller.signal,
    onUpdate: (snapshot) => {
      if (runtime.activeSeq !== requestSeq) return;
      runtime.snapshot = snapshot;
      scheduleStreamSnapshot(runtime, handlers, request.assistantMessageId, requestSeq);
    },
  }).then(
    (result) =>
      settleStreamSuccess({ runtime, handlers, setPending, messageId: request.assistantMessageId, requestSeq, result }),
    (error: unknown) =>
      settleStreamFailure({
        runtime,
        handlers,
        setPending,
        setError,
        messageId: request.assistantMessageId,
        requestSeq,
        error,
      }),
  );
}

function stopStreamRequest(runtime: StreamRuntime, handlers: CreativeChatStreamHandlers, reset: () => void): void {
  if (!runtime.pending) return;
  const messageId = runtime.messageId;
  const snapshot = runtime.snapshot;
  cancelStreamRequest(runtime);
  handlers.onStop(messageId, snapshot);
  reset();
}

/**
 * 聊天流式请求的生命周期：
 * - 每次请求独占一个 requestSeq，取消后旧请求的回调不再写入状态；
 * - 流式分片先落到 runtime，再按动画帧合并刷新，避免每个分片触发一次消息列表渲染；
 * - 卸载时中止请求并取消待执行的帧。
 */
export function useCreativeChatStream(handlers: CreativeChatStreamHandlers): CreativeChatStreamController {
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const runtimeRef = useRef<StreamRuntime>(createStreamRuntime());
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });
  const cancel = useCallback((): void => cancelStreamRequest(runtimeRef.current), []);
  const reset = useCallback((): void => releaseStreamRequest(runtimeRef.current, setIsPending), []);
  const stop = useCallback((): void => stopStreamRequest(runtimeRef.current, handlersRef.current, reset), [reset]);
  const start = useCallback(
    (request: CreativeChatRequest): void =>
      startStreamRequest({
        runtime: runtimeRef.current,
        handlers: handlersRef.current,
        request,
        setPending: setIsPending,
        setError: setErrorMessage,
      }),
    [],
  );
  useEffect(() => () => cancelStreamRequest(runtimeRef.current), []);
  return { isPending, errorMessage, start, stop, cancel, reset };
}
