import { describe, expect, it } from "vitest";

import {
  internalSignerHostname,
  validHTTPURL,
  validPublicAPIBaseURL,
  validStatsigID,
  validStatsigSignerURL,
} from "@/features/settings/settings-url-validation";

// 纯逻辑校验模块用 vitest（v8 覆盖率）运行；*.test.tsx 是因为 vitest.config.ts 的
// include 只接管 *.test.tsx，node:test 层用例不计入 v8 覆盖率（见该文件注释）。

/** 70 字节的合法 Statsig 值：内容不参与校验，只校验 base64 解码后的长度。 */
function statsigPayload(): string {
  return btoa("\u00ff".repeat(70));
}

describe("validPublicAPIBaseURL", () => {
  it("空值与纯空白视为未配置", () => {
    expect(validPublicAPIBaseURL("")).toBe(true);
    expect(validPublicAPIBaseURL("  ")).toBe(true);
  });

  it("接受 http/https 且不带凭据、查询与片段", () => {
    expect(validPublicAPIBaseURL("https://api.example.com")).toBe(true);
    expect(validPublicAPIBaseURL("http://api.example.com:8080")).toBe(true);
    expect(validPublicAPIBaseURL(" https://api.example.com/base ")).toBe(true);
  });

  it("拒绝凭据、查询、片段、非 http(s) 与无法解析的值", () => {
    expect(validPublicAPIBaseURL("https://user@api.example.com")).toBe(false);
    expect(validPublicAPIBaseURL("https://user:pass@api.example.com")).toBe(false);
    expect(validPublicAPIBaseURL("https://api.example.com?a=b")).toBe(false);
    expect(validPublicAPIBaseURL("https://api.example.com#x")).toBe(false);
    expect(validPublicAPIBaseURL("ftp://api.example.com")).toBe(false);
    expect(validPublicAPIBaseURL("api.example.com")).toBe(false);
  });
});

describe("validStatsigID", () => {
  it("只接受 base64 解码后恰好 70 字符的值", () => {
    const payload = statsigPayload();
    expect(validStatsigID(payload)).toBe(true);
  });

  it("同时接受 URL-safe 字符与去掉 padding 的写法", () => {
    const payload = statsigPayload();
    expect(validStatsigID(payload.replaceAll("+", "-").replaceAll("/", "_"))).toBe(true);
    expect(validStatsigID(payload.replaceAll("=", ""))).toBe(true);
  });

  it("长度不符或不是合法 base64 时拒绝", () => {
    expect(validStatsigID(btoa("short"))).toBe(false);
    expect(validStatsigID(btoa("\u00ff".repeat(71)))).toBe(false);
    expect(validStatsigID("!!!not-base64!!!")).toBe(false);
  });
});

describe("validStatsigSignerURL / validHTTPURL", () => {
  it("内网主机允许 http 与 https", () => {
    expect(validStatsigSignerURL("http://localhost:8080/signer")).toBe(true);
    expect(validStatsigSignerURL("https://172.16.0.9:8443")).toBe(true);
    expect(validHTTPURL("http://signer.internal")).toBe(true);
    expect(validHTTPURL("https://10.0.0.1")).toBe(true);
  });

  it("公网主机只允许 https 且端口为空或 443", () => {
    expect(validStatsigSignerURL("https://signer.example.com")).toBe(true);
    expect(validStatsigSignerURL("https://signer.example.com:443")).toBe(true);
    expect(validStatsigSignerURL("http://signer.example.com")).toBe(false);
    expect(validStatsigSignerURL("https://signer.example.com:8443")).toBe(false);
    expect(validHTTPURL("https://signer.example.com:8443")).toBe(false);
  });

  it("拒绝带凭据、查询、片段或无法解析的值", () => {
    expect(validStatsigSignerURL("https://user@signer.example.com")).toBe(false);
    expect(validStatsigSignerURL("https://user:pass@localhost")).toBe(false);
    expect(validHTTPURL("https://localhost?a=b")).toBe(false);
    expect(validHTTPURL("https://localhost#x")).toBe(false);
    expect(validStatsigSignerURL("not-a-url")).toBe(false);
    expect(validHTTPURL("not-a-url")).toBe(false);
  });
});

describe("internalSignerHostname", () => {
  it("识别 localhost / .local / .internal 后缀与单标签主机名", () => {
    expect(internalSignerHostname("LOCALHOST")).toBe(true);
    expect(internalSignerHostname("signer.localhost")).toBe(true);
    expect(internalSignerHostname("signer.local")).toBe(true);
    expect(internalSignerHostname("signer.internal")).toBe(true);
    expect(internalSignerHostname("localhost.")).toBe(true);
    expect(internalSignerHostname("intranet")).toBe(true);
    expect(internalSignerHostname("intra_net")).toBe(true);
    expect(internalSignerHostname("1234")).toBe(true);
    expect(internalSignerHostname("-")).toBe(false);
  });

  it("识别回环、ULA 与链路本地 IPv6 字面量", () => {
    expect(internalSignerHostname("[::1]")).toBe(true);
    expect(internalSignerHostname("fc00::1")).toBe(true);
    expect(internalSignerHostname("fd12:3456::1")).toBe(true);
    expect(internalSignerHostname("fe80::1")).toBe(true);
    expect(internalSignerHostname("fe00::1")).toBe(false);
  });

  it("按网段判断 IPv4，其他公网地址不算内网", () => {
    expect(internalSignerHostname("10.1.2.3")).toBe(true);
    expect(internalSignerHostname("127.0.0.1")).toBe(true);
    expect(internalSignerHostname("169.254.10.10")).toBe(true);
    expect(internalSignerHostname("172.16.0.1")).toBe(true);
    expect(internalSignerHostname("172.31.255.255")).toBe(true);
    expect(internalSignerHostname("192.168.1.1")).toBe(true);
    expect(internalSignerHostname("8.8.8.8")).toBe(false);
    expect(internalSignerHostname("172.32.0.1")).toBe(false);
    expect(internalSignerHostname("169.253.0.1")).toBe(false);
    expect(internalSignerHostname("signer.example.com")).toBe(false);
    expect(internalSignerHostname("1.2.3")).toBe(false);
    expect(internalSignerHostname("999.1.1.1")).toBe(false);
  });
});
