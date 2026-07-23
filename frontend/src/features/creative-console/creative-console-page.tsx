import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, ImageIcon, MessageSquareText, Sparkle, Video } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listModels } from "@/entities/model/model-api";
import type { ModelRouteDTO } from "@/entities/model/types";
import { type ClientKeyDTO, getClientKeySecret, listClientKeys } from "@/features/client-keys";
import { ChatPanel } from "@/features/creative-console/chat-panel";
import {
  InlineError,
  RetryableError,
} from "@/features/creative-console/creative-console-components";
import type { CreativePanelProps } from "@/features/creative-console/creative-console-types";
import { ImagePanel, VideoPanel } from "@/features/creative-console/media-panels";
import { useApiClient } from "@/shared/api/use-api-client";
import { PageHeader } from "@/shared/components/page-header";
import { cn } from "@/shared/lib/cn";

type CreativeMode = "chat" | "image" | "video";
type SecretState = { keyId: string; secret: string };

export function CreativeConsolePage() {
  const { t } = useTranslation();
  const apiClient = useApiClient();
  const [mode, setMode] = useState<CreativeMode>("chat");
  const [selectedKeyId, setSelectedKeyId] = useState("");
  const [secretState, setSecretState] = useState<SecretState | null>(null);
  const [keyError, setKeyError] = useState("");
  const [selectedModels, setSelectedModels] = useState<Record<CreativeMode, string>>({
    chat: "",
    image: "",
    video: "",
  });
  const [chatToolbarElement, setChatToolbarElement] = useState<HTMLDivElement | null>(null);
  const requestedSecretKeyRef = useRef("");

  const keysQuery = useQuery({
    queryKey: ["creative-console", "client-keys"],
    queryFn: () =>
      listAllPaginatedItems((page, pageSize) =>
        listClientKeys(apiClient, { page, pageSize, status: "active" }),
      ),
    staleTime: 30_000,
  });
  const modelsQuery = useQuery({
    queryKey: ["creative-console", "models"],
    queryFn: () =>
      listAllPaginatedItems((page, pageSize) =>
        listModels(apiClient, { page, pageSize, status: "enabled" }),
      ),
    staleTime: 30_000,
  });
  const activeKeys = useMemo(() => (keysQuery.data ?? []).filter(isUsableKey), [keysQuery.data]);
  const effectiveKeyId = activeKeys.some((key) => key.id === selectedKeyId)
    ? selectedKeyId
    : (activeKeys[0]?.id ?? "");
  const selectedKey = activeKeys.find((key) => key.id === effectiveKeyId);
  const availableModels = useMemo(
    () => (modelsQuery.data ?? []).filter((model) => model.enabled && model.available),
    [modelsQuery.data],
  );
  const permittedModels = useMemo(() => {
    if (!selectedKey || selectedKey.allowedModelIds.length === 0) return availableModels;
    const allowedModelIds = new Set(selectedKey.allowedModelIds);
    return availableModels.filter((model) => allowedModelIds.has(model.id));
  }, [availableModels, selectedKey]);
  const modelGroups = useMemo(
    () => ({
      chat: uniqueModelsByPublicID(
        permittedModels.filter(
          (model) => model.capability === "chat" || model.capability === "responses",
        ),
      ),
      image: uniqueModelsByPublicID(
        permittedModels.filter((model) => model.capability === "image"),
      ),
      video: uniqueModelsByPublicID(
        permittedModels.filter((model) => model.capability === "video"),
      ),
    }),
    [permittedModels],
  );
  const effectiveModels = useMemo<Record<CreativeMode, string>>(
    () => ({
      chat: modelGroups.chat.some((model) => model.publicId === selectedModels.chat)
        ? selectedModels.chat
        : (modelGroups.chat[0]?.publicId ?? ""),
      image: modelGroups.image.some((model) => model.publicId === selectedModels.image)
        ? selectedModels.image
        : (modelGroups.image[0]?.publicId ?? ""),
      video: modelGroups.video.some((model) => model.publicId === selectedModels.video)
        ? selectedModels.video
        : (modelGroups.video[0]?.publicId ?? ""),
    }),
    [modelGroups, selectedModels],
  );

  const secretMutation = useMutation({
    mutationFn: (id: string) => getClientKeySecret(apiClient, id),
    onSuccess: ({ secret }, id) => {
      if (id !== effectiveKeyId) return;
      setSecretState({ keyId: id, secret });
      setKeyError("");
    },
    onError: (error, id) => {
      if (id !== effectiveKeyId) return;
      setKeyError(
        error instanceof Error ? error.message : t("creativeConsole.errors.keyUnavailable"),
      );
    },
  });

  const loadSecret = secretMutation.mutate;
  useEffect(() => {
    if (!effectiveKeyId) {
      requestedSecretKeyRef.current = "";
      return;
    }
    if (requestedSecretKeyRef.current === effectiveKeyId) return;
    requestedSecretKeyRef.current = effectiveKeyId;
    loadSecret(effectiveKeyId);
  }, [effectiveKeyId, loadSecret]);

  const apiKey = secretState?.keyId === effectiveKeyId ? secretState.secret : "";

  function panelProps(panelMode: CreativeMode): CreativePanelProps {
    return {
      apiKey,
      model: effectiveModels[panelMode],
      modelOptions: modelGroups[panelMode],
      onModelChange: (model) =>
        setSelectedModels((current) => ({ ...current, [panelMode]: model })),
    };
  }

  function changeKey(id: string): void {
    setSelectedKeyId(id);
    setSecretState(null);
    setKeyError("");
  }

  return (
    <div className="flex h-[calc(100dvh-5rem)] min-h-[36rem] flex-col gap-5 overflow-hidden">
      <PageHeader
        title={t("creativeConsole.title")}
        description={t("creativeConsole.description")}
      />

      <aside className="flex shrink-0 flex-col gap-2 rounded-lg bg-secondary/45 px-4 py-2.5 text-xs leading-5 text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Sparkle className="size-4 shrink-0 text-foreground/70" />
          <p>{t("creativeConsole.promotion", { product: "DEEIX Chat" })}</p>
        </div>
        <a
          className="inline-flex shrink-0 items-center gap-1.5 self-end font-medium text-foreground hover:underline sm:self-auto"
          href="https://github.com/DEEIX-AI/DEEIX-Chat"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("creativeConsole.promotionAction")}
          <ExternalLink className="size-3.5" />
        </a>
      </aside>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-9 shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={mode} onValueChange={(value) => setMode(value as CreativeMode)}>
            <TabsList className="h-9 w-full rounded-full bg-secondary/50 p-1 lg:w-auto">
              <TabsTrigger
                className="flex-1 gap-1.5 rounded-full px-3 lg:min-w-20 [&_svg]:size-3.5"
                value="chat"
              >
                <MessageSquareText />
                {t("creativeConsole.modes.chat")}
              </TabsTrigger>
              <TabsTrigger
                className="flex-1 gap-1.5 rounded-full px-3 lg:min-w-20 [&_svg]:size-3.5"
                value="image"
              >
                <ImageIcon />
                {t("creativeConsole.modes.image")}
              </TabsTrigger>
              <TabsTrigger
                className="flex-1 gap-1.5 rounded-full px-3 lg:min-w-20 [&_svg]:size-3.5"
                value="video"
              >
                <Video />
                {t("creativeConsole.modes.video")}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex min-w-0 items-center gap-2">
            <Select
              value={effectiveKeyId}
              onValueChange={changeKey}
              disabled={keysQuery.isPending || activeKeys.length === 0}
            >
              <SelectTrigger
                id="creative-key"
                className="min-w-0 flex-1 bg-secondary/55 lg:w-64 lg:flex-none"
                aria-label={t("creativeConsole.clientKey")}
              >
                <SelectValue
                  placeholder={
                    keysQuery.isPending ? t("common.loading") : t("creativeConsole.selectKey")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {activeKeys.map((key) => (
                  <SelectItem key={key.id} value={key.id}>
                    {key.name} · {key.prefix}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div
              ref={setChatToolbarElement}
              className={cn("items-center gap-1", mode === "chat" ? "flex" : "hidden")}
            />
          </div>
        </div>

        <div className="shrink-0 space-y-2 px-3">
          {keysQuery.isError ? (
            <RetryableError
              message={keysQuery.error.message}
              onRetry={() => void keysQuery.refetch()}
            />
          ) : null}
          {!keysQuery.isPending && !keysQuery.isError && activeKeys.length === 0 ? (
            <InlineError message={t("creativeConsole.errors.noKeys")} />
          ) : null}
          {keyError ? <InlineError message={keyError} /> : null}
          {modelsQuery.isError ? (
            <RetryableError
              message={modelsQuery.error.message}
              onRetry={() => void modelsQuery.refetch()}
            />
          ) : null}
        </div>

        <div className="min-h-0 flex-1">
          <div className="h-full" hidden={mode !== "chat"}>
            <ChatPanel
              key={effectiveKeyId || "default"}
              storageScope={effectiveKeyId || "default"}
              toolbarElement={chatToolbarElement}
              {...panelProps("chat")}
            />
          </div>
          <div className="h-full" hidden={mode !== "image"}>
            <ImagePanel {...panelProps("image")} />
          </div>
          <div className="h-full" hidden={mode !== "video"}>
            <VideoPanel {...panelProps("video")} />
          </div>
        </div>
      </section>
    </div>
  );
}

function isUsableKey(key: ClientKeyDTO): boolean {
  if (!key.enabled) return false;
  return !key.expiresAt || new Date(key.expiresAt).getTime() > Date.now();
}

function uniqueModelsByPublicID(models: ModelRouteDTO[]): ModelRouteDTO[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.publicId)) return false;
    seen.add(model.publicId);
    return true;
  });
}

async function listAllPaginatedItems<T>(
  loadPage: (page: number, pageSize: number) => Promise<{ items: T[]; total: number }>,
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const result = await loadPage(page, 100);
    items.push(...result.items);
    if (result.items.length === 0 || items.length >= result.total) break;
  }
  return items;
}
