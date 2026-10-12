import { buildInputHash } from "./build-inputs.ts";

/** 夹具：由 vite.config.ts 直接 import 的构建插件（本轮 CI 缺陷中的缺失文件）。 */
export function buildManifestPlugin(): { name: string; hash: string } {
  return { name: "grok2api-build-manifest", hash: buildInputHash() };
}
