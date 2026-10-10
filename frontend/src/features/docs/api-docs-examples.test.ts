import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createExamples,
  fallbackModel,
  selectDocsModels,
  selectExampleModel,
  uniqueModelsByPublicID,
} from "./api-docs-examples.ts";
import { endpoints } from "./endpoint-definitions.ts";

const chat = endpoints["chat/completions"];
const messages = endpoints["chat/messages"];
const sttVoices = endpoints["voice/voices"];
const realtime = endpoints["voice/realtime"];
const videoGet = endpoints["video/get"];
const imageEdit = endpoints["image/edits"];
const imageGenerations = endpoints["image/generations"];

describe("fallbackModel", () => {
  it("按端点分类回退到默认模型", () => {
    assert.equal(fallbackModel("chat/completions"), "your-enabled-model");
    assert.equal(fallbackModel("image/generations"), "grok-imagine-image-lite");
    assert.equal(fallbackModel("image/edits"), "grok-imagine-image-edit");
    assert.equal(fallbackModel("video/generations"), "grok-imagine-video");
    assert.equal(fallbackModel("voice/stt"), "grok-stt");
    assert.equal(fallbackModel("voice/audio-transcriptions"), "grok-stt");
    assert.equal(fallbackModel("voice/tts"), "grok-voice-latest");
  });
});

describe("createExamples", () => {
  it("chat 端点生成三种语言示例并使用 Bearer 鉴权", () => {
    const examples = createExamples(chat, "https://api.example.com/v1", "grok-4");

    assert.match(examples.curl, /curl -X POST "https:\/\/api\.example\.com\/v1\/chat\/completions"/);
    assert.match(examples.curl, /Authorization: Bearer \$GROK2API_API_KEY/);
    assert.match(examples.curl, /-d '\{/);
    assert.match(examples.python, /import json\nimport requests/);
    assert.match(examples.python, /payload = json\.loads/);
    assert.match(examples.javascript, /body: JSON\.stringify\(\{/);
  });

  it("messages 端点使用 x-api-key 与 anthropic-version 头", () => {
    const examples = createExamples(messages, "https://api.example.com/v1", "grok-4");

    assert.match(examples.curl, /x-api-key: \$GROK2API_API_KEY/);
    assert.match(examples.curl, /anthropic-version: 2023-06-01/);
    assert.match(examples.python, /"x-api-key": "g2a_your_api_key"/);
  });

  it("带查询参数的端点把编码后的模型写入 URL", () => {
    const voices = createExamples(sttVoices, "https://api.example.com/v1", "grok voice");
    const ws = createExamples(realtime, "https://api.example.com/v1", "grok-voice-latest");

    assert.match(voices.curl, /\?model=grok%20voice/);
    assert.match(ws.curl, /\?model=grok-voice-latest/);
    assert.match(ws.curl, /curl -X GET/);
  });

  it("GET 端点替换路径参数且不生成请求体", () => {
    const examples = createExamples(videoGet, "https://api.example.com/v1", "grok-imagine-video");
    const edit = createExamples(imageEdit, "https://api.example.com/v1", "grok-imagine-image-edit");

    assert.match(examples.curl, /\/v1\/videos\/video_example"/);
    assert.doesNotMatch(examples.curl, /-d '/);
    assert.doesNotMatch(examples.python, /json\.loads/);
    assert.doesNotMatch(examples.javascript, /body: JSON\.stringify/);
    assert.match(edit.curl, /-d '\{/);
  });
});

describe("模型选择", () => {
  const model = (publicId: string, overrides = {}) => ({
    id: `route-${publicId}`,
    publicId,
    provider: "grok_build" as const,
    upstreamModel: `Build/${publicId}`,
    capability: "responses" as const,
    origin: "catalog" as const,
    enabled: true,
    accountIds: [],
    bindingMode: false,
    supportedAccounts: 1,
    syncedAccounts: 1,
    totalAccounts: 1,
    capabilityKnown: true,
    available: true,
    lastSyncedAt: "2026-01-02T03:04:05Z",
    ...overrides,
  });

  it("按能力、启用与可用状态过滤并按 publicId 去重", () => {
    const models = [
      model("grok-4"),
      model("grok-4"),
      model("grok-4-web", { capability: "chat", available: false }),
      model("grok-4-off", { enabled: false }),
      model("grok-image", { capability: "image" }),
    ];

    assert.deepEqual(
      selectDocsModels(chat, models).map((item) => item.publicId),
      ["grok-4"],
    );
    assert.deepEqual(
      selectDocsModels(imageGenerations, models).map((item) => item.publicId),
      ["grok-image"],
    );
    assert.deepEqual(selectDocsModels(sttVoices, models), []);
    assert.equal(uniqueModelsByPublicID(models).length, 4);
  });

  it("优先保留仍可用的选择，否则回退到首个模型或端点默认值", () => {
    const models = [model("grok-4"), model("grok-5")];

    assert.equal(selectExampleModel(chat, models, "grok-5"), "grok-5");
    assert.equal(selectExampleModel(chat, models, "removed-model"), "grok-4");
    assert.equal(selectExampleModel(chat, [], ""), "your-enabled-model");
    assert.equal(selectExampleModel(imageEdit, [], ""), "grok-imagine-image-edit");
  });
});

describe("所有端点的示例生成", () => {
  it("每个端点都能生成三种语言示例", () => {
    for (const [key, definition] of Object.entries(endpoints)) {
      const examples = createExamples(definition, "https://api.example.com/v1", "example-model");
      assert.ok(examples.curl.length > 0 && examples.python.length > 0 && examples.javascript.length > 0, key);
    }
  });
});
