import path from "node:path";
import { fileURLToPath } from "node:url";

/** e2e 目录自身（本文件所在目录）。 */
export const e2eDir = fileURLToPath(new URL(".", import.meta.url));
/** frontend/ 目录。 */
export const frontendDir = path.resolve(e2eDir, "..");
/** 仓库根目录。 */
export const repoRoot = path.resolve(frontendDir, "..");
/** backend/ 目录，Go 构建入口 ./cmd/grok2api 所在位置。 */
export const backendDir = path.join(repoRoot, "backend");
/** 生产前端产物目录；由 globalSetup 保证存在，不由测试生成第二套产物。 */
export const frontendDistPath = path.join(frontendDir, "dist");
/** E2E 产物根目录；已在根 .gitignore 中忽略。 */
export const e2eArtifactsDir = path.join(frontendDir, ".artifacts", "e2e");
/** 一次性构建的后端二进制；每次 E2E 运行重建，避免测到过期二进制。 */
export const backendBinaryPath = path.join(e2eArtifactsDir, process.platform === "win32" ? "grok2api.exe" : "grok2api");
/** globalSetup 与 worker fixture 之间传递构建产物的清单。 */
export const buildManifestPath = path.join(e2eArtifactsDir, "build-manifest.json");
