import type { ReactElement } from "react";

import {
  EgressNodesBatchDeleteDialog,
  EgressNodesCleanupDialog,
} from "@/features/settings/egress-node-confirm-dialogs";
import { EgressImportDialog, EgressNodeDialog } from "@/features/settings/egress-node-dialogs";
import { EgressProxyProfiles } from "@/features/settings/egress-proxy-profiles";
import type { ClearanceMode } from "@/features/settings/settings-dto";
import type { EgressNodesPageModel } from "@/features/settings/use-egress-nodes-page-model";

/**
 * 出口节点分区的弹窗挂载层：每个弹窗一个挂载组件，只做页面模型到弹窗契约的接线，
 * 弹窗自身的字段、校验与文案留在各自模块。
 */

/** 批量删除确认：展示选中数量与受影响账号/订阅源数量。 */
export function EgressNodesBatchDeleteOverlay({ page }: { page: EgressNodesPageModel }): ReactElement {
  const { overlays, selection, mutations } = page;
  return (
    <EgressNodesBatchDeleteDialog
      open={overlays.batchDeleteOpen}
      selectedCount={selection.selected.size}
      assignedAccounts={selection.selectedAssignedAccounts}
      sourceNodes={selection.selectedSourceNodes}
      pending={mutations.removeMany.isPending}
      onOpenChange={overlays.setBatchDeleteOpen}
      onConfirm={() => mutations.removeMany.mutate()}
    />
  );
}

/** 清理不可用节点确认：清理进行中不允许关闭弹窗，关闭时清空预览结果。 */
export function EgressNodesCleanupOverlay({ page }: { page: EgressNodesPageModel }): ReactElement {
  const { overlays, mutations } = page;
  return (
    <EgressNodesCleanupDialog
      open={overlays.cleanupOpen}
      preview={mutations.preview}
      pending={mutations.cleanup.isPending}
      onOpenChange={(open) => {
        if (!open && mutations.cleanup.isPending) return;
        if (!open) mutations.resetCleanupPreview();
        overlays.setCleanupOpen(open);
      }}
      onConfirm={() => mutations.cleanup.mutate()}
    />
  );
}

/** 节点新增/编辑弹窗：草稿、揭示状态与作用域默认 UA 均来自页面模型。 */
export function EgressNodeEditorOverlay({
  clearanceMode,
  page,
}: {
  clearanceMode: ClearanceMode;
  page: EgressNodesPageModel;
}): ReactElement {
  const { form, list, overlays, mutations, scopeLabel } = page;
  return (
    <EgressNodeDialog
      open={form.editing !== undefined}
      editing={form.editing}
      form={form.form}
      clearanceMode={clearanceMode}
      proxyVisible={form.proxyVisible}
      revealPending={form.revealPending}
      savePending={mutations.save.isPending}
      scopeLabel={scopeLabel}
      onFormChange={form.updateForm}
      onScopeChange={(scope) => form.changeScope(scope, list.data?.defaultUserAgents)}
      onProfileChange={form.chooseProxyProfile}
      onOpenProfileLibrary={() => overlays.openProfileLibrary(true)}
      onToggleProxyVisible={form.toggleProxyVisible}
      onClose={form.closeDialog}
      onSubmit={() => mutations.save.mutate()}
    />
  );
}

/** 代理文本批量导入弹窗。 */
export function EgressImportOverlay({ page }: { page: EgressNodesPageModel }): ReactElement {
  const { importFlow, scopeLabel } = page;
  return (
    <EgressImportDialog
      open={importFlow.importOpen}
      form={importFlow.importForm}
      pending={importFlow.importPending}
      scopeLabel={scopeLabel}
      onFormChange={importFlow.updateImportForm}
      onClose={importFlow.closeImport}
      onSubmit={importFlow.submitImport}
    />
  );
}

/** 代理配置库弹窗：工具栏按管理模式打开，节点弹窗按创建模式打开并回填绑定。 */
export function EgressProxyLibraryOverlay({ page }: { page: EgressNodesPageModel }): ReactElement | null {
  const { form, overlays } = page;
  if (!overlays.profileLibraryOpen) return null;
  return (
    <EgressProxyProfiles
      key={overlays.profileLibraryCreate ? "create" : "manage"}
      open={overlays.profileLibraryOpen}
      startCreating={overlays.profileLibraryCreate}
      onOpenChange={(open) => {
        overlays.setProfileLibraryOpen(open);
        if (!open) overlays.setProfileLibraryCreate(false);
      }}
      onCreated={(profile) => {
        if (!overlays.profileLibraryCreate || form.editing === undefined) return;
        form.bindCreatedProfile(profile.id);
        overlays.setProfileLibraryOpen(false);
        overlays.setProfileLibraryCreate(false);
      }}
    />
  );
}
