import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { EgressImportForm } from "@/features/settings/egress-import-form";
import { EgressImportDialog, EgressNodeDialog } from "@/features/settings/egress-node-dialogs";
import { ResizeObserverStub } from "@/features/settings/egress-test-support";
import { EgressSourceDialog } from "@/features/settings/egress-source-dialog";
import { emptyEgressSource, type EgressSourceForm } from "@/features/settings/egress-source-form";
import type {
  ClearanceMode,
  EgressNodeDTO,
  EgressNodeInput,
  EgressScope,
  EgressSourceDTO,
} from "@/features/settings/settings-api";
import { i18n } from "@/shared/i18n";

// 出口节点/订阅源/文本导入弹窗的字段级组件测试：直接驱动导出的弹窗组件，用受控 props
// 覆盖集成测试难以稳定进入的分支（保存/揭示进行中、订阅源托管节点、on_demand 清关、
// Escape 关闭、代理池开关联动等）。断言全部针对用户可见结果与真实状态变化。

function scopeLabel(scope: EgressScope): string {
  return `作用域:${scope}`;
}

function renderDialog(node: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <I18nextProvider i18n={i18n}>
        <TooltipProvider delayDuration={0}>{node}</TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

/** Radix Select 触发器在 jsdom 下用键盘打开弹层，再用 click 命中选项。 */
async function chooseRadixOption(trigger: HTMLElement, optionLabel: string): Promise<void> {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: optionLabel }));
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`缺少元素：${id}`);
  return element;
}

function sourceEditing(overrides: Partial<EgressSourceDTO> = {}): EgressSourceDTO {
  return {
    id: "src-1",
    name: "订阅源一",
    scope: "grok_build",
    enabled: true,
    urlConfigured: true,
    proxyConfigured: false,
    refreshIntervalSeconds: 900,
    defaultAccountCapacity: 0,
    lastSyncImported: 0,
    ...overrides,
  };
}

function nodeEditing(overrides: Partial<EgressNodeDTO> = {}): EgressNodeDTO {
  return {
    id: "node-1",
    name: "节点一",
    scope: "grok_web",
    enabled: true,
    proxyConfigured: true,
    userAgent: "",
    cookieConfigured: false,
    accountBoundProxy: false,
    proxyPool: false,
    accountCapacity: 0,
    assignedAccountCount: 0,
    health: 1,
    failureCount: 0,
    probeStatus: "unknown",
    probeLatencyMs: 0,
    ipv4Probe: { status: "unknown", latencyMs: 0 },
    ipv6Probe: { status: "unknown", latencyMs: 0 },
    ...overrides,
  };
}

const emptyNodeForm: EgressNodeInput = {
  name: "节点一",
  scope: "grok_web",
  enabled: true,
  proxyPool: false,
  proxyURL: "",
  userAgent: "",
  cloudflareCookies: "",
  accountCapacity: 0,
};

type SourceHarnessProps = {
  editing: EgressSourceDTO | null;
  pending?: boolean;
  onFormChange?: (changes: Partial<EgressSourceForm>) => void;
  onClose?: () => void;
};

function SourceDialogHarness({ editing, pending = false, onFormChange, onClose }: SourceHarnessProps) {
  const [form, setForm] = useState<EgressSourceForm>({
    ...emptyEgressSource,
    name: "订阅源一",
    url: "https://source.example.com/sub",
  });
  return (
    <EgressSourceDialog
      editing={editing}
      form={form}
      invalidProxy={false}
      pending={pending}
      scopeLabel={scopeLabel}
      onFormChange={(changes) => {
        onFormChange?.(changes);
        setForm((previous) => ({ ...previous, ...changes }));
      }}
      onClose={onClose ?? (() => undefined)}
      onSubmit={() => undefined}
    />
  );
}

type NodeHarnessProps = {
  editing?: EgressNodeDTO | null;
  clearanceMode?: ClearanceMode;
  proxyVisible?: boolean;
  revealPending?: boolean;
  savePending?: boolean;
  initialForm?: EgressNodeInput;
  onFormChange?: (changes: Partial<EgressNodeInput>) => void;
  onClose?: () => void;
};

function NodeDialogHarness({
  editing = null,
  clearanceMode = "manual",
  proxyVisible = false,
  revealPending = false,
  savePending = false,
  initialForm = emptyNodeForm,
  onFormChange,
  onClose,
}: NodeHarnessProps) {
  const [form, setForm] = useState<EgressNodeInput>(initialForm);
  return (
    <EgressNodeDialog
      open
      editing={editing}
      form={form}
      clearanceMode={clearanceMode}
      proxyVisible={proxyVisible}
      revealPending={revealPending}
      savePending={savePending}
      scopeLabel={scopeLabel}
      onFormChange={(changes) => {
        onFormChange?.(changes);
        setForm((previous) => ({ ...previous, ...changes }));
      }}
      onScopeChange={() => undefined}
      onProfileChange={() => undefined}
      onOpenProfileLibrary={() => undefined}
      onToggleProxyVisible={() => undefined}
      onClose={onClose ?? (() => undefined)}
      onSubmit={() => undefined}
    />
  );
}

