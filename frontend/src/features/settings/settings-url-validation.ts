/** 设置项 URL 校验：公网地址、Statsig 签名 URL 与内网主机识别。 */

export function validPublicAPIBaseURL(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  try {
    const parsed = new URL(trimmed);
    if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") return false;
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function validStatsigID(value: string): boolean {
  try {
    const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return atob(padded).length === 70;
  } catch {
    return false;
  }
}

export function validStatsigSignerURL(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") return false;
    const internal = internalSignerHostname(parsed.hostname);
    if (internal) return parsed.protocol === "http:" || parsed.protocol === "https:";
    return parsed.protocol === "https:" && (parsed.port === "" || parsed.port === "443");
  } catch {
    return false;
  }
}

export function validHTTPURL(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") return false;
    const internal = internalSignerHostname(parsed.hostname);
    if (internal) return parsed.protocol === "http:" || parsed.protocol === "https:";
    return parsed.protocol === "https:" && (parsed.port === "" || parsed.port === "443");
  } catch {
    return false;
  }
}

export function internalSignerHostname(value: string): boolean {
  const host = value
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal"))
    return true;
  if (!host.includes(".")) {
    if (host.includes(":")) return host === "::1" || /^(?:fc|fd|fe[89ab])/i.test(host);
    return /^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$/i.test(host);
  }
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}
