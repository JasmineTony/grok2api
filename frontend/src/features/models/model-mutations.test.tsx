import type { TFunction } from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ModelRouteDTO } from "@/entities/model/types";
import { deleteModelRoutes, saveModel, showModelError } from "@/features/models/model-mutations";
import type { ModelForm } from "@/features/models/use-model-form";
import { i18n } from "@/shared/i18n";

// model-mutations 的纯逻辑测试：只替换 API 边界与 toast 边界，
// 被测函数保持真实实现，断言以「发到哪个 API、带什么入参、提示什么文案」为准。

const mocks = vi.hoisted(() => ({
  createModel: vi.fn(),
  deleteModel: vi.fn(),
  deleteModels: vi.fn(),
  updateModel: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/entities/model/model-api", () => ({
  createModel: mocks.createModel,
  deleteModel: mocks.deleteModel,
  deleteModels: mocks.deleteModels,
  updateModel: mocks.updateModel,
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: vi.fn(), loading: vi.fn() } }));

// 与被测函数声明的 TFunction 契约一致（同 dashboard-*-format.test.ts 的既有做法）。
const t = ((key: string, options?: Record<string, unknown>) => i18n.t(key, options)) as unknown as TFunction;

function form(overrides: Partial<ModelForm> = {}): ModelForm {
  return {
    publicId: "grok-5",
    provider: "grok_build",
    upstreamModel: "Build/grok-5",
    capability: "responses",
    enabled: true,
    bindingMode: false,
    accountIds: [],
    ...overrides,
  };
}

function route(overrides: Partial<ModelRouteDTO> = {}): ModelRouteDTO {
  return {
    id: "route-1",
    publicId: "grok-4",
    provider: "grok_build",
    upstreamModel: "Build/grok-4",
    capability: "responses",
    origin: "catalog",
    enabled: true,
    accountIds: [],
    bindingMode: false,
    supportedAccounts: 3,
    syncedAccounts: 3,
    totalAccounts: 4,
    capabilityKnown: true,
    available: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveModel", () => {
  it("未打开编辑器时抛出通用错误且不调用任何 API", () => {
    expect(() => saveModel(null, form(), t)).toThrow(t("errors.generic"));
    expect(mocks.createModel).not.toHaveBeenCalled();
    expect(mocks.updateModel).not.toHaveBeenCalled();
  });

  it("创建时不绑定账号则提交空 accountIds", () => {
    mocks.createModel.mockResolvedValue(route());

    void saveModel("new", form({ accountIds: ["7"], bindingMode: false }), t);

    expect(mocks.createModel).toHaveBeenCalledWith({
      publicId: "grok-5",
      provider: "grok_build",
      upstreamModel: "Build/grok-5",
      capability: "responses",
      enabled: true,
      bindingMode: false,
      accountIds: [],
    });
  });

  it("创建时开启绑定账号则原样提交选中账号", () => {
    mocks.createModel.mockResolvedValue(route());

    void saveModel("new", form({ accountIds: ["7", "8"], bindingMode: true }), t);

    expect(mocks.createModel.mock.calls[0][0]).toMatchObject({ accountIds: ["7", "8"] });
  });

  it("编辑时只提交可更新字段（publicId / enabled / accountIds）", () => {
    mocks.updateModel.mockResolvedValue(route());

    void saveModel(route({ id: "route-9" }), form({ accountIds: ["3"], bindingMode: true }), t);

    expect(mocks.updateModel).toHaveBeenCalledWith("route-9", {
      publicId: "grok-5",
      enabled: true,
      accountIds: ["3"],
    });
    expect(mocks.createModel).not.toHaveBeenCalled();
  });

  it("编辑时关闭绑定账号同样清空 accountIds", () => {
    mocks.updateModel.mockResolvedValue(route());

    void saveModel(route(), form({ accountIds: ["3"], bindingMode: false }), t);

    expect(mocks.updateModel.mock.calls[0][1]).toMatchObject({ accountIds: [] });
  });
});

describe("deleteModelRoutes", () => {
  it("单条路由走单体删除接口", () => {
    mocks.deleteModel.mockResolvedValue({ deleted: true });

    void deleteModelRoutes([route({ id: "route-1" })]);

    expect(mocks.deleteModel).toHaveBeenCalledWith("route-1");
    expect(mocks.deleteModels).not.toHaveBeenCalled();
  });

  it("多条路由走批量删除接口并带上全部 id", () => {
    mocks.deleteModels.mockResolvedValue({ deleted: 2 });

    void deleteModelRoutes([route({ id: "route-1" }), route({ id: "route-2" })]);

    expect(mocks.deleteModels).toHaveBeenCalledWith(["route-1", "route-2"]);
    expect(mocks.deleteModel).not.toHaveBeenCalled();
  });

  it("没有路由时仍然走批量接口而不是单体删除", () => {
    mocks.deleteModels.mockResolvedValue({ deleted: 0 });

    void deleteModelRoutes([]);

    expect(mocks.deleteModels).toHaveBeenCalledWith([]);
    expect(mocks.deleteModel).not.toHaveBeenCalled();
  });
});

describe("showModelError", () => {
  it("Error 时展示原始 message", () => {
    showModelError(new Error("modelDeleteFailed"), t);

    expect(mocks.toastError).toHaveBeenCalledWith("modelDeleteFailed");
  });

  it("非 Error 时回退到通用文案", () => {
    showModelError("socket hang up", t);

    expect(mocks.toastError).toHaveBeenCalledWith(t("errors.generic"));
  });
});
