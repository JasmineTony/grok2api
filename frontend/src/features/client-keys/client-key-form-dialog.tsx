import type { UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { ClientKeyDTO } from "@/features/client-keys/client-keys-api";
import {
  KeyBillingLimitField,
  KeyEnabledSection,
  KeyExpiryField,
  KeyLimitFields,
  KeyModelAliasesSection,
  KeyNameField,
} from "@/features/client-keys/client-key-form-fields";
import { ClientKeyScopeFields } from "@/features/client-keys/client-key-scope-fields";
import type { ClientKeyFormValues } from "@/features/client-keys/client-key-form-schema";

type ClientKeyFormDialogProps = {
  editing: ClientKeyDTO | "new" | null;
  form: UseFormReturn<ClientKeyFormValues>;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (values: ClientKeyFormValues) => void;
};

/** 创建/编辑密钥弹窗：表单实例由页面持有，弹窗只负责结构与提交入口。 */
export function ClientKeyFormDialog({ editing, form, isPending, onClose, onSubmit }: ClientKeyFormDialogProps) {
  const { t } = useTranslation();
  const isCreate = editing === "new";

  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[calc(100svh-2rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 text-xs sm:max-w-[560px]"
        data-testid="client-keys-form-dialog"
      >
        <DialogHeader className="shrink-0 px-5 py-4 pr-12">
          <DialogTitle>{isCreate ? t("keys.createTitle") : t("keys.editTitle")}</DialogTitle>
          <DialogDescription>{isCreate ? t("keys.description") : editing?.prefix}</DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 pb-4 pt-2">
            <KeyNameField form={form} />
            <KeyLimitFields form={form} />
            <div className="grid items-start gap-3 sm:grid-cols-2">
              <KeyBillingLimitField form={form} />
              <KeyExpiryField form={form} />
            </div>
            <KeyModelAliasesSection form={form} />
            <KeyEnabledSection form={form} />
            <ClientKeyScopeFields form={form} />
          </div>
          <DialogFooter className="shrink-0 gap-2 bg-muted/20 px-5 py-3.5 sm:gap-0">
            <Button type="button" variant="secondary" size="sm" onClick={onClose} data-testid="client-keys-form-cancel">
              {t("common.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={isPending} data-testid="client-keys-form-submit">
              {isPending ? <Spinner /> : null}
              {isCreate ? t("common.create") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
