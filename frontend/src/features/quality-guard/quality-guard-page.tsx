import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DegradeAccountsPanel } from "@/features/quality-guard/degrade-accounts-panel";
import { UnavailableState } from "@/features/quality-guard/guard-metrics";
import { GuardNodesTab } from "@/features/quality-guard/guard-nodes-tab";
import { ProbeProfilesPanel } from "@/features/quality-guard/probe-profiles-panel";
import { useGuardNodes } from "@/features/quality-guard/use-guard-nodes";
import { ErrorState } from "@/shared/components/data-state";
import { PageHeader } from "@/shared/components/page-header";
import { cn } from "@/shared/lib/cn";

// 质量守护页只负责 tab 组装与错误态：节点 tab 的状态/查询/动作在 useGuardNodes 控制器里，
// 三个 tab 的查询 key、轮询间隔、失效语义与拆分前保持一致。

type QualityGuardTab = "nodes" | "profiles" | "accounts";

export function QualityGuardPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<QualityGuardTab>("nodes");
  const nodesTabActive = activeTab === "nodes";
  const controller = useGuardNodes(nodesTabActive);
  const { nodesQuery, statusQuery, view, refresh } = controller;
  const status = view.status;

  if (nodesTabActive && nodesQuery.isError && !nodesQuery.data)
    return <ErrorState message={nodesQuery.error.message} onRetry={refresh} />;
  if (statusQuery.isError && !statusQuery.data)
    return <ErrorState message={statusQuery.error.message} onRetry={refresh} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("qualityGuard.title")}
        description={t("qualityGuard.description")}
        actions={
          <Button variant="secondary" size="sm" onClick={refresh} disabled={view.refreshing}>
            <RefreshCw className={cn(view.refreshing && "animate-spin")} />
            {t("common.refresh")}
          </Button>
        }
      />

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as QualityGuardTab)}>
        <TabsList>
          <TabsTrigger value="nodes">{t("qualityGuard.nodesTab")}</TabsTrigger>
          <TabsTrigger value="profiles">{t("qualityGuard.profilesTab")}</TabsTrigger>
          <TabsTrigger value="accounts">{t("qualityGuard.degrade.tab")}</TabsTrigger>
        </TabsList>
        <TabsContent value="profiles" className="mt-6">
          <ProbeProfilesPanel />
        </TabsContent>
        <TabsContent value="accounts" className="mt-6">
          <DegradeAccountsPanel
            softTPS={status?.config?.soft_tps}
            hardTPS={status?.config?.hard_tps}
            failClosed={status?.config?.fail_closed}
            minGenMs={status?.config?.min_generation_ms}
          />
        </TabsContent>
        <TabsContent value="nodes" className="mt-6 space-y-6">
          {!status?.available ? <UnavailableState /> : <GuardNodesTab controller={controller} status={status} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
