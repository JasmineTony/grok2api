/**
 * zh-CN 文案 · 出口代理配置档案。
 * 命名空间：egressProxyProfiles。
 */
export default {
  egressProxyProfiles: {
    title: "代理地址库",
    libraryTitle: "代理地址库",
    libraryDescription: "统一维护可复用的代理地址，修改后会同步到使用它的节点。",
    description: "集中保存需要跨节点复用的代理地址。",
    add: "新增代理地址",
    addTitle: "新增代理地址",
    editTitle: "编辑代理地址",
    dialogDescription: "修改代理地址后，所有绑定节点将同步使用新地址，各节点的容量和运行状态仍独立。",
    name: "地址名称",
    endpoint: "代理地址",
    nodes: "使用节点",
    search: "搜索地址名称",
    empty: "暂无代理地址",
    emptyLibrary: "地址库为空，可新增一个地址供多个节点复用",
    noMatches: "没有匹配的代理地址",
    loadingSelection: "正在读取所选地址…",
    selectionUnavailable: "代理地址 #{{id}} 不可用",
    saved: "代理地址已保存",
    deleted: "代理地址已删除",
    deleteTitle: "删除代理地址？",
    deleteDescription: "将删除“{{name}}”。正在被节点使用的地址不能删除。",
    deleteBlocked: "已绑定 {{count}} 个节点",
    assignment: "代理地址来源",
    assignmentHelp:
      "可从地址库选择一个代理，跨 Provider 节点复用。健康、容量、User-Agent 与 Clearance 仍按节点独立管理。",
    independent: "单独配置当前节点",
    managedByProfile: "由代理地址库统一维护",
    nodeCount: "{{count}} 个节点",
    backToLibrary: "返回地址库",
    createFromPicker: "新增并使用代理地址",
    refreshNodes: "刷新代理节点",
    reveal: "显示完整代理地址",
    hide: "隐藏完整代理地址",
    revealUnavailable: "只能查看已保存共享代理配置的完整地址",
  },
} as const;
