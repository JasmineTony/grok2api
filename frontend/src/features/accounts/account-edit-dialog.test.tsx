import { zodResolver } from "@hookform/resolvers/zod";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, type FormEvent, type ReactNode } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountEditDialog } from "@/features/accounts/account-edit-dialog";
import {
  createAccountFormDefaults,
  createAccountFormSchema,
  type AccountForm,
} from "@/features/accounts/account-edit-form";
import type { AccountDTO, BuildRouteMode } from "@/features/accounts/accounts-dto";
import { i18n } from "@/shared/i18n";

// 账号编辑弹窗测试（AGENTS.md TEST-1/TEST-3）：用真实 react-hook-form + zod 校验驱动，
// 只断言用户可见结果与提交契约，不替换表单实现。

function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}

function account(overrides: Partial<AccountDTO> = {}): AccountDTO {
  return {
    id: "acct-1",
    provider: "grok_build",
    authType: "oauth",
    name: "build-alpha",
    enabled: true,
    authStatus: "active",
    refreshable: true,
    cloudflareCookieConfigured: false,
    buildSuperEntitled: false,
    buildRouteMode: "auto",
    buildBotFlagged: false,
    refreshFailureCount: 0,
    priority: 1,
    maxConcurrent: 8,
    minimumRemaining: 0,
    failureCount: 0,
    createdAt: "2026-01-02T03:04:05Z",
    quota: {
      type: "free",
      source: "responseModel",
      confidence: "confirmed",
      status: "active",
      used: 1,
      limit: 10,
      remaining: 9,
      usagePercent: 10,
      limitKnown: true,
      observed: true,
      confirmed: true,
    },
    ...overrides,
  };
}

let formRef: UseFormReturn<AccountForm> | null = null;
let submittedValues: AccountForm | null = null;

function EditDialogHarness({
  editing,
  pending = false,
  accountEnabled = true,
  clearCloudflareCookies = false,
  buildSuperEntitled = false,
  buildRouteMode = "auto",
  validateForm = false,
  onClose = vi.fn(),
  onSubmit = vi.fn(),
}: {
  editing: AccountDTO | null;
  pending?: boolean;
  accountEnabled?: boolean;
  clearCloudflareCookies?: boolean;
  buildSuperEntitled?: boolean;
  buildRouteMode?: BuildRouteMode;
  validateForm?: boolean;
  onClose?: () => void;
  onSubmit?: () => void;
}): ReactNode {
  const form = useForm<AccountForm>({
    resolver: zodResolver(createAccountFormSchema(i18n.t)),
    defaultValues: { ...createAccountFormDefaults(), name: "build-alpha" },
  });
  useEffect(() => {
    formRef = form;
  });
  // validateForm 时让弹窗真正走一遍 zod 校验，用来断言“非法输入不会提交”。
  const handleSubmit = validateForm
    ? (event: FormEvent<HTMLFormElement>) =>
        void form.handleSubmit((values) => {
          submittedValues = values;
          onSubmit();
        })(event)
    : onSubmit;
  return (
    <AccountEditDialog
      editing={editing}
      form={form}
      pending={pending}
      accountEnabled={accountEnabled}
      clearCloudflareCookies={clearCloudflareCookies}
      buildSuperEntitled={buildSuperEntitled}
      buildRouteMode={buildRouteMode}
      onClose={onClose}
      onSubmit={handleSubmit}
    />
  );
}

