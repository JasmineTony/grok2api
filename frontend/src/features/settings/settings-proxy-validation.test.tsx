import { describe, expect, it } from "vitest";

import { validSubscriptionProxyURL } from "@/features/settings/settings-proxy-validation";

// 纯逻辑校验模块用 vitest（v8 覆盖率）运行：模块只暴露 validSubscriptionProxyURL，
// 其余校验函数通过该入口按协议分支驱动；用例以「输入 → 是否接受」的表格为主。
// 说明：*.test.tsx 是因为 vitest.config.ts 的 include 只接管 *.test.tsx，
// node:test 层的同名用例不计入 v8 覆盖率（见 vitest.config.ts 注释）。

const UUID = "0f8f8d8a-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

function base64(value: string): string {
  return btoa(value);
}

function vmess(config: Record<string, unknown>): string {
  return `vmess://${base64(JSON.stringify(config)).replaceAll("+", "-").replaceAll("/", "_")}`;
}

function vmessRaw(payload: string): string {
  return `vmess://${payload}`;
}

function shadowsocksLegacy(decoded: string): string {
  return `ss://${base64(decoded)}`;
}

describe("validSubscriptionProxyURL 通用规则", () => {
  it("空串与纯空白视为未填写", () => {
    expect(validSubscriptionProxyURL("")).toBe(true);
    expect(validSubscriptionProxyURL("   ")).toBe(true);
    expect(validSubscriptionProxyURL("\t")).toBe(true);
  });

  it("订阅代理不接受 {account} 占位符", () => {
    expect(validSubscriptionProxyURL("socks5h://user:{account}@host:1080")).toBe(false);
    expect(validSubscriptionProxyURL("{account}")).toBe(false);
  });

  it("超长或含控制字符的值一律拒绝", () => {
    expect(validSubscriptionProxyURL(`http://host/${"a".repeat(8_200)}`)).toBe(false);
    expect(validSubscriptionProxyURL("socks5h://user:pass@host:1080\u0001")).toBe(false);
    expect(validSubscriptionProxyURL("socks5h://user:pass@host:1080\u007f")).toBe(false);
  });
});

describe("validSubscriptionProxyURL HTTP(S) / SOCKS", () => {
  it("接受无路径、无查询、无片段的 HTTP(S) / SOCKS 地址", () => {
    expect(validSubscriptionProxyURL("http://proxy.example.com:8080")).toBe(true);
    expect(validSubscriptionProxyURL("https://proxy.example.com")).toBe(true);
    expect(validSubscriptionProxyURL("socks4://proxy.example.com:1080")).toBe(true);
    expect(validSubscriptionProxyURL("socks4a://proxy.example.com:1080")).toBe(true);
    expect(validSubscriptionProxyURL("socks5://user:pass@proxy.example.com:1080")).toBe(true);
    expect(validSubscriptionProxyURL("socks5h://user:pass@proxy.example.com:1080")).toBe(true);
    expect(validSubscriptionProxyURL("  https://proxy.example.com/  ")).toBe(true);
  });

  it("拒绝带路径、查询或片段的地址", () => {
    expect(validSubscriptionProxyURL("http://proxy.example.com:8080/path")).toBe(false);
    expect(validSubscriptionProxyURL("http://proxy.example.com:8080?a=b")).toBe(false);
    expect(validSubscriptionProxyURL("http://proxy.example.com:8080#frag")).toBe(false);
  });

  it("拒绝非代理协议与无法解析的地址", () => {
    expect(validSubscriptionProxyURL("ftp://proxy.example.com")).toBe(false);
    expect(validSubscriptionProxyURL("ws://proxy.example.com")).toBe(false);
    // 特殊协议为空主机时 new URL 直接抛错，走 catch 分支
    expect(validSubscriptionProxyURL("https://")).toBe(false);
    expect(validSubscriptionProxyURL("http://proxy example.com")).toBe(false);
    expect(validSubscriptionProxyURL("not-a-proxy")).toBe(false);
  });
});

