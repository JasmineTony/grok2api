import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatBytes,
  formatMediaType,
  formatSpec,
  imageAssetURL,
  isTerminalVideoJob,
  videoAssetURL,
} from "./media-format.ts";

describe("formatBytes", () => {
  it("按 1024 进制切换单位并保留一位小数", () => {
    assert.equal(formatBytes(0, "en"), "0 B");
    assert.equal(formatBytes(-1, "en"), "0 B");
    assert.equal(formatBytes(Number.NaN, "en"), "0 B");
    assert.equal(formatBytes(512, "en"), "512 B");
    assert.equal(formatBytes(1024, "en"), "1 KB");
    assert.equal(formatBytes(1536, "en"), "1.5 KB");
    assert.equal(formatBytes(20 * 1024, "en"), "20 KB");
    assert.equal(formatBytes(1024 * 1024 * 1024, "en"), "1 GB");
  });
});

describe("formatMediaType", () => {
  it("优先使用 MIME 子类型，去除参数并回退到 kind", () => {
    const base = {
      id: "image-1",
      kind: "image",
      mimeType: "image/png",
      sizeBytes: 1,
      sha256: "h",
      createdAt: "",
      url: "",
    };

    assert.equal(formatMediaType(base), "png");
    assert.equal(formatMediaType({ ...base, mimeType: "image/webp; charset=binary" }), "webp");
    assert.equal(formatMediaType({ ...base, mimeType: "" }), "image");
    assert.equal(formatMediaType({ ...base, mimeType: "", kind: "" }), "-");
  });
});

describe("媒体任务辅助函数", () => {
  const job = {
    id: "job-1",
    model: "grok-imagine-video",
    prompt: "prompt",
    status: "completed" as const,
    progress: 100,
    seconds: 8,
    size: "1280x720",
    quality: "720p",
    accountName: "account-1",
    clientKeyName: "key-1",
    createdAt: "2026-01-02T03:04:05Z",
    completedAt: "2026-01-02T03:05:05Z",
    errorMessage: "",
    assetId: "asset-1",
  };

  it("只有终态任务算完成", () => {
    assert.equal(isTerminalVideoJob(job), true);
    assert.equal(isTerminalVideoJob({ ...job, status: "failed" }), true);
    assert.equal(isTerminalVideoJob({ ...job, status: "queued" }), false);
    assert.equal(isTerminalVideoJob({ ...job, status: "in_progress" }), false);
  });

  it("规格文案合并尺寸与画质，缺失时给出占位符", () => {
    assert.equal(formatSpec(job), "1280x720 · 720p");
    assert.equal(formatSpec({ ...job, size: "", quality: "" }), "-");
    assert.equal(formatSpec({ ...job, size: "1280x720", quality: "" }), "1280x720");
  });

  it("资源地址对 ID 做 URL 编码", () => {
    assert.equal(imageAssetURL("a/b c"), "/v1/media/images/a%2Fb%20c");
    assert.equal(videoAssetURL("asset-1"), "/v1/media/videos/asset-1");
  });
});
