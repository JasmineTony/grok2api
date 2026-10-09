import type { TFunction } from "i18next";
import { Pencil, Plus, Star, Trash2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ProbeProfileDialog } from "@/features/quality-guard/probe-profile-dialog";
import type { ProbeProfile } from "@/features/quality-guard/quality-guard-api";
import { useProbeProfiles, type ProbeProfilesController } from "@/features/quality-guard/use-probe-profiles";

// 探测配置面板：从 probe-profiles-panel.tsx 拆出。列表行、弹窗与写操作分别独立，
// 展示字段、按钮禁用条件与内置配置只读语义保持不变。

function matchLabel(mode: string, t: TFunction): string {
  if (mode === "last_line") return t("qualityGuard.profileMatchLastLine");
  if (mode === "regex") return t("qualityGuard.profileMatchRegex");
  return t("qualityGuard.profileMatchContains");
}

function profileMarker(profile: ProbeProfile, t: TFunction): string {
  if (!profile.expected_text) return t("qualityGuard.profileNoExpected");
  return `${t("qualityGuard.profileExpected")} ${profile.expected_text} · ${matchLabel(profile.match_mode, t)}`;
}

function ProbeProfileListItem({
  profile,
  active,
  controller,
}: {
  profile: ProbeProfile;
  active: boolean;
  controller: ProbeProfilesController;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
      data-testid={`probe-profile-row-${profile.id}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-sm">{profile.name}</strong>
          <Badge variant={profile.built_in ? "secondary" : "outline"}>
            {t(profile.built_in ? "qualityGuard.profileBuiltin" : "qualityGuard.profileCustom")}
          </Badge>
          {active ? <Badge>{t("qualityGuard.profileActive")}</Badge> : null}
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{profileMarker(profile, t)}</p>
      </div>
      <ProbeProfileRowActions profile={profile} active={active} controller={controller} />
    </div>
  );
}

function ProbeProfileDeleteButton({
  profile,
  controller,
}: {
  profile: ProbeProfile;
  controller: ProbeProfilesController;
}) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-destructive hover:text-destructive"
      onClick={() => controller.beginDelete(profile)}
      data-testid={`probe-profile-delete-${profile.id}`}
    >
      <Trash2 />
      {t("common.delete")}
    </Button>
  );
}

function ProbeProfileRowActions({
  profile,
  active,
  controller,
}: {
  profile: ProbeProfile;
  active: boolean;
  controller: ProbeProfilesController;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-1.5">
      {!active ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={controller.activating}
          onClick={() => controller.activate(profile)}
          data-testid={`probe-profile-activate-${profile.id}`}
        >
          <Star />
          {t("qualityGuard.profileActivate")}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => controller.beginEdit(profile)}
        data-testid={`probe-profile-edit-${profile.id}`}
      >
        <Pencil />
        {t(profile.built_in ? "qualityGuard.profileView" : "qualityGuard.profileEdit")}
      </Button>
      {!profile.built_in ? <ProbeProfileDeleteButton profile={profile} controller={controller} /> : null}
    </div>
  );
}

function ProbeProfileDeleteDialog({ controller }: { controller: ProbeProfilesController }) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      open={controller.deleting !== null}
      onOpenChange={(open) => {
        if (!open && !controller.deletingPending) controller.closeDelete();
      }}
    >
      <AlertDialogContent data-testid="probe-profile-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("common.delete")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("qualityGuard.profileDeleteConfirm", { name: controller.deleting?.name ?? "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={controller.deletingPending}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={controller.deletingPending || !controller.deleting}
            onClick={(event) => {
              event.preventDefault();
              if (controller.deleting) controller.remove(controller.deleting);
            }}
            data-testid="probe-profile-delete-confirm"
          >
            {controller.deletingPending ? <Spinner /> : null}
            {t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ProbeProfilesPanel() {
  const { t } = useTranslation();
  const controller = useProbeProfiles();
  return (
    <section className="overflow-hidden rounded-lg bg-card" data-testid="probe-profiles-panel">
      <div className="flex flex-col gap-2 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h2 className="text-sm font-medium">{t("qualityGuard.profilesTab")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("qualityGuard.profilesHelp")}</p>
        </div>
        <Button type="button" size="sm" onClick={controller.beginCreate} data-testid="probe-profile-create">
          <Plus />
          {t("qualityGuard.profileCreate")}
        </Button>
      </div>
      <div className="divide-y">
        {controller.items.map((profile) => (
          <ProbeProfileListItem
            key={profile.id}
            profile={profile}
            active={profile.id === controller.activeProfileId}
            controller={controller}
          />
        ))}
      </div>
      <ProbeProfileDialog controller={controller} />
      <ProbeProfileDeleteDialog controller={controller} />
    </section>
  );
}
