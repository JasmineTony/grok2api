import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CreativeConsolePage } from "@/features/creative-console/creative-console-page";
import { i18n } from "@/shared/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consoleApiMock = vi.hoisted(() => ({
  createChatResponse: vi.fn(),
  generateImage: vi.fn(),
  createVideo: vi.fn(),
  editVideo: vi.fn(),
  extendVideo: vi.fn(),
  getVideo: vi.fn(),
  listVoices: vi.fn(),
  synthesizeSpeech: vi.fn(),
  transcribeSpeech: vi.fn(),
}));

const keysApiMock = vi.hoisted(() => ({
  listClientKeys: vi.fn(),
  getClientKeySecret: vi.fn(),
}));

const modelsApiMock = vi.hoisted(() => ({ listModels: vi.fn() }));

vi.mock("@/features/creative-console/creative-console-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/creative-console/creative-console-api")>()),
  ...consoleApiMock,
}));

vi.mock("@/features/client-keys/client-keys-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/client-keys/client-keys-api")>()),
  ...keysApiMock,
}));

vi.mock("@/entities/model/model-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/entities/model/model-api")>()),
  ...modelsApiMock,
}));

const activeKey = {
  id: "key-1",
  name: "主密钥",
  prefix: "sk-abc",
  enabled: true,
  expiresAt: "",
  providerScope: ["grok_web"],
  tierScope: ["all"],
  allowedModelIds: [],
};

const chatModel = {
  id: "m1",
  publicId: "grok-4",
  enabled: true,
  available: true,
  capability: "chat",
  provider: "grok_web",
  upstreamModel: "grok-4",
  publicName: "grok-4",
};

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  keysApiMock.listClientKeys.mockResolvedValue({ items: [activeKey], total: 1 });
  keysApiMock.getClientKeySecret.mockResolvedValue({ secret: "sk-secret" });
  modelsApiMock.listModels.mockResolvedValue({ items: [chatModel], total: 1 });
  consoleApiMock.listVoices.mockResolvedValue([{ voiceId: "eve", name: "Eve" }]);
});

afterEach(() => {
  queryClient.clear();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("创作台页面组合", () => {
  it("加载密钥与模型后展示聊天面板，并可切换到其它模式", async () => {
    render(<CreativeConsolePage />, { wrapper });

    expect(screen.getByText(i18n.t("creativeConsole.title"))).toBeInTheDocument();
    await waitFor(() => expect(keysApiMock.getClientKeySecret).toHaveBeenCalledWith("key-1"));
    expect(screen.getByTestId("creative-key-select")).toHaveAccessibleName(i18n.t("creativeConsole.clientKey"));
    await waitFor(() => expect(modelsApiMock.listModels).toHaveBeenCalled());
    expect(screen.getByTestId("chat-welcome-state")).toHaveTextContent(i18n.t("creativeConsole.welcome"));
  });

  it("可以切换到图像、视频与语音模式", async () => {
    render(<CreativeConsolePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId("chat-welcome-state")).toHaveTextContent(i18n.t("creativeConsole.welcome")),
    );

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByTestId("creative-mode-tab-image"));
    expect(screen.getByTestId("image-welcome-state")).toHaveTextContent(i18n.t("creativeConsole.welcomeImage"));

    await user.click(screen.getByTestId("creative-mode-tab-video"));
    expect(screen.getByTestId("video-welcome-state")).toHaveTextContent(i18n.t("creativeConsole.welcomeVideo"));

    await user.click(screen.getByTestId("creative-mode-tab-voice"));
    expect(screen.getByTestId("voice-welcome-state")).toHaveTextContent(i18n.t("creativeConsole.welcomeVoice"));
  });

  it("没有可用密钥时提示先创建密钥，且不请求模型", async () => {
    keysApiMock.listClientKeys.mockResolvedValue({ items: [{ ...activeKey, enabled: false }], total: 1 });
    render(<CreativeConsolePage />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId("creative-console-no-keys")).toHaveTextContent(i18n.t("creativeConsole.errors.noKeys")),
    );
    expect(modelsApiMock.listModels).not.toHaveBeenCalled();
    expect(keysApiMock.getClientKeySecret).not.toHaveBeenCalled();
  });

  it("密钥列表失败时展示错误并可重试", async () => {
    keysApiMock.listClientKeys.mockRejectedValueOnce(new Error("密钥接口挂了"));
    render(<CreativeConsolePage />, { wrapper });

    await waitFor(() => expect(screen.getByTestId("creative-console-keys-error")).toHaveTextContent("密钥接口挂了"));
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByTestId("creative-console-keys-retry"));
    await waitFor(() => expect(keysApiMock.getClientKeySecret).toHaveBeenCalledWith("key-1"));
  });

  it("模型列表失败时展示错误提示", async () => {
    modelsApiMock.listModels.mockRejectedValue(new Error("模型接口挂了"));
    render(<CreativeConsolePage />, { wrapper });

    await waitFor(() => expect(screen.getByTestId("creative-console-models-error")).toHaveTextContent("模型接口挂了"));
  });

  it("密钥明文不可读时提示密钥不可用", async () => {
    keysApiMock.getClientKeySecret.mockRejectedValue(new Error(""));
    render(<CreativeConsolePage />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId("creative-console-key-error")).toHaveTextContent(
        i18n.t("creativeConsole.errors.keyUnavailable"),
      ),
    );
  });
});
