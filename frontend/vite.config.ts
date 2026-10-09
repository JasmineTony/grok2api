import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ConfigEnv, type UserConfig } from "vite";

/**
 * 构建/开发共用配置工厂。
 *
 * - 导出工厂是为了让 vitest.config.ts 能合并「同一个已解析配置」，
 *   而不是把函数式配置直接传给 mergeConfig（那会破坏类型契约）。
 * - 开发代理目标只允许影响开发服务器：`command === "serve"` 时才把
 *   VITE_DEV_API_TARGET 注入 __GROK2API_DEV_API_TARGET__，避免该变量污染
 *   生产产物的公开地址回退（runtime-config.ts 会把它当兜底地址）；
 *   构建期固定注入空串，保证产物不随本机环境变化，便于体积预算比较。
 * - 别名使用 fileURLToPath(import.meta.url) 而不是 CJS 的 __dirname：
 *   Vite 8 的原生配置加载器不支持 __dirname，会在每次构建输出警告。
 */
export function createViteConfig({ command }: ConfigEnv): UserConfig {
  const devApiTarget = command === "serve" ? (process.env.VITE_DEV_API_TARGET ?? "") : "";
  return {
    plugins: [react(), tailwindcss()],
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
      proxy: {
        "/api": process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:8000",
        "/v1": process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:8000",
        "/healthz": process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:8000",
        "/readyz": process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:8000",
      },
    },
    build: {
      outDir: "dist",
      sourcemap: false,
    },
  };
}

export default defineConfig((env) => createViteConfig(env));