describe("validSubscriptionProxyURL trojan / vless 隧道", () => {
  it("接受 tcp 与 websocket 传输，并允许 tls", () => {
    expect(validSubscriptionProxyURL("trojan://password@tunnel.example.com:443")).toBe(true);
    expect(validSubscriptionProxyURL("trojan://password@tunnel.example.com:443?type=none")).toBe(true);
    expect(validSubscriptionProxyURL("trojan://password@tunnel.example.com:443?type=tcp&security=tls")).toBe(true);
    expect(validSubscriptionProxyURL("trojan://password@tunnel.example.com:443?network=ws")).toBe(true);
    expect(
      validSubscriptionProxyURL("trojan://password@tunnel.example.com:443?type=websocket&host=cdn.example.com"),
    ).toBe(true);
  });

  it("websocket 主机名回退顺序为 host → sni → peer → 自身主机名", () => {
    expect(validSubscriptionProxyURL("trojan://password@tunnel.example.com:443?type=ws&sni=cdn.example.com")).toBe(
      true,
    );
    expect(validSubscriptionProxyURL("trojan://password@tunnel.example.com:443?type=ws&peer=cdn.example.com")).toBe(
      true,
    );
    expect(validSubscriptionProxyURL("trojan://password@localhost:443?type=ws")).toBe(true);
  });

  it("拒绝缺少凭据或端口、非 tcp/ws 传输、额外安全参数", () => {
    expect(validSubscriptionProxyURL("trojan://@tunnel.example.com:443")).toBe(false);
    expect(validSubscriptionProxyURL("trojan://user:password@tunnel.example.com:443")).toBe(false);
    expect(validSubscriptionProxyURL("trojan://password@tunnel.example.com")).toBe(false);
    expect(validSubscriptionProxyURL("trojan://password@tunnel.example.com:443?type=grpc")).toBe(false);
    expect(validSubscriptionProxyURL("trojan://password@tunnel.example.com:443?security=reality")).toBe(false);
    expect(validSubscriptionProxyURL("trojan://password@tunnel.example.com:443?flow=xtls-rprx-vision")).toBe(false);
    expect(validSubscriptionProxyURL("trojan://password@tunnel.example.com:443?headerType=http")).toBe(false);
    expect(validSubscriptionProxyURL("trojan://password@tunnel.example.com:443/path")).toBe(false);
  });

  it("非 websocket 传输不接受 host / path 参数", () => {
    expect(validSubscriptionProxyURL("trojan://password@tunnel.example.com:443?host=cdn.example.com")).toBe(false);
    expect(validSubscriptionProxyURL("trojan://password@tunnel.example.com:443?type=tcp&path=/ws")).toBe(false);
  });

  it("websocket 主机名无法解析或为空时拒绝", () => {
    // "[": new URL("http://[") 抛错，走 validWebSocketHost 的 catch
    expect(validSubscriptionProxyURL("trojan://password@tunnel.example.com:443?type=ws&host=%5B")).toBe(false);
    expect(validSubscriptionProxyURL("trojan://password@tunnel.example.com:443?type=ws&sni=%20%20")).toBe(false);
  });
  it("websocket 主机名带凭据或路径时拒绝", () => {
    expect(
      validSubscriptionProxyURL("trojan://password@tunnel.example.com:443?type=ws&host=user@cdn.example.com"),
    ).toBe(false);
    expect(
      validSubscriptionProxyURL("trojan://password@tunnel.example.com:443?type=ws&host=cdn.example.com/path"),
    ).toBe(false);
  });

  it("allowInsecure / insecure / skip-cert-verify 只接受布尔字面量", () => {
    expect(validSubscriptionProxyURL("trojan://password@tunnel.example.com:443?allowInsecure=1")).toBe(true);
    expect(validSubscriptionProxyURL("trojan://password@tunnel.example.com:443?insecure=false")).toBe(true);
    expect(validSubscriptionProxyURL("trojan://password@tunnel.example.com:443?skip-cert-verify=maybe")).toBe(false);
    expect(validSubscriptionProxyURL("trojan://password@tunnel.example.com:443?allowInsecure=")).toBe(true);
    expect(validSubscriptionProxyURL("trojan://password@tunnel.example.com:443?allowInsecure=2")).toBe(false);
  });

  it("vless 额外要求合法 UUID 与 encryption=none", () => {
    expect(validSubscriptionProxyURL(`vless://${UUID}@tunnel.example.com:443?encryption=none`)).toBe(true);
    expect(validSubscriptionProxyURL(`vless://${UUID}@tunnel.example.com:443`)).toBe(true);
    expect(validSubscriptionProxyURL("vless://not-a-uuid@tunnel.example.com:443")).toBe(false);
    expect(validSubscriptionProxyURL(`vless://${UUID}@tunnel.example.com:443?encryption=auto`)).toBe(false);
  });
});

