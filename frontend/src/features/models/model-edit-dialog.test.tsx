import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelEditDialog } from "@/features/models/model-edit-dialog";
import { installModelApi, modelRoute } from "@/features/models/models-test-support";
import { useModelDialogs } from "@/features/models/use-model-dialogs";
import { useModelForm, type ModelForm } from "@/features/models/use-model-form";
import { i18n } from "@/shared/i18n";

// model-edit-dialog 的分支覆盖：宿主使用真实的 useModelForm + useModelDialogs，
// 只替换网络边界（全局 fetch），断言标题分支、校验提示、账号搜索过滤、账号列表三态与页脚 pending。

function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}

type HarnessProps = {
  open: "new" | "edit";
  onSave?: (values: ModelForm) => void;
  savePending?: boolean;
};

/** 与 models-page 相同接线的宿主：通过按钮触发 beginCreate / beginEdit。 */
function Harness({ open, onSave = () => undefined, savePending = false }: HarnessProps) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }),
  );
  const form = useModelForm();
  const dialogs = useModelDialogs(form);
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <button
          type="button"
          data-testid="open"
          onClick={() => (open === "new" ? dialogs.beginCreate() : dialogs.beginEdit(modelRoute()))}
        >
          open
        </button>
        <ModelEditDialog dialogs={dialogs} save={{ isPending: savePending, mutate: onSave }} />
      </QueryClientProvider>
    </I18nextProvider>
  );
}

function renderDialog(props: HarnessProps) {
  const user = userEvent.setup({ delay: null });
  const view = render(<Harness {...props} />);
  return { ...view, user };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ModelEditDialog 身份字段与校验", () => {
  it("创建模式展示创建标题与描述，并暴露必填校验提示", async () => {
    const { user } = renderDialog({ open: "new" });
    await user.click(screen.getByTestId("open"));

    expect(await screen.findByText(t("models.createTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("models.createDescription"))).toBeInTheDocument();

    await user.click(screen.getByTestId("models-submit"));

    // 创建模式有 publicId 与 upstreamModel 两个必填项，两者都会渲染同一条提示。
    expect(await screen.findAllByText(t("errors.required"))).toHaveLength(2);
    expect(screen.queryByTestId("models-edit-dialog")).toBeInTheDocument();
  });

  it("编辑模式用上游模型作为描述，且不渲染仅创建字段", async () => {
    const { user } = renderDialog({ open: "edit" });
    await user.click(screen.getByTestId("open"));

    const dialog = await screen.findByTestId("models-edit-dialog");
    expect(dialog).toHaveTextContent(t("models.editTitle"));
    expect(dialog).toHaveTextContent("Build/grok-4");
    expect(screen.queryByLabelText(t("models.upstream"))).not.toBeInTheDocument();
  });

  it("提交有效表单时把表单值交给 save.mutate", async () => {
    const onSave = vi.fn();
    const { user } = renderDialog({ open: "new", onSave });
    await user.click(screen.getByTestId("open"));
    await screen.findByTestId("models-edit-dialog");

    await user.type(screen.getByLabelText(t("models.publicId")), "grok-5");
    await user.type(screen.getByLabelText(t("models.upstream")), "Build/grok-5");
    await user.click(screen.getByTestId("models-submit"));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ publicId: "grok-5", upstreamModel: "Build/grok-5" });
  });
});

describe("ModelEditDialog 启用状态与页脚", () => {
  it("切换启用开关会把 enabled 写回表单并更新标签", async () => {
    const { user } = renderDialog({ open: "new" });
    await user.click(screen.getByTestId("open"));
    await screen.findByTestId("models-edit-dialog");

    expect(screen.getByLabelText(t("common.enabled"))).toBeInTheDocument();

    await user.click(screen.getByLabelText(t("common.enabled")));

    expect(await screen.findByLabelText(t("common.disabled"))).toBeInTheDocument();
  });

  it("保存中禁用提交按钮并显示加载指示，创建模式文案为创建", async () => {
    const { user } = renderDialog({ open: "new", savePending: true });
    await user.click(screen.getByTestId("open"));
    await screen.findByTestId("models-edit-dialog");

    const submit = screen.getByTestId("models-submit");
    expect(submit).toBeDisabled();
    expect(submit).toHaveTextContent(t("common.create"));
    expect(submit.querySelector('[role="status"]')).not.toBeNull();

    await user.click(screen.getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(screen.queryByTestId("models-edit-dialog")).not.toBeInTheDocument());
  });

  it("编辑模式且空闲时提交按钮文案为保存且可用", async () => {
    const { user } = renderDialog({ open: "edit" });
    await user.click(screen.getByTestId("open"));
    await screen.findByTestId("models-edit-dialog");

    const submit = screen.getByTestId("models-submit");
    expect(submit).toBeEnabled();
    expect(submit).toHaveTextContent(t("common.save"));
    expect(submit.querySelector('[role="status"]')).toBeNull();
  });
});

