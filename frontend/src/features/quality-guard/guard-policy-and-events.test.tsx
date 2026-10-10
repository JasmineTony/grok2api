import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventList } from "@/features/quality-guard/guard-events-panel";
import { formatCount, formatDuration, formatTime, formatTPS, isFresh } from "@/features/quality-guard/guard-format";
import { emptyNodeInput, nodeInputFromForm } from "@/features/quality-guard/guard-node-form";
import { Policy } from "@/features/quality-guard/guard-policy-panel";
import type { QualityGuardEvent, QualityGuardStatus } from "@/features/quality-guard/quality-guard-api";
import {
  guardStatus,
  installQualityGuardApi,
  renderQualityGuardPage,
  setupUser,
  type RecordedRequest,
} from "@/features/quality-guard/quality-guard-test-support";
import { i18n } from "@/shared/i18n";

// 策略编辑、最近事件与守护格式化：覆盖用户可见文案、校验错误与失败路径。

const POLICY_PATH = "/api/admin/v1/egress-quality-guard/config";

function requestsTo(requests: RecordedRequest[], path: string, method: string): RecordedRequest[] {
  return requests.filter((request) => request.url === path && (request.method ?? "GET") === method);
}

/** 测试支撑的 wire 构造器返回通用字典，按组件契约收窄类型。 */
function asStatus(value: Record<string, unknown>): QualityGuardStatus {
  return value as unknown as QualityGuardStatus;
}

/**
 * guardStatus() 的 config 字段在通用字典里是 unknown；
 * 这里先按真实 wire 契约收窄成字典，再叠加用例需要的字段覆盖。
 */
function configWith(overrides: Record<string, unknown>): Record<string, unknown> {
  const config = guardStatus().config;
  if (typeof config !== "object" || config === null) throw new Error("guardStatus() 必须提供 config 对象");
  return { ...config, ...overrides };
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => {
  vi.unstubAllGlobals();
});
// jsdom 下整页渲染 + Radix 弹层比默认 5s 慢，统一放宽单测超时（不掩盖断言失败）。
vi.setConfig({ testTimeout: 15_000 });