describe("validSubscriptionProxyURL Shadowsocks", () => {
  it("接受明文与 base64 凭据、legacy 形式与大小写方法名", () => {
    expect(validSubscriptionProxyURL("ss://aes-256-gcm:password@host.example.com:8388")).toBe(true);
    expect(validSubscriptionProxyURL(`ss://${base64("aes-256-gcm:password")}@host.example.com:8388`)).toBe(true);
    expect(validSubscriptionProxyURL(shadowsocksLegacy("aes-128-gcm:password@host.example.com:1080"))).toBe(true);
    expect(validSubscriptionProxyURL(shadowsocksLegacy("chacha20-ietf-poly1305:password@host.example.com:1080"))).toBe(
      true,
    );
    expect(validSubscriptionProxyURL("ss:// AES-128-GCM :password@host.example.com:8388")).toBe(true);
    expect(validSubscriptionProxyURL("ss://aes-256-gcm:password@[::1]:8388")).toBe(true);
    expect(validSubscriptionProxyURL("ss://aes-256-gcm:password@host.example.com:8388?")).toBe(true);
  });

  it("拒绝不支持的加密方法、缺少凭据或分隔符错位", () => {
    expect(validSubscriptionProxyURL("ss://aes-192-gcm:password@host.example.com:8388")).toBe(false);
    expect(validSubscriptionProxyURL("ss://:password@host.example.com:8388")).toBe(false);
    expect(validSubscriptionProxyURL("ss://aes-256-gcm:@host.example.com:8388")).toBe(false);
    expect(validSubscriptionProxyURL(shadowsocksLegacy("no-account-separator"))).toBe(false);
  });

  it("拒绝查询参数、带路径的服务器地址与非法编码", () => {
    expect(validSubscriptionProxyURL("ss://aes-256-gcm:password@host.example.com:8388?plugin=obfs")).toBe(false);
    expect(validSubscriptionProxyURL("ss://aes-256-gcm:password@host.example.com:8388/path")).toBe(false);
    expect(validSubscriptionProxyURL("ss://%%@host.example.com:8388")).toBe(false);
    expect(validSubscriptionProxyURL("ss://")).toBe(false);
  });
});

