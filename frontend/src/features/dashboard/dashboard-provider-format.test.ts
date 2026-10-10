import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TFunction } from "i18next";

import {
  buildProviderStripes,
  collectProviderUsage,
  PROVIDERS,
  providerLabel,
  STRIPE_COUNT,
} from "./dashboard-provider-format.ts";

const t = ((key: string) => key) as unknown as TFunction;

describe("collectProviderUsage", () => {
  it("按固定顺序对齐三类 Provider，缺失的计 0", () => {
    const usage = collectProviderUsage([
      { provider: "grok_web", requests: 5, successfulRequests: 4, tokens: 100 },
      { provider: "unknown", requests: 9, successfulRequests: 9, tokens: 9 },
    ]);

    assert.deepEqual(
      usage.map((item) => item.key),
      ["grok_build", "grok_web", "grok_console"],
    );
    assert.deepEqual(
      usage.map((item) => item.requests),
      [0, 5, 0],
    );
    assert.deepEqual(
      usage.map((item) => item.successfulRequests),
      [0, 4, 0],
    );
  });

  it("没有数据时全部计 0", () => {
    const usage = collectProviderUsage(undefined);

    assert.equal(usage.length, PROVIDERS.length);
    assert.equal(
      usage.reduce((total, item) => total + item.tokens, 0),
      0,
    );
  });
});

describe("buildProviderStripes", () => {
  it("无请求时全部为空色带", () => {
    const stripes = buildProviderStripes([], 0);

    assert.equal(stripes.length, STRIPE_COUNT);
    assert.equal(
      stripes.some((item) => item !== null),
      false,
    );
  });

  it("按请求占比映射色带，全部落在已有 Provider 上", () => {
    const providers = [
      { key: "a", requests: 3 },
      { key: "b", requests: 1 },
    ];
    const stripes = buildProviderStripes(providers, 4);

    assert.equal(stripes.length, STRIPE_COUNT);
    assert.equal(stripes.filter((item) => item?.key === "a").length, 30);
    assert.equal(stripes.filter((item) => item?.key === "b").length, 10);
  });

  it("占比不足时最后一条色带仍归属最后一个 Provider", () => {
    const stripes = buildProviderStripes([{ key: "only", requests: 1 }], 1);

    assert.equal(stripes.at(-1)?.key, "only");
  });
});

describe("providerLabel", () => {
  it("三类 Provider 使用各自的 i18n key", () => {
    assert.equal(providerLabel("grok_build", t), "models.providerGrokBuild");
    assert.equal(providerLabel("grok_web", t), "models.providerGrokWeb");
    assert.equal(providerLabel("grok_console", t), "console.name");
  });
});
