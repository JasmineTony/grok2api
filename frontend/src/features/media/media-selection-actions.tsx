import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

type MediaSelectionActionsProps = {
  selectedCount: number;
  onRequestDelete: () => void;
};

/** 批量操作区：显示选中数量并提供删除入口，图库与视频列表共用。 */
export function MediaSelectionActions({ selectedCount, onRequestDelete }: MediaSelectionActionsProps) {
  const { t } = useTranslation();
  return (
    <div className="flex h-8 items-center gap-2" data-testid="media-selection-actions">
      <span className="text-xs text-muted-foreground">{t("common.selectedCount", { count: selectedCount })}</span>
      <Button
        variant="secondary"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={onRequestDelete}
        data-testid="media-delete-request"
      >
        <Trash2 />
        {t("common.delete")}
      </Button>
    </div>
  );
}
