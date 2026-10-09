import { FileUp } from "lucide-react";
import { useRef, type ReactNode, type RefObject } from "react";
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
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { AccountProvider } from "@/features/accounts/accounts-dto";

type QuickImportDialogProps = {
  open: boolean;
  provider: AccountProvider;
  tokens: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onTokensChange: (value: string) => void;
  onFileSelected: (file: File | undefined) => void;
  onSubmit: () => void;
};

/** 粘贴/上传 token 文本的快速导入弹窗。 */
export function QuickImportDialog({
  open,
  provider,
  tokens,
  pending,
  onOpenChange,
  onTokensChange,
  onFileSelected,
  onSubmit,
}: QuickImportDialogProps): ReactNode {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next && fileInputRef.current) fileInputRef.current.value = "";
      }}
    >
      <DialogContent>
        <QuickImportHeader provider={provider} />
        <QuickImportFields
          provider={provider}
          tokens={tokens}
          pending={pending}
          fileInputRef={fileInputRef}
          onTokensChange={onTokensChange}
          onFileSelected={onFileSelected}
        />
        <QuickImportFooter tokens={tokens} pending={pending} onCancel={() => onOpenChange(false)} onSubmit={onSubmit} />
      </DialogContent>
    </Dialog>
  );
}

function QuickImportHeader({ provider }: { provider: AccountProvider }): ReactNode {
  const { t } = useTranslation();
  const title =
    provider === "grok_build"
      ? "accounts.quickImportRTTitle"
      : provider === "grok_console"
        ? "console.quickImportTitle"
        : "accounts.quickImportTitle";
  const description =
    provider === "grok_build"
      ? "accounts.quickImportRTDescription"
      : provider === "grok_console"
        ? "console.quickImportDescription"
        : "accounts.quickImportDescription";
  return (
    <DialogHeader>
      <DialogTitle>{t(title)}</DialogTitle>
      <DialogDescription>{t(description)}</DialogDescription>
    </DialogHeader>
  );
}

type QuickImportFieldsProps = {
  provider: AccountProvider;
  tokens: string;
  pending: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onTokensChange: (value: string) => void;
  onFileSelected: (file: File | undefined) => void;
};

function QuickImportFields({
  provider,
  tokens,
  pending,
  fileInputRef,
  onTokensChange,
  onFileSelected,
}: QuickImportFieldsProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="quick-account-tokens">
          {t(provider === "grok_build" ? "accounts.refreshTokens" : "accounts.ssoTokens")}
        </Label>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => fileInputRef.current?.click()}
        >
          <FileUp />
          {t("accounts.uploadTXT")}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="text/plain,.txt"
          className="hidden"
          onChange={(event) => {
            onFileSelected(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      <Textarea
        id="quick-account-tokens"
        className="min-h-56 font-mono"
        autoComplete="off"
        spellCheck={false}
        value={tokens}
        onChange={(event) => onTokensChange(event.target.value)}
        placeholder={t(provider === "grok_build" ? "accounts.refreshTokenPlaceholder" : "accounts.ssoTokenPlaceholder")}
      />
    </div>
  );
}

function QuickImportFooter({
  tokens,
  pending,
  onCancel,
  onSubmit,
}: {
  tokens: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <DialogFooter>
      <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
        {t("common.cancel")}
      </Button>
      <Button type="button" size="sm" disabled={!tokens.trim() || pending} onClick={onSubmit}>
        {pending ? <Spinner /> : null}
        {t("accounts.importAction")}
      </Button>
    </DialogFooter>
  );
}
