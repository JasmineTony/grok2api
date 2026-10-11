import { beforeEach, describe, expect, it, vi } from "vitest";

import { importVideoInputFromURL, uploadMediaInput } from "@/entities/media/media-api";
import type { MediaInputDTO } from "@/entities/media/types";

// 媒体临时输入 API 层测试（AGENTS.md TEST-1/TEST-3）：只替换 apiRequest 这一个网络边界，
// 被测模块的两个导出函数与内部 decodeMediaInput 全部走真实实现。
// 消费方（creative-console）用 `vi.mock("@/entities/media/media-api")` 整体替换本模块，
// 真实函数体从未执行，这里补上直测。

const apiMock = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/shared/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/client")>();
  return { ...actual, apiRequest: apiMock.request };
});

type MediaRequestOptions = { method?: string; body?: unknown; headers?: unknown };
type RecordedCall = { path: string; options: MediaRequestOptions; decode: (value: unknown) => unknown };

const calls: RecordedCall[] = [];

/**
 * 替换 apiRequest：记录路径 / 选项 / 解码器，并按真实实现（shared/api/client.ts 的 parseResponse）
 * 的语义只把响应信封里的 data 交给 decoder。
 */
function installResponse(data: unknown): void {
  calls.length = 0;
  apiMock.request.mockImplementation(
    async (path: string, options: MediaRequestOptions, decode: RecordedCall["decode"]) => {
      calls.push({ path, options, decode });
      return decode(data);
    },
  );
}

function lastCall(): RecordedCall {
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1];
}

function mediaInput(overrides: Partial<MediaInputDTO> = {}): MediaInputDTO {
  return {
    fileId: "file-1",
    kind: "video",
    mimeType: "video/mp4",
    sizeBytes: 1024,
    expiresAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  apiMock.request.mockReset();
});

describe("importVideoInputFromURL", () => {
  it("以 JSON POST 提交 url，并把解码后的临时输入 DTO 原样返回", async () => {
    const input = mediaInput({ kind: "image", mimeType: "image/png" });
    installResponse(input);

    const result = await importVideoInputFromURL("https://example.com/a.png");

    // URL 导入只提交 url 字段的 JSON 体，不携带 multipart 表单。
    expect(apiMock.request).toHaveBeenCalledWith(
      "/api/admin/v1/media/inputs/import",
      { method: "POST", body: { url: "https://example.com/a.png" } },
      expect.any(Function),
    );
    expect(lastCall().options.body).not.toBeInstanceOf(FormData);
    expect(result).toEqual(input);
  });

  it("data 缺少任一必填字段时报 media input 契约错误", async () => {
    const requiredFields: (keyof MediaInputDTO)[] = ["fileId", "kind", "mimeType", "sizeBytes", "expiresAt"];

    for (const field of requiredFields) {
      const payload: Record<string, unknown> = { ...mediaInput() };
      delete payload[field];
      installResponse(payload);

      // 真实 apiRequest 会把解码失败统一包装成 ApiError(invalidResponse)（parseResponse）；
      // 这里替换的是 apiRequest 边界，因此断言的是被测解码器自身的错误。
      await expect(importVideoInputFromURL("https://example.com/a.mp4")).rejects.toThrowError(
        /media input response shape is invalid/,
      );
    }
    expect(apiMock.request).toHaveBeenCalledTimes(requiredFields.length);
  });
});

describe("uploadMediaInput", () => {
  it("以 multipart 表单提交文件、不手动设置 Content-Type，并返回解码后的 DTO", async () => {
    const input = mediaInput({ fileId: "file-2", kind: "image", mimeType: "image/png" });
    installResponse(input);
    const file = new File(["clip"], "clip.png", { type: "image/png" });

    const result = await uploadMediaInput(file);

    const { path, options } = lastCall();
    expect(path).toBe("/api/admin/v1/media/inputs/upload");
    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(FormData);
    const body = options.body as FormData;
    // 字段名为 "file"，且沿用文件自身的名字与类型（jsdom 会把 File 复制进 FormData，故比对字段值而非引用）。
    const uploaded = body.get("file") as File;
    expect(uploaded.name).toBe(file.name);
    expect(uploaded.type).toBe(file.type);
    expect(uploaded.size).toBe(file.size);
    // 手动设置 Content-Type 会丢掉浏览器生成的 multipart 边界，因此必须不传 headers。
    expect(options).not.toHaveProperty("headers");
    expect(result).toEqual(input);
  });

  it("每次上传使用独立的 FormData，不共享请求体", async () => {
    installResponse(mediaInput());
    const first = new File(["a"], "a.png", { type: "image/png" });
    const second = new File(["b"], "b.mp4", { type: "video/mp4" });

    await uploadMediaInput(first);
    await uploadMediaInput(second);

    expect(calls).toHaveLength(2);
    const firstBody = calls[0].options.body as FormData;
    const secondBody = calls[1].options.body as FormData;
    expect(firstBody).not.toBe(secondBody);
    expect((firstBody.get("file") as File).name).toBe("a.png");
    expect((secondBody.get("file") as File).name).toBe("b.mp4");
  });
});

describe("media input 解码契约", () => {
  it("data 不是对象时报契约错误", async () => {
    const invalidPayloads: unknown[] = [null, [], "media", 42, undefined];

    for (const payload of invalidPayloads) {
      installResponse(payload);
      await expect(uploadMediaInput(new File(["a"], "a.png"))).rejects.toThrowError(
        /media input response shape is invalid/,
      );
    }
    expect(apiMock.request).toHaveBeenCalledTimes(invalidPayloads.length);
  });

  it("字段类型非法（含非有限数字）时报契约错误", async () => {
    const invalidOverrides: Record<string, unknown>[] = [
      { fileId: 1 },
      { kind: null },
      { sizeBytes: "1024" },
      { sizeBytes: Number.NaN },
      { sizeBytes: Number.POSITIVE_INFINITY },
      { expiresAt: 0 },
    ];

    for (const override of invalidOverrides) {
      installResponse({ ...mediaInput(), ...override });
      await expect(importVideoInputFromURL("https://example.com/a.mp4")).rejects.toThrowError(
        /media input response shape is invalid/,
      );
    }
    expect(apiMock.request).toHaveBeenCalledTimes(invalidOverrides.length);
  });
});
