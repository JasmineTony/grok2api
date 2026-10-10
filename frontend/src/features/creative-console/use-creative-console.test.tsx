import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useCreativeConsole, type CreativeConsoleController } from "@/features/creative-console/use-creative-console";
import { i18n } from "@/shared/i18n";
import { render, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const keysApiMock = vi.hoisted(() => ({ listClientKeys: vi.fn(), getClientKeySecret: vi.fn() }));
const modelsApiMock = vi.hoisted(() => ({ listModels: vi.fn() }));

vi.mock("@/features/client-keys/client-keys-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/client-keys/client-keys-api")>()),
  ...keysApiMock,
}));

vi.mock("@/entities/model/model-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/entities/model/model-api")>()),
  ...modelsApiMock,
}));

function key(overrides: Record<string, unknown> = {}) {
  return {
    id: "key-1",
    name: "主密钥",
    prefix: "sk-abc",
    enabled: true,
    expiresAt: "",
    providerScope: ["all"],
    tierScope: ["all"],
    allowedModelIds: [] as string[],
    ...overrides,
  };
}

function model(id: string, publicId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    publicId,
    enabled: true,
    available: true,
    capability: "chat",
    provider: "grok_web",
    upstreamModel: publicId,
    publicName: publicId,
    ...overrides,
  };
}

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

/** 严格模式下 effect 会执行两次，用来验证同一把密钥不会被重复读取。 */
function strictWrapper({ children }: { children: ReactNode }) {
  return <StrictMode>{wrapper({ children })}</StrictMode>;
}

function renderConsole(options: { strict?: boolean } = {}) {
  return renderHook(() => useCreativeConsole(), { wrapper: options.strict ? strictWrapper : wrapper });
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  keysApiMock.listClientKeys.mockReset().mockResolvedValue({ items: [key()], total: 1 });
  keysApiMock.getClientKeySecret.mockReset().mockResolvedValue({ secret: "secret-1" });
  modelsApiMock.listModels
    .mockReset()
    .mockResolvedValue({ items: [model("m1", "grok-4"), model("m2", "grok-4-mini")], total: 2 });
});

afterEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

describe("创作台页面级状态", () => {
  it("默认使用首个可用密钥的明文与模型列表", async () => {
    const { result } = renderConsole();

    await waitFor(() => expect(result.current.effectiveKeyId).toBe("key-1"));
    await waitFor(() => expect(result.current.panelProps("chat").apiKey).toBe("secret-1"));
    await waitFor(() => expect(result.current.panelProps("chat").modelOptions).toHaveLength(2));
    expect(result.current.keysPending).toBe(false);
    expect(result.current.keysError).toBe("");
    expect(result.current.modelsError).toBe("");
  });

  it("密钥被限制模型范围时只保留允许的路由", async () => {
    keysApiMock.listClientKeys.mockResolvedValue({ items: [key({ allowedModelIds: ["m2"] })], total: 1 });
    const { result } = renderConsole();

    await waitFor(() => expect(result.current.panelProps("chat").modelOptions).toHaveLength(1));
    expect(result.current.panelProps("chat").modelOptions[0].publicId).toBe("grok-4-mini");
    expect(result.current.panelProps("chat").model).toBe("grok-4-mini");
  });

  it("密钥列表未完成时不请求模型，也没有生效密钥", () => {
    keysApiMock.listClientKeys.mockReturnValue(new Promise<never>(() => undefined));
    const { result } = renderConsole();

    expect(result.current.keysPending).toBe(true);
    expect(modelsApiMock.listModels).not.toHaveBeenCalled();
    expect(result.current.activeKeys).toEqual([]);
    expect(result.current.effectiveKeyId).toBe("");
    expect(keysApiMock.getClientKeySecret).not.toHaveBeenCalled();
  });

  it("停用或已过期的密钥不进入候选，也不会去读取明文", async () => {
    keysApiMock.listClientKeys.mockResolvedValue({
      items: [key({ id: "disabled", enabled: false }), key({ id: "expired", expiresAt: "2000-01-01T00:00:00.000Z" })],
      total: 2,
    });
    const { result } = renderConsole();

    await waitFor(() => expect(result.current.keysPending).toBe(false));
    expect(result.current.activeKeys).toEqual([]);
    expect(result.current.effectiveKeyId).toBe("");
    expect(keysApiMock.getClientKeySecret).not.toHaveBeenCalled();
    expect(modelsApiMock.listModels).not.toHaveBeenCalled();
  });

  it("切换密钥会清空上一把密钥的明文，并拒绝迟到的旧明文", async () => {
    let resolveFirstSecret: ((value: { secret: string }) => void) | undefined;
    keysApiMock.listClientKeys.mockResolvedValue({ items: [key({ id: "key-1" }), key({ id: "key-2" })], total: 2 });
    keysApiMock.getClientKeySecret.mockImplementation((id: string) => {
      if (id === "key-1") {
        return new Promise<{ secret: string }>((resolve) => {
          resolveFirstSecret = resolve;
        });
      }
      return Promise.resolve({ secret: "secret-2" });
    });

    const { result } = renderConsole();
    await waitFor(() => expect(result.current.effectiveKeyId).toBe("key-1"));
    expect(result.current.panelProps("chat").apiKey).toBe("");

    result.current.changeKey("key-2");
    await waitFor(() => expect(result.current.effectiveKeyId).toBe("key-2"));
    await waitFor(() => expect(result.current.panelProps("chat").apiKey).toBe("secret-2"));

    resolveFirstSecret?.({ secret: "stale-secret" });
    await waitFor(() => expect(result.current.panelProps("chat").apiKey).toBe("secret-2"));
  });

  it("当前密钥明文不可用时给出提示，切换密钥后不再显示旧错误", async () => {
    let keyOneCalls = 0;
    let rejectFirstSecret: ((error: unknown) => void) | undefined;
    keysApiMock.listClientKeys.mockResolvedValue({ items: [key({ id: "key-1" }), key({ id: "key-2" })], total: 2 });
    keysApiMock.getClientKeySecret.mockImplementation((id: string) => {
      if (id === "key-1") {
        keyOneCalls += 1;
        if (keyOneCalls === 1) {
          return new Promise<{ secret: string }>((_resolve, reject) => {
            rejectFirstSecret = reject;
          });
        }
        return Promise.resolve({ secret: "secret-1b" });
      }
      return Promise.resolve({ secret: "secret-2" });
    });

    const { result } = renderConsole();
    await waitFor(() => expect(result.current.effectiveKeyId).toBe("key-1"));

    rejectFirstSecret?.(new Error("密钥已撤销"));
    await waitFor(() => expect(result.current.keyError).toBe("密钥已撤销"));

    result.current.changeKey("key-2");
    await waitFor(() => expect(result.current.panelProps("chat").apiKey).toBe("secret-2"));
    expect(result.current.keyError).toBe("");

    result.current.changeKey("key-1");
    await waitFor(() => expect(result.current.panelProps("chat").apiKey).toBe("secret-1b"));
    expect(result.current.keyError).toBe("");
    expect(keyOneCalls).toBe(2);
  });

  it("密钥或模型加载失败时暴露错误，重试后恢复", async () => {
    keysApiMock.listClientKeys.mockRejectedValueOnce(new Error("密钥接口失败"));
    modelsApiMock.listModels.mockRejectedValueOnce(new Error("模型接口失败"));
    const { result } = renderConsole();

    await waitFor(() => expect(result.current.keysError).toBe("密钥接口失败"));
    expect(result.current.retryKeys).toBeTypeOf("function");

    keysApiMock.listClientKeys.mockResolvedValue({ items: [key()], total: 1 });
    result.current.retryKeys();
    await waitFor(() => expect(result.current.keysError).toBe(""));

    await waitFor(() => expect(result.current.modelsError).toBe("模型接口失败"));
    modelsApiMock.listModels.mockResolvedValue({ items: [model("m1", "grok-4")], total: 1 });
    result.current.retryModels();
    await waitFor(() => expect(result.current.modelsError).toBe(""));
    await waitFor(() => expect(result.current.panelProps("chat").modelOptions).toHaveLength(1));
  });
});

