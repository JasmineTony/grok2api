import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  backendBinaryPath,
  backendDir,
  buildManifestPath,
  e2eArtifactsDir,
  frontendDir,
  frontendDistPath,
} from "./paths";

type BuildManifest = {
  backendBinary: string;
  frontendDist: string;
};

/** 运行外部构建命令；失败时给出完整命令与退出码，不静默降级到未知产物。 */
function runBuildCommand(command: string, args: string[], cwd: string): void {
  const printable = `${command} ${args.join(" ")}`;
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw new Error(`执行 ${printable} 失败：${result.error.message}`);
  if (result.status !== 0) throw new Error(`执行 ${printable} 失败，退出码 ${String(result.status)}`);
}

/** 收集会影响生产产物的输入：src 全部文件、入口 HTML 与构建配置。 */
function collectBuildInputs(): string[] {
  const inputs: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else inputs.push(full);
    }
  };
  walk(path.join(frontendDir, "src"));
  for (const name of [
    "index.html",
    "vite.config.ts",
    "tsconfig.json",
    "tsconfig.app.json",
    "tsconfig.node.json",
    "package.json",
  ]) {
    const full = path.join(frontendDir, name);
    if (existsSync(full)) inputs.push(full);
  }
  return inputs;
}

function newestMtimeMs(files: string[]): number {
  return files.reduce((newest, file) => Math.max(newest, statSync(file).mtimeMs), 0);
}

/**
 * dist 缺失、或早于任一构建输入时重建。
 * 只在缺失时构建会让 E2E 在改动源码后仍测到过期产物，属于"测了但没测当前代码"的假通过。
 * dist 已是最新时不做重复构建，避免与 pnpm verify 的构建链路重复。
 */
function ensureFrontendDist(): void {
  const indexPath = path.join(frontendDistPath, "index.html");
  const upToDate = existsSync(indexPath) && statSync(indexPath).mtimeMs >= newestMtimeMs(collectBuildInputs());
  if (upToDate) return;
  runBuildCommand("pnpm", ["build"], frontendDir);
  if (!existsSync(indexPath)) throw new Error(`前端构建未生成 ${indexPath}`);
}

/** 每次运行重建后端二进制，保证被测代码与当前工作树一致。 */
function ensureBackendBinary(): void {
  mkdirSync(e2eArtifactsDir, { recursive: true });
  runBuildCommand("go", ["build", "-o", backendBinaryPath, "./cmd/grok2api"], backendDir);
  if (!existsSync(backendBinaryPath)) throw new Error(`后端构建未生成 ${backendBinaryPath}`);
}

/** 构建一次产物并把路径交给 worker fixture（worker 进程无法继承本进程的 env）。 */
export default function globalSetup(): void {
  ensureFrontendDist();
  ensureBackendBinary();
  mkdirSync(e2eArtifactsDir, { recursive: true });
  const manifest: BuildManifest = { backendBinary: backendBinaryPath, frontendDist: frontendDistPath };
  writeFileSync(buildManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