describe("守护策略面板", () => {
  it("展示当前阈值、间隔与最小节点数，可编辑时提供编辑入口", () => {
    const onEdit = vi.fn();
    render(
      <Policy
        status={asStatus({
          available: true,
          editable: true,
          config: configWith({
            active_interval_seconds: 3_600,
            passive_poll_seconds: 90,
            soft_tps: 500,
            hard_tps: 1_000,
            consecutive_soft: 3,
            quarantine_seconds: 3_600,
            min_healthy_nodes: 2,
          }),
        })}
        onEdit={onEdit}
      />,
    );

    const panel = screen.getByTestId("guard-policy");
    expect(panel).toHaveTextContent("500 Token/s × 3");
    expect(panel).toHaveTextContent("1h");
    expect(panel).toHaveTextContent("1.5m");

    const edit = within(panel).getByTestId("guard-policy-edit");
    expect(edit).toBeEnabled();
    fireEvent.click(edit);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("不可编辑时编辑按钮禁用", () => {
    render(<Policy status={asStatus(guardStatus({ editable: false }))} onEdit={() => undefined} />);

    expect(screen.getByTestId("guard-policy-edit")).toBeDisabled();
  });
});

describe("守护策略编辑弹窗", () => {
  async function openPolicyEditor(user: ReturnType<typeof setupUser>) {
    const { requests } = installQualityGuardApi();
    renderQualityGuardPage();
    await screen.findByTestId("guard-policy");
    await user.click(screen.getByTestId("guard-policy-edit"));
    const dialog = await screen.findByTestId("guard-policy-editor");
    return { requests, dialog };
  }

  it("预填当前策略，切换模式与恢复默认值", async () => {
    const user = setupUser();
    const { dialog } = await openPolicyEditor(user);

    expect(within(dialog).getByTestId("guard-soft-tps")).toHaveValue(500);
    expect(within(dialog).getByTestId("guard-minimum-nodes")).toHaveValue(1);
    expect(within(dialog).getByTestId("guard-policy-mode-hybrid")).toHaveAttribute("aria-checked", "true");

    await user.click(within(dialog).getByTestId("guard-policy-mode-active"));
    expect(within(dialog).getByTestId("guard-policy-mode-active")).toHaveAttribute("aria-checked", "true");

    // 恢复默认值时最小节点数取 min(DEFAULT_POLICY.minHealthyNodes=3, node_ids.length=2) = 2
    await user.click(within(dialog).getByTestId("guard-policy-reset"));
    expect(within(dialog).getByTestId("guard-soft-tps")).toHaveValue(500);
    expect(within(dialog).getByTestId("guard-minimum-nodes")).toHaveValue(2);
  });

  it("软阈值不低于硬阈值时提示，超出范围的字段展示通用错误", async () => {
    const user = setupUser();
    const { requests, dialog } = await openPolicyEditor(user);

    // 软/硬阈值关系由组件实时 watch 计算，改软阈值即渲染提示
    fireEvent.change(within(dialog).getByTestId("guard-soft-tps"), { target: { value: "2000" } });
    expect(await within(dialog).findByText(i18n.t("qualityGuard.softThresholdMustBeLower"))).toBeInTheDocument();

    // 逐字段范围校验来自 zod resolver，react-hook-form 默认在提交时才写 formState.errors
    fireEvent.change(within(dialog).getByTestId("guard-active-interval"), { target: { value: "1" } });
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);
    expect((await within(dialog).findAllByText(i18n.t("qualityGuard.invalidPolicyValue"))).length).toBeGreaterThan(0);
    // 校验失败不发送保存请求
    expect(requestsTo(requests, POLICY_PATH, "PUT")).toHaveLength(0);
  });

  it("保存成功后提交表单、关闭弹窗并提示", async () => {
    const user = setupUser();
    const { requests } = installQualityGuardApi({
      status: guardStatus({ config: configWith({ mode: "active", active_interval_seconds: 600 }) }),
    });
    renderQualityGuardPage();
    await screen.findByTestId("guard-policy");
    await user.click(screen.getByTestId("guard-policy-edit"));
    const dialog = await screen.findByTestId("guard-policy-editor");

    fireEvent.change(within(dialog).getByTestId("guard-soft-tps"), { target: { value: "800" } });
    await user.click(within(dialog).getByTestId("guard-policy-save"));

    await waitFor(() => {
      const puts = requestsTo(requests, POLICY_PATH, "PUT");
      expect(puts).toHaveLength(1);
      expect(puts[0].body).toMatchObject({ mode: "active", softTPS: 800, activeIntervalSeconds: 600 });
    });
    await waitFor(() => expect(screen.queryByTestId("guard-policy-editor")).not.toBeInTheDocument());
    expect(await screen.findByText(i18n.t("qualityGuard.policySaved"))).toBeInTheDocument();
  });

  it("保存失败时展示错误提示并保留弹窗", async () => {
    const user = setupUser();
    installQualityGuardApi({ failure: "policySave" });
    renderQualityGuardPage();
    await screen.findByTestId("guard-policy");
    await user.click(screen.getByTestId("guard-policy-edit"));
    const dialog = await screen.findByTestId("guard-policy-editor");

    await user.click(within(dialog).getByTestId("guard-policy-save"));

    expect(await screen.findByText("守护策略保存失败")).toBeInTheDocument();
    expect(screen.getByTestId("guard-policy-editor")).toBeInTheDocument();
  });
});

describe("最近事件列表", () => {
  it("租约类事件、原因与附加字段映射为可读文案", () => {
    const events: QualityGuardEvent[] = [
      {
        ts: 1_700_000_000,
        event: "lease_scoped_quarantine_suppressed",
        node_id: "node-1",
        node_name: "",
        reason: "lease_scoped_node",
        classification: "hard",
        output_tps: 0,
      },
      {
        ts: 1_700_000_001,
        event: "lease_scoped_guard_released",
        node_id: "node-2",
        node_name: "东京出口",
        reason: "fixed_fallback_node",
        classification: "soft",
        output_tps: 0,
      },
      {
        ts: 1_700_000_002,
        event: "lease_quarantined",
        node_id: "node-3",
        node_name: "新加坡出口",
        reason: "",
        classification: "hard",
        output_tps: 0,
      },
      {
        ts: 1_700_000_003,
        event: "lease_restored",
        node_id: "node-4",
        node_name: "香港出口",
        reason: "hard_tps",
        classification: "hard",
        output_tps: 1_200,
        account_id: "acc-1",
        request_id: "req-1",
        cooldown_until: 1_700_000_500,
      },
      {
        ts: 1_700_000_004,
        event: "lease_quarantine_extended",
        node_id: "node-5",
        node_name: "法兰克福出口",
        reason: "hard_tps",
        classification: "hard",
        output_tps: 0,
      },
      {
        ts: 1_700_000_005,
        event: "lease_quarantine_failed",
        node_id: "node-6",
        node_name: "悉尼出口",
        reason: "hard_tps",
        classification: "hard",
        output_tps: 0,
      },
      {
        ts: 1_700_000_006,
        event: "lease_quarantine_suppressed",
        node_id: "node-7",
        node_name: "圣保罗出口",
        reason: "hard_tps",
        classification: "hard",
        output_tps: 0,
      },
      {
        ts: 1_700_000_007,
        event: "node_quarantined",
        node_id: "node-8",
        node_name: "孟买出口",
        reason: "soft_tps",
        classification: "soft",
        output_tps: 0,
      },
    ];
    render(<EventList locale="zh-CN" events={events} />);

    const panel = screen.getByTestId("guard-events");
    expect(panel).toHaveTextContent(i18n.t("qualityGuard.leaseScopedQuarantineSuppressedEvent"));
    expect(panel).toHaveTextContent(i18n.t("qualityGuard.leaseScopedGuardReleasedEvent"));
    expect(panel).toHaveTextContent(i18n.t("qualityGuard.leaseQuarantinedEvent"));
    expect(panel).toHaveTextContent(i18n.t("qualityGuard.leaseRestoredEvent"));
    expect(panel).toHaveTextContent(i18n.t("qualityGuard.leaseQuarantineExtendedEvent"));
    expect(panel).toHaveTextContent(i18n.t("qualityGuard.leaseQuarantineFailedEvent"));
    expect(panel).toHaveTextContent(i18n.t("qualityGuard.eventTypes.node_quarantined"));
    // 缺少节点名时回退为 ID
    expect(panel).toHaveTextContent("ID node-1");
    expect(panel).toHaveTextContent(i18n.t("qualityGuard.leaseScopedNodeReason"));
    expect(panel).toHaveTextContent(i18n.t("qualityGuard.fixedFallback"));
    expect(panel).toHaveTextContent(i18n.t("qualityGuard.reasons.unknown"));
    expect(panel).toHaveTextContent(i18n.t("qualityGuard.accountLease", { id: "acc-1" }));
    expect(panel).toHaveTextContent("req-1");
    expect(panel).toHaveTextContent("1,200 Token/s");
    expect(panel).toHaveTextContent(i18n.t("qualityGuard.leaseUntil", { time: formatTime(1_700_000_500, "zh-CN") }));
  });

  it("没有事件时展示空态", () => {
    render(<EventList locale="zh-CN" events={[]} />);

    expect(screen.getByTestId("guard-events")).toHaveTextContent(i18n.t("qualityGuard.noEvents"));
  });
});

describe("守护格式化与节点表单映射", () => {
  it("格式化 TPS / 计数 / 时长 / 时间与新鲜度判定", () => {
    expect(formatTPS(1200)).toBe("1,200 Token/s");
    expect(formatTPS(320.55)).toBe("320.6 Token/s");
    expect(formatCount(12345, "zh-CN")).toBe("12,345");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(90)).toBe("1.5m");
    expect(formatTime(undefined, "zh-CN")).toBe("-");

    const base = guardStatus();
    expect(isFresh(undefined)).toBe(false);
    expect(isFresh(asStatus({ available: false }))).toBe(false);
    expect(isFresh(asStatus(base))).toBe(true);
    // 主动模式按 active_interval_seconds 的三倍判定新鲜度
    expect(
      isFresh(
        asStatus(
          guardStatus({
            updatedAt: Math.floor(Date.now() / 1000) - 5_000,
            config: configWith({ mode: "active", active_interval_seconds: 1_800 }),
          }),
        ),
      ),
    ).toBe(true);
  });

  it("节点表单映射清空 UA/Cookie 并规整代理地址", () => {
    expect(emptyNodeInput()).toMatchObject({ name: "", scope: "grok_build", enabled: true, proxyPool: false });

    const filled = nodeInputFromForm({
      name: "  东京出口  ",
      scope: "grok_web",
      enabled: true,
      proxyPool: true,
      accountCapacity: 3,
      proxyURL: "  socks5h://host:1080  ",
      userAgent: "ua",
      cloudflareCookies: "cf=1",
    });
    expect(filled).toEqual({
      name: "东京出口",
      scope: "grok_build",
      enabled: true,
      proxyPool: true,
      accountCapacity: 3,
      proxyURL: "socks5h://host:1080",
      userAgent: "",
      cloudflareCookies: undefined,
    });

    const emptyProxy = nodeInputFromForm({ ...emptyNodeInput(), name: "直连", proxyURL: "   " });
    expect(emptyProxy.proxyURL).toBeUndefined();
  });
});
