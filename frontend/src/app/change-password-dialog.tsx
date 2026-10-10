import { zodResolver } from "@hookform/resolvers/zod";
import type { TFunction } from "i18next";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/shared/auth/use-auth";

type ChangePasswordDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  username?: string;
};

/** 修改密码弹窗：标题展示当前账号，表单与成功后的退出登录在 ChangePasswordForm。 */
export function ChangePasswordDialog({ open, onOpenChange, username }: ChangePasswordDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("auth.changePassword")}</DialogTitle>
          <DialogDescription>{username}</DialogDescription>
        </DialogHeader>
        <ChangePasswordForm onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function createPasswordSchema(t: TFunction) {
  return z.object({
    currentPassword: z.string().min(1, t("errors.required")),
    newPassword: z.string().min(8, t("errors.minPassword")),
  });
}

type PasswordForm = z.infer<ReturnType<typeof createPasswordSchema>>;

/** 改密表单：校验规则与错误文案保持原实现，成功后提示并退出登录。 */
function ChangePasswordForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { logout, changePassword } = useAuth();
  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(createPasswordSchema(t)),
    defaultValues: { currentPassword: "", newPassword: "" },
  });

  async function submitPassword(values: PasswordForm): Promise<void> {
    try {
      await changePassword(values.currentPassword, values.newPassword);
      toast.success(t("auth.passwordUpdated"));
      passwordForm.reset();
      onClose();
      await logout();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("errors.generic"));
    }
  }

  return (
    <form className="space-y-4" onSubmit={passwordForm.handleSubmit(submitPassword)}>
      <PasswordField
        id="current-password"
        label={t("auth.currentPassword")}
        autoComplete="current-password"
        error={passwordForm.formState.errors.currentPassword?.message}
        registration={passwordForm.register("currentPassword")}
      />
      <PasswordField
        id="new-password"
        label={t("auth.newPassword")}
        autoComplete="new-password"
        error={passwordForm.formState.errors.newPassword?.message}
        registration={passwordForm.register("newPassword")}
      />
      <DialogFooter>
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={passwordForm.formState.isSubmitting}>
          {t("common.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function PasswordField({
  id,
  label,
  autoComplete,
  error,
  registration,
}: {
  id: string;
  label: string;
  autoComplete: string;
  error?: string;
  registration: UseFormRegisterReturn;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="password" autoComplete={autoComplete} {...registration} />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