describe("密钥明文请求的去重与迟到失败", () => {
  it("同一把密钥只读取一次明文（StrictMode 下也不重复）", async () => {
    const { result } = renderConsole({ strict: true });

    await waitFor(() => expect(result.current.panelProps("chat").apiKey).toBe("secret-1"));
    expect(keysApiMock.getClientKeySecret).toHaveBeenCalledTimes(1);
    expect(keysApiMock.getClientKeySecret).toHaveBeenCalledWith("key-1");
  });

  it("挂载时密钥已就绪：严格模式重挂载 effect 只读取一次明文", async () => {
    queryClient.setQueryData(["creative-console", "client-keys"], [key()]);
    let latest: CreativeConsoleController | undefined;
    function ConsoleHarness(): null {
      latest = useCreativeConsole();
      return null;
    }

    render(
      <StrictMode>
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={queryClient}>
            <ConsoleHarness />
          </QueryClientProvider>
        </I18nextProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(latest?.panelProps("chat").apiKey).toBe("secret-1"));
    expect(keysApiMock.listClientKeys).not.toHaveBeenCalled();
    expect(keysApiMock.getClientKeySecret).toHaveBeenCalledTimes(1);
  });

  it("切换密钥后旧密钥的失败回调不回写错误", async () => {
    let rejectFirstSecret: ((error: unknown) => void) | undefined;
    keysApiMock.listClientKeys.mockResolvedValue({ items: [key({ id: "key-1" }), key({ id: "key-2" })], total: 2 });
    keysApiMock.getClientKeySecret.mockImplementation((id: string) => {
      if (id === "key-1") {
        return new Promise<{ secret: string }>((_resolve, reject) => {
          rejectFirstSecret = reject;
        });
      }
      return Promise.resolve({ secret: "secret-2" });
    });

    const { result } = renderConsole();
    await waitFor(() => expect(result.current.effectiveKeyId).toBe("key-1"));

    result.current.changeKey("key-2");
    await waitFor(() => expect(result.current.panelProps("chat").apiKey).toBe("secret-2"));

    rejectFirstSecret?.(new Error("旧密钥失败"));
    await waitFor(() => expect(keysApiMock.getClientKeySecret).toHaveBeenCalledTimes(2));
    expect(result.current.keyError).toBe("");
    expect(result.current.panelProps("chat").apiKey).toBe("secret-2");
  });
});
