import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import { Cake, Handshake, VenusAndMars, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import type { AccountTaskProgressDTO, WebAccountScriptActions } from "@/features/accounts/accounts-api";
import { cn } from "@/shared/lib/cn";

type Props = {
  targets: readonly string[] | "all";
  pending: boolean;
  progress: AccountTaskProgressDTO | null;
  onClose: () => void;
  onRun: (actions: WebAccountScriptActions) => void;
};

const defaultActions: WebAccountScriptActions = {
  acceptTerms: true,
  setBirthDate: true,
  enableNSFW: true,
};

export function WebAccountScriptsDialog({ targets, pending, progress, onClose, onRun }: Props) {
  const { t } = useTranslation();
  const [actions, setActions] = useState<WebAccountScriptActions>(defaultActions);
  const hasAction = actions.acceptTerms || actions.setBirthDate || actions.enableNSFW;

  function updateAction(action: keyof WebAccountScriptActions, checked: boolean): void {
    setActions((current) => nextScriptActions(current, action, checked));
  }

  const items = scriptActionItems(actions, t);

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <WebAccountScriptsHeader targets={targets} />
        <div className="space-y-2">
          <p className="text-xs font-medium">{t("webAccountScripts.operations")}</p>
          <div className="space-y-1 rounded-md bg-muted/40 p-1">
            {items.map((item) => (
              <WebAccountScriptActionRow
                key={item.action}
                item={item}
                checked={actions[item.action]}
                disabled={pending || item.locked}
                onCheckedChange={(checked) => updateAction(item.action, checked)}
              />
            ))}
          </div>
        </div>
        <WebAccountScriptsFooter
          pending={pending}
          progress={progress}
          hasAction={hasAction}
          onRun={() => onRun(actions)}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}

type ScriptActionItem = {
  action: keyof WebAccountScriptActions;
  icon: LucideIcon;
  label: string;
  description: string;
  locked?: boolean;
};

/** 勾选变更的业务规则：开启 NSFW 会自动带上生日动作，且开启期间不允许取消生日。 */
function nextScriptActions(
  current: WebAccountScriptActions,
  action: keyof WebAccountScriptActions,
  checked: boolean,
): WebAccountScriptActions {
  if (action === "enableNSFW") {
    return { ...current, enableNSFW: checked, setBirthDate: checked || current.setBirthDate };
  }
  if (action === "setBirthDate" && current.enableNSFW && !checked) return current;
  return { ...current, [action]: checked };
}

/** 三个可勾选动作的展示项：标签与说明来自 i18n，生日动作在 NSFW 开启时被锁定。 */
function scriptActionItems(actions: WebAccountScriptActions, t: TFunction): ScriptActionItem[] {
  return [
    {
      action: "acceptTerms",
      icon: Handshake,
      label: t("webAccountSettings.acceptTerms"),
      description: t("webAccountScripts.acceptTermsDescription"),
    },
    {
      action: "setBirthDate",
      icon: Cake,
      label: t("webAccountSettings.setBirthDate"),
      description: t("webAccountScripts.setBirthDateDescription"),
      locked: actions.enableNSFW,
    },
    {
      action: "enableNSFW",
      icon: VenusAndMars,
      label: t("webAccountSettings.enableNSFW"),
      description: t("webAccountScripts.enableNSFWDescription"),
    },
  ];
}

/** 弹窗标题与说明：全量目标与选中目标的文案分开，数量只在选中目标时有意义。 */
function WebAccountScriptsHeader({ targets }: { targets: readonly string[] | "all" }): ReactNode {
  const { t } = useTranslation();
  return (
    <AlertDialogHeader>
      <AlertDialogTitle>
        {t(targets === "all" ? "webAccountScripts.allTitle" : "webAccountScripts.selectedTitle", {
          count: targets === "all" ? 0 : targets.length,
        })}
      </AlertDialogTitle>
      <AlertDialogDescription>
        {t(targets === "all" ? "webAccountScripts.allDescription" : "webAccountScripts.selectedDescription")}
      </AlertDialogDescription>
    </AlertDialogHeader>
  );
}

function WebAccountScriptActionRow({
  item,
  checked,
  disabled,
  onCheckedChange,
}: {
  item: ScriptActionItem;
  checked: boolean;
  disabled: boolean | undefined;
  onCheckedChange: (checked: boolean) => void;
}): ReactNode {
  const { icon: Icon, label, description } = item;
  return (
    <label
      className={cn(
        "flex items-start gap-3 rounded-sm px-3 py-2.5 transition-colors",
        disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-background/70",
      )}
    >
      <Checkbox
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 space-y-0.5">
        <span className="block text-xs font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

function WebAccountScriptsFooter({
  pending,
  progress,
  hasAction,
  onRun,
}: {
  pending: boolean;
  progress: AccountTaskProgressDTO | null;
  hasAction: boolean;
  onRun: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <AlertDialogFooter>
      <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
      <AlertDialogAction
        disabled={pending || !hasAction}
        onClick={(event) => {
          event.preventDefault();
          onRun();
        }}
      >
        {pending ? <Spinner /> : null}
        {pending && progress ? (
          <span className="tabular-nums">
            {progress.completed} / {progress.total}
          </span>
        ) : (
          t("webAccountScripts.run")
        )}
      </AlertDialogAction>
    </AlertDialogFooter>
  );
}
