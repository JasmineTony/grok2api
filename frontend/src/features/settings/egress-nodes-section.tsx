import type { ReactElement } from "react";

import { EgressNodesTable } from "@/features/settings/egress-nodes-table";
import { EgressNodesToolbar } from "@/features/settings/egress-nodes-toolbar";
import type { EgressNodeListDTO } from "@/entities/egress/egress-dto";
import type { ClearanceMode } from "@/features/settings/settings-dto";
import type { EgressNodesPageModel } from "@/features/settings/use-egress-nodes-page-model";
import { DataTableShell } from "@/shared/components/data-table-shell";
import { Pagination } from "@/shared/components/pagination";

/** 工具栏接线：把页面模型的状态与动作映射到工具栏的展示契约。 */
function EgressNodesToolbarHost({ page }: { page: EgressNodesPageModel }) {
  const { list, selection, form, importFlow, mutations, overlays, scopeLabel } = page;
  return (
    <EgressNodesToolbar
      search={list.search}
      onSearchChange={(value) => list.changeFilter(value, list.setSearch)}
      scopeFilter={list.scopeFilter}
      onScopeFilterChange={(value) => list.changeFilter(value, list.setScopeFilter)}
      enabledFilter={list.enabledFilter}
      onEnabledFilterChange={(value) => list.changeFilter(value, list.setEnabledFilter)}
      probeFilter={list.probeFilter}
      onProbeFilterChange={(value) => list.changeFilter(value, list.setProbeFilter)}
      assignmentFilter={list.assignmentFilter}
      onAssignmentFilterChange={(value) => list.changeFilter(value, list.setAssignmentFilter)}
      scopeLabel={scopeLabel}
      selectedCount={selection.selected.size}
      selectedNodes={selection.selectedNodes}
      batchPending={mutations.removeMany.isPending || mutations.updateEnabled.isPending}
      refreshing={list.query.isFetching}
      cleanupPending={mutations.cleanup.isPending}
      onBatchEnable={() => mutations.updateEnabled.mutate(true)}
      onBatchDisable={() => mutations.updateEnabled.mutate(false)}
      onBatchDelete={() => overlays.setBatchDeleteOpen(true)}
      onOpenProfileLibrary={() => overlays.openProfileLibrary(false)}
      onRefresh={list.refresh}
      onCleanup={mutations.openCleanup}
      onCreate={() => form.openDialog(null)}
      onImport={importFlow.openImport}
    />
  );
}

/** 分页脚：页码、每页条数与总数来自列表查询结果。 */
function EgressNodesPagination({
  data,
  onPageChange,
  onPageSizeChange,
}: {
  data: EgressNodeListDTO;
  onPageChange: (page: number) => void;
  onPageSizeChange: (value: number) => void;
}) {
  return (
    <Pagination
      page={data.page}
      pageSize={data.pageSize}
      total={data.total}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
    />
  );
}

/** 出口节点列表分区：标题 + 工具栏 + 虚拟表格 + 分页。 */
export function EgressNodesSection({
  title,
  clearanceMode,
  page,
}: {
  title: string;
  clearanceMode: ClearanceMode;
  page: EgressNodesPageModel;
}): ReactElement {
  const { list, selection, scopeLabel, rowActions } = page;
  const selectedOnPage = list.nodes.filter((node) => selection.selected.has(node.id));
  const allPageSelected = list.nodes.length > 0 && selectedOnPage.length === list.nodes.length;

  return (
    <section className="space-y-3">
      <div className="flex min-h-8 items-center px-1">
        <h2 className="text-sm font-medium tracking-tight">{title}</h2>
      </div>
      <DataTableShell
        toolbar={<EgressNodesToolbarHost page={page} />}
        footer={
          list.data && list.data.total > 0 ? (
            <EgressNodesPagination
              data={list.data}
              onPageChange={list.setPage}
              onPageSizeChange={list.changePageSize}
            />
          ) : undefined
        }
      >
        <EgressNodesTable
          query={list.query}
          nodes={list.nodes}
          selected={selection.selected}
          allPageSelected={allPageSelected}
          selectedOnPage={selectedOnPage}
          hasActiveFilters={list.hasActiveFilters}
          sort={list.sort}
          clearanceMode={clearanceMode}
          scopeLabel={scopeLabel}
          actions={rowActions}
          onSort={list.changeSort}
          onTogglePage={(checked) => selection.togglePage(list.nodes, checked)}
          onToggleNode={selection.toggleNode}
        />
      </DataTableShell>
    </section>
  );
}
