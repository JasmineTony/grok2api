/**
 * en 文案 · 出口代理配置档案。
 * 命名空间：egressProxyProfiles。
 */
export default {
  egressProxyProfiles: {
    title: "Proxy address library",
    libraryTitle: "Proxy address library",
    libraryDescription: "Manage reusable proxy addresses in one place. Changes sync to every node using the address.",
    description: "Save proxy addresses that need to be reused across nodes.",
    add: "Add proxy address",
    addTitle: "Add proxy address",
    editTitle: "Edit proxy address",
    dialogDescription:
      "Changing the proxy address updates every bound node. Capacity and operational state remain isolated per node.",
    name: "Address name",
    endpoint: "Proxy address",
    nodes: "Used by",
    search: "Search address names",
    empty: "No proxy addresses",
    emptyLibrary: "The library is empty. Add an address to reuse it across nodes.",
    noMatches: "No matching proxy addresses",
    loadingSelection: "Loading selected address…",
    selectionUnavailable: "Proxy address #{{id}} is unavailable",
    saved: "Proxy address saved",
    deleted: "Proxy address deleted",
    deleteTitle: "Delete proxy address?",
    deleteDescription: "This deletes {{name}}. Addresses currently used by nodes cannot be deleted.",
    deleteBlocked: "Used by {{count}} nodes",
    assignment: "Proxy address source",
    assignmentHelp:
      "Select an address from the library to reuse it across Provider nodes. Health, capacity, User-Agent, and Clearance remain isolated per node.",
    independent: "Configure this node separately",
    managedByProfile: "Managed by the proxy address library",
    nodeCount: "{{count}} nodes",
    backToLibrary: "Back to address library",
    createFromPicker: "Add and use a proxy address",
    refreshNodes: "Refresh proxy nodes",
    reveal: "Reveal full proxy URL",
    hide: "Hide full proxy URL",
    revealUnavailable: "Only a saved proxy address can reveal its URL",
  },
} as const;