describe("ModelEditDialog 账号绑定区", () => {
  it("打开绑定开关后按名称与 id 过滤账号列表", async () => {
    installModelApi({
      accountOptions: [
        { id: "7", name: "acc-alpha" },
        { id: "88", name: "beta" },
      ],
    });
    const { user } = renderDialog({ open: "new" });
    await user.click(screen.getByTestId("open"));
    await screen.findByTestId("models-edit-dialog");

    await user.click(screen.getByLabelText(t("models.bindAccounts")));
    expect(await screen.findByText("acc-alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();

    const search = screen.getByTestId("models-account-search");
    await user.type(search, "88");

    await waitFor(() => expect(screen.queryByText("acc-alpha")).not.toBeInTheDocument());
    expect(screen.getByText("beta")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "ALPHA");
    await waitFor(() => expect(screen.getByText("acc-alpha")).toBeInTheDocument());
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
  });

  it("账号列表为空时展示无可绑定账号文案", async () => {
    installModelApi({ accountOptions: [] });
    const { user } = renderDialog({ open: "new" });
    await user.click(screen.getByTestId("open"));
    await screen.findByTestId("models-edit-dialog");

    await user.click(screen.getByLabelText(t("models.bindAccounts")));

    expect(await screen.findByText(t("models.noBindableAccounts"))).toBeInTheDocument();
  });

  it("勾选后再次勾选同一账号不会重复计数（幂等）", async () => {
    installModelApi({ accountOptions: [{ id: "7", name: "acc-7" }] });
    const { user } = renderDialog({ open: "new" });
    await user.click(screen.getByTestId("open"));
    await screen.findByTestId("models-edit-dialog");

    await user.click(screen.getByLabelText(t("models.bindAccounts")));
    const checkbox = await screen.findByRole("checkbox", { name: /acc-7/ });

    await user.click(checkbox);
    expect(screen.getByText(t("models.selectedAccounts", { count: 1 }))).toBeInTheDocument();

    await user.click(checkbox);
    await user.click(checkbox);
    expect(screen.getByText(t("models.selectedAccounts", { count: 1 }))).toBeInTheDocument();
  });

  it("关闭绑定开关会清除账号校验错误", async () => {
    installModelApi({ accountOptions: [{ id: "7", name: "acc-7" }] });
    const { user } = renderDialog({ open: "new" });
    await user.click(screen.getByTestId("open"));
    await screen.findByTestId("models-edit-dialog");

    await user.type(screen.getByLabelText(t("models.publicId")), "grok-5");
    await user.type(screen.getByLabelText(t("models.upstream")), "Build/grok-5");
    await user.click(screen.getByLabelText(t("models.bindAccounts")));
    await screen.findByText("acc-7");

    await user.click(screen.getByTestId("models-submit"));
    expect(await screen.findByText(t("models.selectAccountRequired"))).toBeInTheDocument();

    await user.click(screen.getByLabelText(t("models.bindAccounts")));

    await waitFor(() => expect(screen.queryByText(t("models.selectAccountRequired"))).not.toBeInTheDocument());
  });
});

describe("ModelEditDialog 生命周期与 StrictMode", () => {
  it("StrictMode 双调用下仍能正常打开与关闭，且不会触发提交", async () => {
    installModelApi({ accountOptions: [] });
    const user = userEvent.setup({ delay: null });
    const onSave = vi.fn();
    render(
      <StrictMode>
        <Harness open="new" onSave={onSave} />
      </StrictMode>,
    );

    await user.click(screen.getByTestId("open"));
    await screen.findByTestId("models-edit-dialog");
    await user.click(screen.getByRole("button", { name: t("common.cancel") }));

    await waitFor(() => expect(screen.queryByTestId("models-edit-dialog")).not.toBeInTheDocument());
    expect(onSave).not.toHaveBeenCalled();
  });

  it("关闭后重新打开会重置校验错误（表单状态不跨次泄漏）", async () => {
    installModelApi({ accountOptions: [] });
    const { user } = renderDialog({ open: "new" });
    await user.click(screen.getByTestId("open"));
    await screen.findByTestId("models-edit-dialog");

    await user.click(screen.getByTestId("models-submit"));
    expect(await screen.findAllByText(t("errors.required"))).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(screen.queryByTestId("models-edit-dialog")).not.toBeInTheDocument());

    await user.click(screen.getByTestId("open"));
    await screen.findByTestId("models-edit-dialog");

    expect(screen.getByLabelText(t("models.publicId"))).toHaveValue("");
    expect(screen.queryAllByText(t("errors.required"))).toHaveLength(0);
  });
});
