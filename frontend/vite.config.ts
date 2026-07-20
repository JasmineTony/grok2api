import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __GROK2API_DEV_API_TARGET__: JSON.stringify(process.env.VITE_DEV_API_TARGET ?? ""),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
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
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "vendor-recharts", test: /node_modules[\/]recharts[\/]/, priority: 100, minModuleSize: 0, includeDependenciesRecursively: false },
            { name: "vendor-chart-runtime", test: /node_modules[\/](d3-|internmap|decimal\.js-light|react-fast-compare)/, priority: 90, minModuleSize: 0, includeDependenciesRecursively: false },
            { name: "vendor-router", test: /node_modules[\/]react-router/, priority: 80, minModuleSize: 0, includeDependenciesRecursively: false },
            { name: "vendor-react", test: /node_modules[\/](react|react-dom|scheduler)[\/]/, priority: 70, minModuleSize: 0, includeDependenciesRecursively: false },
            { name: "vendor-query", test: /node_modules[\/]@tanstack[\/]/, priority: 60, minModuleSize: 0, includeDependenciesRecursively: false },
            { name: "vendor-i18n", test: /node_modules[\/](i18next|react-i18next)[\/]/, priority: 50, minModuleSize: 0, includeDependenciesRecursively: false },
            { name: "vendor-radix", test: /node_modules[\/]@radix-ui[\/]/, priority: 40, minModuleSize: 0, includeDependenciesRecursively: false },
            { name: "vendor-app-ui", test: /node_modules[\/](next-themes|sonner)[\/]/, priority: 30, minModuleSize: 0, includeDependenciesRecursively: false },
          ],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
  },
});
