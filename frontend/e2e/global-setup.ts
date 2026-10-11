import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { isBuildFresh } from "../scripts/build-inputs";

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

/** 输入内容与全部产物均匹配才复用；旧版 mtime 检查会漏掉删除和时间戳回退。 */
function ensureFrontendDist(): void {
  if (isBuildFresh(frontendDir, frontendDistPath)) return;
  runBuildCommand("pnpm", ["build"], frontendDir);
  if (!isBuildFresh(frontendDir, frontendDistPath)) {
    throw new Error(`前端构建未生成与当前输入一致的完整产物：${frontendDistPath}`);
  }
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
