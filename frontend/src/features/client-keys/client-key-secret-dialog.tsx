import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { CopyButton } from "@/shared/components/copy-button";

export type SecretDialogState = {
  secret: string;
  source: "created" | "retrieved";
};

/**
 * 密钥明文弹窗：创建成功与手动复制共用同一结构，标题/描述按来源区分。
 * 关闭后明文不再保留在页面上，因此创建场景只显示一次。
 */
export function ClientKeySecretDialog({ state, onClose }: { state: SecretDialogState | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[440px]" data-testid="client-keys-secret-dialog">
        <DialogHeader>
          <DialogTitle>{t(state?.source === "created" ? "keys.secretTitle" : "keys.copySecretTitle")}</DialogTitle>
          <DialogDescription>
            {t(state?.source === "created" ? "keys.secretDescription" : "keys.copySecretDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-1.5">
          <Label>{t("keys.secretLabel")}</Label>
          <div className="flex h-8 w-full min-w-0 overflow-hidden rounded-md border border-input bg-secondary/55">
            <code
              className="flex min-w-0 flex-1 select-all items-center overflow-x-auto whitespace-nowrap px-3 font-mono text-xs text-muted-foreground"
              data-testid="client-keys-secret-value"
            >
              {state?.secret ?? ""}
            </code>
            <CopyButton
              value={state?.secret ?? ""}
              copyLabel={t("keys.copySecret")}
              disabled={!state?.secret}
              className="h-full w-8 shrink-0 rounded-none border-l"
              onCopied={() => toast.success(t("common.copied"))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" size="sm" onClick={onClose} data-testid="client-keys-secret-close">
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
