import { AssistantContent } from "@/features/creative-console/chat-markdown";
import {
  boundedTableSpan,
  renderAssistantMarkup,
  safeAssistantImage,
  safeAssistantLink,
  sanitizeAssistantHTML,
} from "@/features/creative-console/chat-markdown-sanitize";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

function sanitize(html: string): string {
  return sanitizeAssistantHTML(renderAssistantMarkup(html));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("助手回复的 Markdown 安全渲染", () => {
  it("丢弃脚本与事件属性，只保留白名单标签", () => {
    const html = sanitize('<p onclick="steal()">正文</p><script>alert(1)</script><example-tag>裸文本</example-tag>');
    expect(html).toContain("<p>正文</p>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("<example-tag>");
    expect(html).toContain("裸文本");
  });

  it("链接只允许 http/https/mailto，并补上打开方式与 rel", () => {
    const html = sanitize("[好](https://example.com/a) [坏](javascript:alert(1)) [信](mailto:a@b.c)");
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('rel="nofollow noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("mailto:a@b.c");
    expect(safeAssistantLink("ftp://example.com")).toBe("");
    expect(safeAssistantLink("   ")).toBe("");
  });

  it("图片只允许 https 与本地媒体路径，其他来源整段移除", () => {
    const httpsImage = sanitize("![图](https://cdn.example.com/a.png)");
    expect(httpsImage).toContain('src="https://cdn.example.com/a.png"');
    expect(httpsImage).toContain('loading="lazy"');
    expect(httpsImage).toContain('referrerpolicy="no-referrer"');

    const localImage = sanitize("![图](/v1/media/images/a.png)");
    expect(localImage).toContain('src="/v1/media/images/a.png"');

    const blocked = sanitize("![图](http://insecure.example.com/a.png)");
    expect(blocked).not.toContain("<img");
    expect(safeAssistantImage("http://insecure.example.com/a.png")).toBe("");
    expect(safeAssistantImage(null)).toBe("");
  });

  it("表格跨度只保留 1..100 的整数，details 的 open 保留", () => {
    const html = sanitize(
      '<table><tr><td colspan="3">a</td><td colspan="999">b</td><td rowspan="x">c</td></tr></table>',
    );
    expect(html).toContain('colspan="3"');
    expect(html).not.toContain("999");
    expect(html).not.toContain("rowspan");
    expect(boundedTableSpan("12")).toBe("12");
    expect(boundedTableSpan("0")).toBe("");
    expect(boundedTableSpan(null)).toBe("");

    const details = sanitize("<details open><summary>摘要</summary>内容</details>");
    expect(details).toContain("open");
    expect(details).toContain("<summary>摘要</summary>");
  });

  it("无 HTML 结构或缺少 DOMParser 时退回纯文本渲染", () => {
    expect(renderAssistantMarkup("")).toBe("");
    expect(sanitizeAssistantHTML("   ")).toBe("");
    expect(sanitizeAssistantHTML("没有标签的正文")).toBe("");

    render(<AssistantContent content="**加粗**" />);
    expect(screen.getByText("加粗")).toBeInTheDocument();

    const { container } = render(<AssistantContent content="" />);
    expect(container.querySelector("[class*='whitespace-pre-wrap']")).not.toBeNull();

    vi.stubGlobal("DOMParser", undefined);
    expect(sanitizeAssistantHTML("<p>正文</p>")).toBe("");
  });
});
