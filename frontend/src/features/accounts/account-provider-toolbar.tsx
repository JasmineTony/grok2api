import {
  ClipboardPaste,
  Compass,
  Download,
  ExternalLink,
  FileUp,
  Plus,
  SquareTerminal,
  Webhook,
} from "lucide-react";
import type { ChangeEvent, RefObject } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AccountProvider } from "@/features/accounts/accounts-api";

export function AccountProviderToolbar({
  provider,
  pending,
  hasAccounts,
  fileInputRef,
  onProviderChange,
  onDeviceLogin,
  onQuickImport,
  onImportFiles,
  onExport,
}: {
  provider: AccountProvider;
  pending: boolean;
  hasAccounts: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onProviderChange: (provider: AccountProvider) => void;
  onDeviceLogin: () => void;
  onQuickImport: () => void;
  onImportFiles: (files: File[]) => void;
  onExport: () => void;
}) {
  const { t } = useTranslation();
  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) onImportFiles(files);
    event.target.value = "";
  };
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          value={provider}
          onValueChange={(value) => onProviderChange(value as AccountProvider)}
        >
          <TabsList>
            <TabsTrigger value="grok_build" className="gap-1.5">
              <SquareTerminal className="size-3.5 text-quota-product-1" />
              <span>Grok Build</span>
            </TabsTrigger>
            <TabsTrigger value="grok_web" className="gap-1.5">
              <Compass className="size-3.5 text-quota-product-2" />
              <span>Grok Web</span>
            </TabsTrigger>
            <TabsTrigger value="grok_console" className="gap-1.5">
              <Webhook className="size-3.5 text-quota-product-4" />
              <span>Grok Console</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm">
              <Plus />
              {t("accounts.connectAccount")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {provider === "grok_build" ? (
              <DropdownMenuItem onClick={onDeviceLogin}>
                <ExternalLink />
                {t("accounts.deviceLogin")}
              </DropdownMenuItem>
            ) : null}
            {provider !== "grok_build" ? (
              <DropdownMenuItem disabled={pending} onClick={onQuickImport}>
                <ClipboardPaste />
                {t("accounts.quickImportSSO")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              disabled={pending}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp />
              {provider === "grok_build"
                ? t("accounts.importAuth")
                : provider === "grok_console"
                  ? t("console.importFile")
                  : t("accounts.importWebFile")}
            </DropdownMenuItem>
            {hasAccounts ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onExport}>
                  <Download />
                  {t("accounts.exportAuth")}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={
          provider === "grok_build"
            ? "application/json,.json"
            : "application/json,text/plain,.json,.txt"
        }
        className="hidden"
        onChange={handleFiles}
      />
    </>
  );
}
