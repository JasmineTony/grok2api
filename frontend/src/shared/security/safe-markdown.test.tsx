import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SafeMarkdown } from "@/shared/security/safe-markdown";
import { sanitizeHTML } from "@/shared/security/safe-markdown-utils";

describe("SafeMarkdown", () => {
  it("removes executable and embedded content", () => {
    const html = sanitizeHTML(
      '<p>safe</p><script>alert(1)</script><iframe src="https://example.com"></iframe><svg onload="alert(1)"></svg>',
    );
    expect(html).toContain("safe");
    expect(html).not.toMatch(/script|iframe|svg|onload/i);
  });

  it("drops unsafe links and hardens external links", () => {
    const html = sanitizeHTML(
      '<a href="javascript:alert(1)" onclick="alert(1)" style="color:red">bad</a><a href="https://example.com/path">good</a>',
    );
    expect(html).not.toMatch(/javascript:|onclick|style=/i);
    expect(html).toContain('href="https://example.com/path"');
    expect(html).toContain('rel="nofollow noopener noreferrer"');
  });

  it("allows only secure or local media images", () => {
    const html = sanitizeHTML(
      '<img src="http://example.com/a.png"><img src="https://example.com/b.png"><img src="/v1/media/images/id">',
    );
    expect(html).not.toContain("http://example.com/a.png");
    expect(html).toContain("https://example.com/b.png");
    expect(html).toContain("/v1/media/images/id");
  });

  it("bounds table spans and strips event attributes", () => {
    const html = sanitizeHTML(
      '<table><tr><td colspan="101" rowspan="2" onmouseover="x">value</td></tr></table>',
    );
    expect(html).not.toContain("colspan");
    expect(html).toContain('rowspan="2"');
    expect(html).not.toContain("onmouseover");
  });

  it("renders safe markdown content", () => {
    render(
      <SafeMarkdown
        content="## Result

**ready**"
      />,
    );
    expect(screen.getByRole("heading", { name: "Result" })).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
  });
});
