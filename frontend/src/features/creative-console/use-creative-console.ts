import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";

import { listModels } from "@/entities/model/model-api";
import type { ModelRouteDTO } from "@/entities/model/types";
import { isUsableKey } from "@/features/creative-console/chat-session-model";
import { listAllPaginatedItems, readErrorMessage } from "@/features/creative-console/creative-api-core";
import {
  groupCreativeModels,
  resolveEffectiveModels,
  uniqueModelsByPublicID,
} from "@/features/creative-console/creative-model-scope";
import type { CreativeMode, CreativePanelProps } from "@/features/creative-console/creative-panel-contract";
import { getClientKeySecret, listClientKeys, type ClientKeyDTO } from "@/features/client-keys/client-keys-api";

type SecretState = {
  keyId: string;
  secret: string;
};

type ConsoleKeys = {
  activeKeys: ClientKeyDTO[];
  selectedKey: ClientKeyDTO | undefined;
  effectiveKeyId: string;
  keysPending: boolean;
  keysError: string;
  retryKeys: () => void;
  changeKey: (id: string) => void;
};

type ConsoleModels = {
  modelGroups: Record<CreativeMode, ModelRouteDTO[]>;
  effectiveModels: Record<CreativeMode, string>;
  setSelectedModels: Dispatch<SetStateAction<Record<CreativeMode, string>>>;
  modelsError: string;
  retryModels: () => void;
};

export type CreativeConsoleController = {
  mode: CreativeMode;
  setMode: (mode: CreativeMode) => void;
  activeKeys: ClientKeyDTO[];
  effectiveKeyId: string;
  changeKey: (id: string) => void;
  keysPending: boolean;
  keysError: string;
  retryKeys: () => void;
  keyError: string;
  modelsError: string;
  retryModels: () => void;
  panelProps: (mode: CreativeMode) => CreativePanelProps;
};

function useConsoleKeys(): ConsoleKeys {
  const [selectedKeyId, setSelectedKeyId] = useState("");
  const keysQuery = useQuery({
    queryKey: ["creative-console", "client-keys"],
    queryFn: () => listAllPaginatedItems((page, pageSize) => listClientKeys({ page, pageSize, status: "active" })),
    staleTime: 30_000,
  });
  const activeKeys = useMemo(() => (keysQuery.data ?? []).filter(isUsableKey), [keysQuery.data]);
  const effectiveKeyId = activeKeys.some((key) => key.id === selectedKeyId) ? selectedKeyId : (activeKeys[0]?.id ?? "");
  return {
    activeKeys,
    selectedKey: activeKeys.find((key) => key.id === effectiveKeyId),
    effectiveKeyId,
    keysPending: keysQuery.isPending,
    keysError: keysQuery.isError ? readErrorMessage(keysQuery.error) : "",
    retryKeys: () => void keysQuery.refetch(),
    changeKey: setSelectedKeyId,
  };
}

/** 模型列表按密钥的 provider/tier 范围过滤，再按面板用途归组并回退到可用公开名。 */
function useConsoleModels(selectedKey: ClientKeyDTO | undefined): ConsoleModels {
  const [selectedModels, setSelectedModels] = useState<Record<CreativeMode, string>>({
    chat: "",
    image: "",
    video: "",
    voice: "",
  });
  const modelProviderScope = (selectedKey?.providerScope ?? ["all"]).filter((value) => value !== "all");
  const modelTierScope = (selectedKey?.tierScope ?? ["all"]).filter((value) => value !== "all");
  const modelsQuery = useQuery({
    queryKey: ["creative-console", "models", modelProviderScope.join(","), modelTierScope.join(",")],
    queryFn: () =>
      listAllPaginatedItems((page, pageSize) =>
        listModels({
          page,
          pageSize,
          status: "enabled",
          providerScope: modelProviderScope,
          tierScope: modelTierScope,
          activeScope: true,
        }),
      ),
    enabled: Boolean(selectedKey),
    staleTime: 30_000,
  });
  const permittedModels = useMemo(() => {
    const available = (modelsQuery.data ?? []).filter((model) => model.enabled && model.available);
    if (!selectedKey || selectedKey.allowedModelIds.length === 0) return available;
    const allowedModelIds = new Set(selectedKey.allowedModelIds);
    return available.filter((model) => allowedModelIds.has(model.id));
  }, [modelsQuery.data, selectedKey]);
  const modelGroups = useMemo(() => groupCreativeModels(permittedModels), [permittedModels]);
  const voiceModelChoices = useMemo(() => uniqueModelsByPublicID(modelGroups.voice), [modelGroups.voice]);
  const effectiveModels = useMemo(
    () => resolveEffectiveModels(modelGroups, selectedModels, voiceModelChoices),
    [modelGroups, selectedModels, voiceModelChoices],
  );
  return {
    modelGroups,
    effectiveModels,
    setSelectedModels,
    modelsError: modelsQuery.isError ? readErrorMessage(modelsQuery.error) : "",
    retryModels: () => void modelsQuery.refetch(),
  };
}

/** 密钥明文按生效密钥一次性拉取；切换密钥时清空，避免串用上一次的明文。 */
function useConsoleSecret(effectiveKeyId: string): { apiKey: string; keyError: string; clearSecret: () => void } {
  const { t } = useTranslation();
  const [secretState, setSecretState] = useState<SecretState | null>(null);
  const [keyError, setKeyError] = useState("");
  const requestedSecretKeyRef = useRef("");
  const secretMutation = useMutation({
    mutationFn: (id: string) => getClientKeySecret(id),
    onSuccess: ({ secret }, id) => {
      if (id !== effectiveKeyId) return;
      setSecretState({ keyId: id, secret });
      setKeyError("");
    },
    onError: (error, id) => {
      if (id !== effectiveKeyId) return;
      setKeyError(readErrorMessage(error) || t("creativeConsole.errors.keyUnavailable"));
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
  return {
    apiKey: secretState?.keyId === effectiveKeyId ? secretState.secret : "",
    keyError,
    clearSecret: () => {
      setSecretState(null);
      setKeyError("");
    },
  };
}

/** 创作台页面级状态：可用密钥、按密钥范围过滤的模型路由、当前模式与各面板的密钥/模型契约。 */
export function useCreativeConsole(): CreativeConsoleController {
  const [mode, setMode] = useState<CreativeMode>("chat");
  const keys = useConsoleKeys();
  const models = useConsoleModels(keys.selectedKey);
  const secret = useConsoleSecret(keys.effectiveKeyId);
  function changeKey(id: string): void {
    keys.changeKey(id);
    secret.clearSecret();
  }
  function panelProps(panelMode: CreativeMode): CreativePanelProps {
    return {
      apiKey: secret.apiKey,
      model: models.effectiveModels[panelMode],
      modelOptions: models.modelGroups[panelMode],
      onModelChange: (model) => models.setSelectedModels((current) => ({ ...current, [panelMode]: model })),
    };
  }
  return {
    mode,
    setMode,
    activeKeys: keys.activeKeys,
    effectiveKeyId: keys.effectiveKeyId,
    changeKey,
    keysPending: keys.keysPending,
    keysError: keys.keysError,
    retryKeys: keys.retryKeys,
    keyError: secret.keyError,
    modelsError: models.modelsError,
    retryModels: models.retryModels,
    panelProps,
  };
}