describe("validSubscriptionProxyURL VMess", () => {
  it("接受 tcp 与 websocket 配置及其布尔/数字开关", () => {
    expect(validSubscriptionProxyURL(vmess({ add: "host.example.com", port: 443, id: UUID }))).toBe(true);
    expect(
      validSubscriptionProxyURL(
        vmess({ add: "host.example.com", port: 443, id: UUID, net: "tcp", tls: "tls", type: "none", aid: 0 }),
      ),
    ).toBe(true);
    expect(
      validSubscriptionProxyURL(
        vmess({ add: "host.example.com", port: 443, id: UUID, net: "websocket", host: "cdn.example.com" }),
      ),
    ).toBe(true);
    expect(
      validSubscriptionProxyURL(
        vmess({ add: "host.example.com", port: 443, id: UUID, net: "ws", sni: "cdn.example.com" }),
      ),
    ).toBe(true);
    expect(
      validSubscriptionProxyURL(vmess({ add: "host.example.com", port: 443, id: UUID, allowInsecure: 0, aid: 65535 })),
    ).toBe(true);
    expect(
      validSubscriptionProxyURL(vmess({ add: "host.example.com", port: 65535, id: UUID, allowInsecure: "yes" })),
    ).toBe(true);
    expect(
      validSubscriptionProxyURL(vmess({ add: "host.example.com", port: 443, id: UUID, allowInsecure: "maybe" })),
    ).toBe(false);
    expect(validSubscriptionProxyURL(vmess({ add: "host.example.com", port: 443, id: UUID, allowInsecure: 2 }))).toBe(
      false,
    );
    expect(validSubscriptionProxyURL(vmess({ add: "host.example.com", port: 443, id: UUID, allowInsecure: {} }))).toBe(
      false,
    );
  });

  it("拒绝缺少服务器、非法端口与非法 UUID/alterId", () => {
    expect(validSubscriptionProxyURL(vmess({ port: 443, id: UUID }))).toBe(false);
    expect(validSubscriptionProxyURL(vmess({ add: "   ", port: 443, id: UUID }))).toBe(false);
    expect(validSubscriptionProxyURL(vmess({ add: "host.example.com", port: 0, id: UUID }))).toBe(false);
    expect(validSubscriptionProxyURL(vmess({ add: "host.example.com", port: 65536, id: UUID }))).toBe(false);
    expect(validSubscriptionProxyURL(vmess({ add: "host.example.com", port: "abc", id: UUID }))).toBe(false);
    expect(validSubscriptionProxyURL(vmess({ add: "host.example.com", port: 443, id: "nope" }))).toBe(false);
    expect(validSubscriptionProxyURL(vmess({ add: "host.example.com", port: 443, id: UUID, aid: -1 }))).toBe(false);
    expect(validSubscriptionProxyURL(vmess({ add: "host.example.com", port: 443, id: UUID, aid: 65536 }))).toBe(false);
    expect(validSubscriptionProxyURL(vmess({ add: "host.example.com", port: 443, id: UUID, aid: "two" }))).toBe(false);
  });

  it("拒绝不支持的传输、TLS、加密与头类型", () => {
    expect(validSubscriptionProxyURL(vmess({ add: "host.example.com", port: 443, id: UUID, net: "http" }))).toBe(false);
    expect(validSubscriptionProxyURL(vmess({ add: "host.example.com", port: 443, id: UUID, tls: "reality" }))).toBe(
      false,
    );
    expect(validSubscriptionProxyURL(vmess({ add: "host.example.com", port: 443, id: UUID, scy: "rc4" }))).toBe(false);
    expect(
      validSubscriptionProxyURL(vmess({ add: "host.example.com", port: 443, id: UUID, security: "chacha20-poly1305" })),
    ).toBe(true);
    expect(validSubscriptionProxyURL(vmess({ add: "host.example.com", port: 443, id: UUID, type: "http" }))).toBe(
      false,
    );
  });

  it("非 websocket 传输不接受 host / path，websocket 主机名必须合法", () => {
    expect(validSubscriptionProxyURL(vmess({ add: "host.example.com", port: 443, id: UUID, path: "/ws" }))).toBe(false);
    expect(
      validSubscriptionProxyURL(vmess({ add: "host.example.com", port: 443, id: UUID, host: "cdn.example.com" })),
    ).toBe(false);
    expect(
      validSubscriptionProxyURL(
        vmess({ add: "host.example.com", port: 443, id: UUID, net: "ws", host: "user@cdn.example.com" }),
      ),
    ).toBe(false);
  });

  it("非法 base64 或 JSON 一律拒绝", () => {
    expect(validSubscriptionProxyURL(vmessRaw("!!!not-base64!!!"))).toBe(false);
    expect(validSubscriptionProxyURL(vmessRaw(base64("not json")))).toBe(false);
  });
});
