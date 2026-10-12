import { buildManifestPlugin } from "./scripts/build-manifest-plugin.ts";

/** 夹具：与真实仓库同构的构建配置工厂（被 vitest.config.ts import）。 */
export function createViteConfig(): { plugins: unknown[] } {
  return { plugins: [buildManifestPlugin()] };
}
