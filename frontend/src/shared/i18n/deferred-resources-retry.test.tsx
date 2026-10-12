import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FE-19-8 回归：`loadDeferredResources()` 的 Promise 单例在失败后必须被重置。
 *
 * 缺陷：`deferredResourcesPromise ??= import(...)` 会把 rejected Promise 永久缓存，
 * 一次瞬态 chunk 失败之后，任何后续导航都会复用同一个失败 Promise 而持续失败。
 *
 * 本文件只替换资源模块这一个边界（`./resources/deferred`），被测的单例逻辑、真实 i18n 实例
 * 与真实 `addResourceBundle` 调用保持真实。每个用例先 `vi.resetModules()`，从而拿到全新的
 * `shared/i18n` 单例与归零的模块工厂计数（`src/test/setup.ts` 的 beforeAll 已真实加载过一次）。
 */

const failure = new Error("文案 chunk 加载失败");

const deferredFixture = {
  "zh-CN": { translation: { deferredProbe: "延迟文案" } },
  en: { translation: { deferredProbe: "Deferred copy" } },
};

let factoryCalls = 0;
let failFirstImport = false;

beforeEach(() => {
  vi.resetModules();
  factoryCalls = 0;
  failFirstImport = false;
  vi.doMock("./resources/deferred", () => {
    factoryCalls += 1;
    if (failFirstImport && factoryCalls === 1) return Promise.reject(failure);
    return { default: deferredFixture };
  });
});

afterEach(() => {
  vi.doUnmock("./resources/deferred");
  vi.resetModules();
});

/**
 * Vitest 会用自己的错误包装模块工厂的 rejection，原始加载错误保留在 `cause` 中
 * （与 `deferred-pages-loading.test.tsx` 对模块失败的处理口径一致）。
 */
function originalError(error: unknown): unknown {
  return error instanceof Error && error.cause !== undefined ? error.cause : error;
}

describe("loadDeferredResources 失败重试", () => {
  it("首次加载失败后再次调用会重新请求并成功，不再复用失败态", async () => {
    failFirstImport = true;
    const { loadDeferredResources, i18n } = await import("@/shared/i18n");

    const firstError = await loadDeferredResources().catch((error: unknown) => error);
    expect(originalError(firstError)).toBe(failure);
    expect(factoryCalls).toBe(1);
    // 失败不得写入半成品文案（禁止静默降级为默认值）。
    expect(i18n.getResource("zh-CN", "translation", "deferredProbe")).toBeUndefined();

    await expect(loadDeferredResources()).resolves.toBeUndefined();
    expect(factoryCalls).toBe(2);
    expect(i18n.getResource("zh-CN", "translation", "deferredProbe")).toBe("延迟文案");
    expect(i18n.getResource("en", "translation", "deferredProbe")).toBe("Deferred copy");
  });

  it("失败不静默吞掉：错误对象原样上抛给调用方", async () => {
    failFirstImport = true;
    const { loadDeferredResources } = await import("@/shared/i18n");

    const observed = await loadDeferredResources().then(
      () => new Error("失败被静默吞掉：Promise 意外 resolve"),
      (error: unknown) => error,
    );
    expect(originalError(observed)).toBe(failure);
  });

  it("成功路径连调两次只加载一次资源模块（失败重置不得退化成每次重置）", async () => {
    const { loadDeferredResources } = await import("@/shared/i18n");

    await Promise.all([loadDeferredResources(), loadDeferredResources()]);
    await loadDeferredResources();

    expect(factoryCalls).toBe(1);
  });
});