function ImportDialogHarness({
  pending = false,
  onFormChange,
  onClose,
}: {
  pending?: boolean;
  onFormChange?: (changes: Partial<EgressImportForm>) => void;
  onClose?: () => void;
}) {
  const [form, setForm] = useState<EgressImportForm>({
    name: "批量导入",
    scope: "grok_build",
    accountCapacity: 0,
    content: "socks5h://host:1080",
  });
  return (
    <EgressImportDialog
      open
      form={form}
      pending={pending}
      scopeLabel={scopeLabel}
      onFormChange={(changes) => {
        onFormChange?.(changes);
        setForm((previous) => ({ ...previous, ...changes }));
      }}
      onClose={onClose ?? (() => undefined)}
      onSubmit={() => undefined}
    />
  );
}

beforeEach(async () => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("订阅源弹窗字段", () => {
  it("切换启用开关、作用域与刷新参数会写回草稿并更新界面", async () => {
    const changes: Partial<EgressSourceForm>[] = [];
    const user = userEvent.setup();
    renderDialog(<SourceDialogHarness editing={sourceEditing()} onFormChange={(next) => changes.push(next)} />);
    const dialog = screen.getByTestId("egress-source-dialog");

    const enabledSwitch = within(dialog).getAllByRole("switch")[0];
    await user.click(enabledSwitch);
    expect(enabledSwitch).toHaveAttribute("aria-checked", "false");
    expect(changes).toContainEqual({ enabled: false });

    await chooseRadixOption(within(dialog).getByRole("combobox"), "作用域:grok_web");
    expect(changes).toContainEqual({ scope: "grok_web" });
    expect(within(dialog).getByRole("combobox")).toHaveTextContent("作用域:grok_web");

    fireEvent.change(within(dialog).getByTestId("egress-source-refresh-interval"), { target: { value: "1200" } });
    expect(changes).toContainEqual({ refreshIntervalSeconds: 1200 });
    expect(within(dialog).getByTestId("egress-source-refresh-interval")).toHaveValue(1200);

    fireEvent.change(within(dialog).getByTestId("egress-source-capacity"), { target: { value: "50" } });
    expect(changes).toContainEqual({ defaultAccountCapacity: 50 });
    expect(within(dialog).getByTestId("egress-source-capacity")).toHaveValue(50);
  });

  it("保存进行中时保存按钮展示加载状态且不可提交", async () => {
    renderDialog(<SourceDialogHarness editing={sourceEditing()} pending />);
    const save = screen.getByTestId("egress-source-dialog-save");

    expect(within(save).getByRole("status")).toBeInTheDocument();
    expect(save).toBeDisabled();
  });

  it("按 Escape 关闭订阅源弹窗时通知父级关闭", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderDialog(<SourceDialogHarness editing={sourceEditing()} onClose={onClose} />);

    expect(screen.getByTestId("egress-source-dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("出口节点弹窗字段", () => {
  it("编辑态下切换启用开关、容量与代理地址会写回草稿", async () => {
    const changes: Partial<EgressNodeInput>[] = [];
    const user = userEvent.setup();
    renderDialog(
      <NodeDialogHarness
        editing={nodeEditing({ proxyProfileId: "prof-1" })}
        onFormChange={(next) => changes.push(next)}
      />,
    );
    const dialog = screen.getByTestId("egress-node-dialog");

    await user.click(within(dialog).getByTestId("egress-node-enabled"));
    expect(within(dialog).getByTestId("egress-node-enabled")).toHaveAttribute("aria-checked", "false");
    expect(changes).toContainEqual({ enabled: false });

    fireEvent.change(within(dialog).getByTestId("egress-node-capacity"), { target: { value: "80" } });
    expect(within(dialog).getByTestId("egress-node-capacity")).toHaveValue(80);
    expect(changes).toContainEqual({ accountCapacity: 80 });

    // 已绑定代理配置的节点改写代理地址：草稿回到独立代理（proxyProfileId="0"），代理池保持关闭
    fireEvent.change(within(dialog).getByTestId("egress-node-proxy-url"), {
      target: { value: "socks5h://user:pass@host:1080" },
    });
    expect(changes).toContainEqual({
      proxyURL: "socks5h://user:pass@host:1080",
      proxyProfileId: "0",
      proxyPool: false,
    });
    expect(within(dialog).getByTestId("egress-node-proxy-url")).toHaveValue("socks5h://user:pass@host:1080");
  });

  it("新增节点时清空代理地址会关闭代理池开关", async () => {
    const changes: Partial<EgressNodeInput>[] = [];
    renderDialog(
      <NodeDialogHarness
        editing={null}
        initialForm={{ ...emptyNodeForm, proxyPool: true }}
        onFormChange={(next) => changes.push(next)}
      />,
    );
    const dialog = screen.getByTestId("egress-node-dialog");
    const proxyURL = within(dialog).getByTestId("egress-node-proxy-url");

    fireEvent.change(proxyURL, { target: { value: "socks5h://host:1080" } });
    expect(changes).toContainEqual({ proxyURL: "socks5h://host:1080", proxyProfileId: undefined, proxyPool: true });

    fireEvent.change(proxyURL, { target: { value: "" } });
    expect(changes).toContainEqual({ proxyURL: "", proxyProfileId: undefined, proxyPool: false });
    expect(proxyURL).toHaveValue("");
  });

  it("订阅源托管的节点不展示代理配置选择器", () => {
    renderDialog(<NodeDialogHarness editing={nodeEditing({ sourceId: "src-1" })} />);

    expect(screen.queryByTestId("egress-proxy-profile-picker")).not.toBeInTheDocument();
    expect(screen.getByTestId("egress-node-proxy-url")).toBeEnabled();
  });

  it("按需清关模式下展示对应的清关方式", () => {
    renderDialog(<NodeDialogHarness editing={nodeEditing()} clearanceMode="on_demand" />);

    expect(screen.getByTestId("egress-node-clearance-mode")).toHaveTextContent(
      i18n.t("settings.web.clearanceOnDemand"),
    );
  });

  it("编辑已保存 Cookie 的节点时占位提示保留既有凭据", () => {
    renderDialog(<NodeDialogHarness editing={nodeEditing({ cookieConfigured: true })} />);

    expect(screen.getByTestId("egress-node-cookie")).toHaveAttribute(
      "placeholder",
      i18n.t("settings.egress.keepConfigured"),
    );
  });

  it("保存进行中时节点保存按钮展示加载状态且不可提交", () => {
    renderDialog(<NodeDialogHarness editing={nodeEditing()} savePending />);
    const save = screen.getByTestId("egress-node-dialog-save");

    expect(within(save).getByRole("status")).toBeInTheDocument();
    expect(save).toBeDisabled();
  });

  it("揭示代理地址进行中时按钮展示加载状态", () => {
    renderDialog(<NodeDialogHarness editing={nodeEditing()} revealPending />);
    const reveal = screen.getByTestId("egress-node-reveal-proxy");

    expect(within(reveal).getByRole("status")).toBeInTheDocument();
    expect(reveal).toBeDisabled();
  });

  it("切换代理池开关写回草稿", async () => {
    const changes: Partial<EgressNodeInput>[] = [];
    const user = userEvent.setup();
    renderDialog(
      <NodeDialogHarness
        editing={nodeEditing({ proxyConfigured: true })}
        onFormChange={(next) => changes.push(next)}
      />,
    );
    const proxyPool = screen.getByTestId("egress-node-proxy-pool");

    await user.click(proxyPool);

    expect(proxyPool).toHaveAttribute("aria-checked", "true");
    expect(changes).toContainEqual({ proxyPool: true });
  });

  it("按 Escape 关闭节点弹窗时通知父级关闭", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderDialog(<NodeDialogHarness editing={nodeEditing()} onClose={onClose} />);

    expect(screen.getByTestId("egress-node-dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("文本导入弹窗字段", () => {
  it("切换作用域与容量会写回草稿并更新界面", async () => {
    const changes: Partial<EgressImportForm>[] = [];
    renderDialog(<ImportDialogHarness onFormChange={(next) => changes.push(next)} />);
    const dialog = screen.getByTestId("egress-import-dialog");

    await chooseRadixOption(byId("egress-import-scope"), "作用域:grok_web");
    expect(changes).toContainEqual({ scope: "grok_web" });
    expect(byId("egress-import-scope")).toHaveTextContent("作用域:grok_web");

    fireEvent.change(within(dialog).getByTestId("egress-import-capacity"), { target: { value: "20" } });
    expect(changes).toContainEqual({ accountCapacity: 20 });
    expect(within(dialog).getByTestId("egress-import-capacity")).toHaveValue(20);
  });

  it("提交进行中时提交按钮展示加载状态且不可提交", () => {
    renderDialog(<ImportDialogHarness pending />);
    const submit = screen.getByTestId("egress-import-dialog-submit");

    expect(within(submit).getByRole("status")).toBeInTheDocument();
    expect(submit).toBeDisabled();
  });

  it("按 Escape 关闭导入弹窗时通知父级关闭", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderDialog(<ImportDialogHarness onClose={onClose} />);

    expect(screen.getByTestId("egress-import-dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
