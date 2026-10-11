import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ConfigEnv, type Plugin, type UserConfig } from "vite";

import { BUILD_MANIFEST_FILE, buildInputHash, writeBuildManifest } from "./scripts/build-inputs.ts";

/** 仅为成功写出的生产构建签名；构建过程中输入变化时拒绝登记新鲜产物。 */
function buildManifestPlugin(): Plugin {
  const options = { mode: "production", environment: { ...process.env } };
  let root = "";
  let outDir = "";
  let inputHash = "";
  let written = false;
  let failed = false;
  return {
    name: "grok2api-build-manifest",
    apply: "build",
    configResolved(config) {
      root = config.root;
      outDir = path.resolve(root, config.build.outDir);
      options.mode = config.mode;
    },
    buildStart() {
      written = false;
      failed = false;
      rmSync(path.join(outDir, BUILD_MANIFEST_FILE), { force: true, recursive: true });
      inputHash = buildInputHash(root, options);
    },
    buildEnd(error) {
      failed = Boolean(error);
    },
    writeBundle: {
      order: "post",
      sequential: true,
      handler() {
        written = true;
      },
    },
    closeBundle: {
      order: "post",
      sequential: true,
      handler() {
        if (failed || !written) return;
        if (inputHash !== buildInputHash(root, options)) throw new Error("前端构建期间输入发生变化，请重新构建");
        writeBuildManifest(outDir, inputHash);
      },
    },
  };
}

/**
 * 构建/开发共用配置工厂。
 *
 * - 导出工厂是为了让 vitest.config.ts 能合并「同一个已解析配置」，
 *   而不是把函数式配置直接传给 mergeConfig（那会破坏类型契约）。
 * - 开发代理目标只允许影响开发服务器：`command === "serve"` 且非测试/预览时才把
 *   VITE_DEV_API_TARGET 注入 __GROK2API_DEV_API_TARGET__，避免该变量污染
 *   生产产物的公开地址回退（runtime-config.ts 会把它当兜底地址）；
 *   构建期固定注入空串，保证产物不随本机环境变化，便于体积预算比较。
 * - 别名使用 fileURLToPath(import.meta.url) 而不是 CJS 的 __dirname：
 *   Vite 8 的原生配置加载器不支持 __dirname，会在每次构建输出警告。
 */
export function createViteConfig({ command, mode, isPreview }: ConfigEnv): UserConfig {
  const isDevServer = command === "serve" && mode !== "test" && !isPreview;
  const devApiTarget = isDevServer ? (process.env.VITE_DEV_API_TARGET ?? "") : "";
  return {
    plugins: [react(), tailwindcss(), ...(command === "build" && mode !== "test" ? [buildManifestPlugin()] : [])],
    define: {
      __GROK2API_DEV_API_TARGET__: JSON.stringify(devApiTarget),
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: isDevServer
        ? {
            "/api": process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:8000",
            "/v1": process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:8000",
            "/healthz": process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:8000",
            "/readyz": process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:8000",
          }
        : undefined,
    },
    build: {
      outDir: "dist",
      sourcemap: false,
    },
  };
}

export default defineConfig((env) => createViteConfig(env));