function renderEditDialog(props: Parameters<typeof EditDialogHarness>[0]) {
  const user = userEvent.setup();
  const view = render(
    <I18nextProvider i18n={i18n}>
      <EditDialogHarness {...props} />
    </I18nextProvider>,
  );
  return { ...view, user };
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
  formRef = null;
  submittedValues = null;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

describe("AccountEditDialog", () => {
  it("未选中账号时不渲染弹窗", () => {
    renderEditDialog({ editing: null });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(t("accounts.name"))).not.toBeInTheDocument();
  });

  it("Build 账号展示基础字段、权益开关与路由模式，不展示 Cloudflare Cookie", () => {
    renderEditDialog({ editing: account() });

    expect(screen.getByRole("dialog")).toHaveTextContent(`${t("common.edit")} build-alpha`);
    for (const label of [
      t("accounts.name"),
      t("accounts.priority"),
      t("accounts.maxConcurrent"),
      t("accounts.minimumRemaining"),
      t("accounts.buildSuperEntitled.label"),
      t("accounts.buildRouteMode.label"),
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText(t("common.enabled"))).toBeInTheDocument();
    expect(screen.queryByLabelText(t("settings.egress.cloudflareCookie"))).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: t("accounts.buildRouteMode.auto") })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: t("accounts.buildRouteMode.build") })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: t("accounts.buildRouteMode.xai") })).toBeInTheDocument();
  });

  it("账号停用时启用开关展示停用文案", () => {
    renderEditDialog({ editing: account({ enabled: false }), accountEnabled: false });

    expect(screen.getByLabelText(t("common.disabled"))).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: t("common.disabled") })).not.toBeChecked();
  });

  it("xai 路由在未确认超级额度时给出警示，满足任一豁免条件则隐藏", () => {
    const warned = renderEditDialog({ editing: account(), buildRouteMode: "xai" });
    expect(screen.getByText(t("accounts.buildRouteMode.xaiUnconfirmedWarning"))).toBeInTheDocument();
    warned.unmount();

    const entitled = renderEditDialog({ editing: account(), buildRouteMode: "xai", buildSuperEntitled: true });
    expect(screen.queryByText(t("accounts.buildRouteMode.xaiUnconfirmedWarning"))).not.toBeInTheDocument();
    entitled.unmount();

    const paid = renderEditDialog({
      editing: account({
        quota: {
          type: "paid",
          source: "responseModel",
          confidence: "confirmed",
          status: "active",
          used: 1,
          limit: 10,
          remaining: 9,
          usagePercent: 10,
          limitKnown: true,
          observed: true,
          confirmed: true,
        },
      }),
      buildRouteMode: "xai",
    });
    expect(screen.queryByText(t("accounts.buildRouteMode.xaiUnconfirmedWarning"))).not.toBeInTheDocument();
    paid.unmount();

    renderEditDialog({ editing: account(), buildRouteMode: "auto" });
    expect(screen.queryByText(t("accounts.buildRouteMode.xaiUnconfirmedWarning"))).not.toBeInTheDocument();
  });

  it("Web 账号展示 Cloudflare Cookie 字段，已配置时可选择清空", async () => {
    const web = account({ provider: "grok_web", cloudflareCookieConfigured: true });
    const { user, unmount } = renderEditDialog({ editing: web });

    const textarea = screen.getByLabelText(t("settings.egress.cloudflareCookie")) as HTMLTextAreaElement;
    expect(textarea).toHaveAttribute("placeholder", t("settings.egress.keepConfigured"));
    expect(textarea).toBeEnabled();

    await user.click(screen.getByRole("checkbox", { name: t("common.clear") }));
    expect(formRef?.getValues("clearCloudflareCookies")).toBe(true);
    unmount();

    // 未配置 Cookie 时没有清空入口，占位文案回退为示例值。
    renderEditDialog({ editing: account({ provider: "grok_console" }) });
    expect(screen.queryByRole("checkbox", { name: t("common.clear") })).not.toBeInTheDocument();
    expect(screen.getByLabelText(t("settings.egress.cloudflareCookie"))).toHaveAttribute(
      "placeholder",
      "cf_clearance=...",
    );
  });

  it("已开启清空时 Cookie 输入框被禁用，避免同时提交两套语义", () => {
    renderEditDialog({
      editing: account({ provider: "grok_web", cloudflareCookieConfigured: true }),
      clearCloudflareCookies: true,
    });

    expect(screen.getByLabelText(t("settings.egress.cloudflareCookie"))).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: t("common.clear") })).toBeChecked();
  });

  it("描述行优先展示邮箱，缺失时回退为用户 ID", () => {
    const withEmail = renderEditDialog({ editing: account({ email: "a@example.com", userId: "uid-1" }) });
    expect(screen.getByRole("dialog")).toHaveTextContent("a@example.com");
    withEmail.unmount();

    renderEditDialog({ editing: account({ userId: "uid-2" }) });
    expect(screen.getByRole("dialog")).toHaveTextContent("uid-2");
  });

  it("名称与 Cloudflare Cookie 校验失败时展示字段级错误且不提交", async () => {
    const { user } = renderEditDialog({
      editing: account({ provider: "grok_web", cloudflareCookieConfigured: true }),
      validateForm: true,
    });

    await user.clear(screen.getByLabelText(t("accounts.name")));
    await user.click(screen.getByRole("button", { name: t("common.save") }));

    expect(await screen.findByText(t("errors.required"))).toBeInTheDocument();
    expect(submittedValues).toBeNull();

    // 超过 16KiB 的 Cookie 文本被拒绝。
    fireEvent.change(screen.getByLabelText(t("accounts.name")), { target: { value: "build-alpha" } });
    fireEvent.change(screen.getByLabelText(t("settings.egress.cloudflareCookie")), {
      target: { value: "x".repeat((16 << 10) + 1) },
    });
    fireEvent.submit(screen.getByRole("button", { name: t("common.save") }).closest("form") as HTMLFormElement);

    expect(await screen.findByText(t("settings.invalidValue"))).toBeInTheDocument();
    expect(submittedValues).toBeNull();

    // 修正 Cookie 后提交才会带上表单值。
    fireEvent.change(screen.getByLabelText(t("settings.egress.cloudflareCookie")), {
      target: { value: "cf_clearance=ok" },
    });
    fireEvent.submit(screen.getByRole("button", { name: t("common.save") }).closest("form") as HTMLFormElement);

    await waitFor(() => expect(submittedValues).not.toBeNull());
    expect(submittedValues).toMatchObject({ name: "build-alpha", cloudflareCookies: "cf_clearance=ok" });
  });

  it("切换启用开关与路由模式会写回表单值", async () => {
    const { user } = renderEditDialog({ editing: account() });

    await user.click(screen.getByRole("switch", { name: t("common.enabled") }));
    expect(formRef?.getValues("enabled")).toBe(false);

    await user.click(screen.getByRole("tab", { name: t("accounts.buildRouteMode.xai") }));
    expect(formRef?.getValues("buildRouteMode")).toBe("xai");

    await user.click(screen.getByRole("switch", { name: t("accounts.buildSuperEntitled.label") }));
    expect(formRef?.getValues("buildSuperEntitled")).toBe(true);
  });

  it("进行中禁用保存按钮，取消与保存分别回调", async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const pending = renderEditDialog({ editing: account(), pending: true, onClose, onSubmit });

    const save = screen.getByRole("button", { name: new RegExp(t("common.save")) });
    expect(save).toBeDisabled();
    expect(save.querySelector('[role="status"]')).not.toBeNull();
    pending.unmount();

    const { user } = renderEditDialog({ editing: account(), validateForm: true, onClose });
    await user.type(screen.getByLabelText(t("accounts.name")), "2");
    await user.click(screen.getByRole("button", { name: t("common.save") }));
    await waitFor(() => expect(submittedValues).toMatchObject({ name: "build-alpha2" }));

    await user.click(screen.getByRole("button", { name: t("common.cancel") }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
