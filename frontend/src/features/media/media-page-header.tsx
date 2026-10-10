import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/shared/components/page-header";

type MediaPageHeaderProps = {
  title: string;
  description: string;
  refreshing: boolean;
  onRefresh: () => void;
};

/** 媒体页头部：标题、描述与刷新按钮（刷新中含旋转图标与禁用态）。 */
export function MediaPageHeader({ title, description, refreshing, onRefresh }: MediaPageHeaderProps) {
  const { t } = useTranslation();
  return (
    <PageHeader
      title={title}
      description={description}
      actions={
        <Button variant="secondary" size="sm" onClick={onRefresh} disabled={refreshing} data-testid="media-refresh">
          <RefreshCw className={refreshing ? "animate-spin" : undefined} />
          {t("common.refresh")}
        </Button>
      }
    />
  );
}
