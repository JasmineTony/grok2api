import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, writeFileSync, type Dirent } from "node:fs";
import path from "node:path";

export const BUILD_MANIFEST_FILE = ".build-manifest.json";
const MANIFEST_VERSION = 1;
const CONFIG_INPUTS = [
  "index.html",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "vite.config.ts",
  "vitest.config.ts",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "scripts/build-inputs.ts",
  ".npmrc",
  ".pnpmfile.cjs",
  ".node-version",
  ".nvmrc",
  ".browserslistrc",
  ".gitignore",
];
const BUILD_TOOLS = ["typescript", "vite", "@vitejs/plugin-react", "@tailwindcss/vite", "tailwindcss"];
const SCRIPT_TEST_PATTERN = /\.(?:test|spec)\.ts$/;

type FileDigest = [name: string, hash: string | null];
type BuildInputOptions = { mode?: string; environment?: NodeJS.ProcessEnv };
type BuildManifest = { version: number; inputHash: string; outputHash: string };

function hash(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** 只处理预期的缺失；权限、读取失败等错误仍须中断，不能伪装成空输入。 */
function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

function fileDigest(root: string, name: string): FileDigest {
  try {
    return [name, hash(readFileSync(path.join(root, name)))];
  } catch (error) {
    if (isMissing(error)) return [name, null];
    throw error;
  }
}

function treeDigests(root: string, directory: string, excluded = ""): FileDigest[] {
  let directoryEntries: Dirent[];
  try {
    directoryEntries = readdirSync(path.join(root, directory), { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const entries: FileDigest[] = [];
  for (const entry of directoryEntries) {
    const name = directory ? `${directory}/${entry.name}` : entry.name;
    if (name === excluded) continue;
    if (entry.isSymbolicLink()) throw new Error(`构建指纹不支持符号链接：${name}`);
    if (entry.isDirectory()) entries.push(...treeDigests(root, name, excluded));
    else if (entry.isFile()) entries.push(fileDigest(root, name));
    else throw new Error(`构建指纹不支持非普通文件：${name}`);
  }
  return entries;
}

/** 内容与相对路径共同参与指纹；删除、重命名、mtime 保留或回退均不会漏检。 */
export function buildInputHash(root: string, options: BuildInputOptions = {}): string {
  const mode = options.mode ?? "production";
  const environment = options.environment ?? process.env;
  const names = [
    ...CONFIG_INPUTS,
    ".env",
    ".env.local",
    `.env.${mode}`,
    `.env.${mode}.local`,
    "node_modules/.pnpm/lock.yaml",
    ...BUILD_TOOLS.map((name) => `node_modules/${name}/package.json`),
    ...readdirSync(root).filter((name) => /^(?:postcss|tailwind)\.config\.[cm]?[jt]s$/.test(name)),
  ];
  // Tailwind 自动扫描 src 中的类名；测试也可能影响 CSS，不能仅凭文件名排除。
  const files = [
    ...names.map((name) => fileDigest(root, name)),
    ...treeDigests(root, "src"),
    ...treeDigests(root, "public"),
    // 构建期脚本（含 Vite 插件）决定产物内容；脚本测试只影响测试自身，不参与指纹。
    ...treeDigests(root, "scripts").filter(([name]) => !SCRIPT_TEST_PATTERN.test(name)),
  ];
  files.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const publicEnvironment = Object.keys(environment)
    .filter((name) => name.startsWith("VITE_") && name !== "VITE_USER_NODE_ENV")
    .sort()
    .map((name) => [name, environment[name]]);
  // 只落盘总 hash，不保存环境变量、.env/.npmrc 原文或本机绝对路径。
  return hash(
    JSON.stringify({
      version: MANIFEST_VERSION,
      mode,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      nodeEnv: environment.NODE_ENV ?? "production",
      publicEnvironment,
      files,
    }),
  );
}

function outputHash(outDir: string): string | null {
  const index = path.join(outDir, "index.html");
  if (!lstatSync(index).isFile() || readFileSync(index).length === 0) return null;
  const files = treeDigests(outDir, "", BUILD_MANIFEST_FILE);
  files.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return hash(JSON.stringify(files));
}

/** 由 Vite 完成产物写入后调用；清单自身不参与产物 hash，避免自引用。 */
export function writeBuildManifest(outDir: string, inputHash: string): void {
  const digest = outputHash(outDir);
  if (digest === null) throw new Error(`前端构建缺少非空普通入口文件：${outDir}`);
  const manifest: BuildManifest = { version: MANIFEST_VERSION, inputHash, outputHash: digest };
  writeFileSync(path.join(outDir, BUILD_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function isBuildManifest(value: unknown): value is BuildManifest {
  if (typeof value !== "object" || value === null) return false;
  return (
    "version" in value &&
    value.version === MANIFEST_VERSION &&
    "inputHash" in value &&
    typeof value.inputHash === "string" &&
    /^[a-f0-9]{64}$/.test(value.inputHash) &&
    "outputHash" in value &&
    typeof value.outputHash === "string" &&
    /^[a-f0-9]{64}$/.test(value.outputHash)
  );
}

/** 缺失/损坏清单、输入变化或任一产物变化均须重建；其它 I/O 错误显式抛出。 */
export function isBuildFresh(root: string, outDir: string, options: BuildInputOptions = {}): boolean {
  try {
    const manifestPath = path.join(outDir, BUILD_MANIFEST_FILE);
    if (!lstatSync(manifestPath).isFile()) return false;
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    return (
      isBuildManifest(manifest) &&
      manifest.inputHash === buildInputHash(root, options) &&
      manifest.outputHash === outputHash(outDir)
    );
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return false;
    throw error;
  }
}
