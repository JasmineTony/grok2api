import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChangePasswordDialog } from "@/app/change-password-dialog";
import { useAuthStore } from "@/shared/auth/auth-store";
import { i18n } from "@/shared/i18n";

function renderDialog(onOpenChange: (open: boolean) => void = () => {}): void {
  render(
    <I18nextProvider i18n={i18n}>
      <ChangePasswordDialog open onOpenChange={onOpenChange} username="ops" />
    </I18nextProvider>,
  );
}

async function submitPasswords(): Promise<void> {
  const u = userEvent.setup();
  await u.type(screen.getByLabelText(i18n.t("auth.currentPassword")), "old-secret");
  await u.type(screen.getByLabelText(i18n.t("auth.newPassword")), "new-secret-1");
  await u.click(screen.getByRole("button", { name: i18n.t("common.save") }));
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChangePasswordDialog", () => {
  it("展示当前账号并校验新密码长度", async () => {
    renderDialog();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(i18n.t("auth.changePassword"));
    expect(dialog).toHaveTextContent("ops");

    await userEvent.setup().click(screen.getByRole("button", { name: i18n.t("common.save") }));
    expect(await screen.findByText(i18n.t("errors.required"))).toBeInTheDocument();
    expect(await screen.findByText(i18n.t("errors.minPassword"))).toBeInTheDocument();
  });

  it("改密失败且异常不是 Error 时提示通用错误并保持弹窗", async () => {
    const errorToast = vi.spyOn(toast, "error");
    const onOpenChange = vi.fn();
    useAuthStore.setState({
      changePassword: vi.fn(async () => {
        throw "server down";
      }),
    });

    renderDialog(onOpenChange);
    await submitPasswords();

    await waitFor(() => expect(errorToast).toHaveBeenCalledWith(i18n.t("errors.generic")));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("改密成功时清空表单并关闭弹窗", async () => {
    const changePassword = vi.fn(async () => {});
    const successToast = vi.spyOn(toast, "success");
    const onOpenChange = vi.fn();
    useAuthStore.setState({ changePassword, logout: vi.fn(async () => {}) });

    renderDialog(onOpenChange);
    await submitPasswords();

    await waitFor(() => expect(changePassword).toHaveBeenCalledWith("old-secret", "new-secret-1"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(successToast).toHaveBeenCalledWith(i18n.t("auth.passwordUpdated"));
    expect(within(screen.getByRole("dialog")).getByLabelText(i18n.t("auth.currentPassword"))).toHaveValue("");
  });
});
