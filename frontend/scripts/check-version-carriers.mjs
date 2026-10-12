#!/usr/bin/env node
/**
 * 版本载体一致性门禁（AGENTS.md §8）。
 *
 * 背景：`.github/workflows/ghcr-image.yml` 的 `Verify version carriers are aligned` 只在 CI 上校验
 * 「仓库根 VERSION === v + frontend/package.json 的 version」。本地没有任何等价检查：发版前把两侧版本改歪，
 * 要等推送后的 CI 才变红。本脚本把同一条断言搬到本地，并接进 `pnpm verify` 的第一步（最廉价、最先失败）。
 *
 * 与 CI 步骤的语义逐句对应：
 *   version_file=$(tr -d '[:space:]' < VERSION)
 *     → readVersionFile：读仓库根 VERSION，去掉全部空白后作为左侧值；
 *   package_version=$(jq -r .version frontend/package.json)
 *     → readPackageVersion：读 frontend/package.json 的 version 字段（字符串原文比较）；
 *   [ "$version_file" = "v$package_version" ] 否则 exit 1
 *     → 两侧相等 → 退出码 0；不等 → 退出码 1。
 * 唯一有意保留的差异：命令替换会去掉 jq 输出的尾部换行，本脚本按字符串原文比较，因此 version 字段自带
 * 前后空白的畸形写法在本地会失败、在 CI 未必失败——方向是更严格（fail-closed），不放宽。
 *
 * fail-closed：VERSION 缺失或去掉空白后为空、frontend/package.json 缺失或 JSON 不可解析、version 字段缺失或
 * 不是字符串 → 退出码 2（无法判定）。CI 里这些形态都会因命令失败 / 空值而报错，本地不得静默放行。
 *
 * 环境变量：VERSION_CARRIER_ROOT 覆盖「仓库根」，**只允许指向系统临时目录（os.tmpdir()）之下**，仅供
 * scripts/self-test-gates.mjs 的合成夹具使用（夹具因此永远不读也不写真实 VERSION 文件）。本地门禁与 CI 都
 * 不设置它；指向 tmp 之外时打印原因并以退出码 2 拒绝，门禁不得被外部环境重定向到伪造的载体。
 *
 * 退出码：0 = 一致；1 = 不一致；2 = 无法判定（载体缺失 / 不可解析 / 覆盖越界）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根由脚本自身位置推导（scripts/ 的上两级），不依赖 cwd：从任意目录调用语义一致。 */
const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendDir, "..");

/** 依据（失败输出必须给出，便于定位规则来源）。 */
const RULE_REFERENCE =
  "依据 AGENTS.md §8：仓库根 `VERSION` 是唯一权威版本源（`Dockerfile` 把它复制到镜像 /app/VERSION，" +
  "`backend/internal/buildinfo/version.go` 的 `CurrentVersion()` 读取它），`frontend/package.json` 的 version " +
  "必须与它处于同一条版本线；CI 步骤 `Verify version carriers are aligned` 对同一条件强制。";

/** 已存在路径取 realpath（消除 Windows 短名与符号链接差异）；不存在时原样返回，交由载体读取失败处理。 */
function realPathOrSelf(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

/**
 * 载体根目录：默认仓库根；VERSION_CARRIER_ROOT 只允许指向系统临时目录（os.tmpdir()）之下。
 * 限制理由与 scripts/check-test-results.mjs 的 TEST_REPORT_ROOT、check-node-test-results.mjs 的
 * NODE_TEST_REPORT_ROOT 同一口径：该覆盖只为 scripts/self-test-gates.mjs 的临时装置存在
 * （根目录来自 fs.mkdtempSync(path.join(os.tmpdir(), ...))），本地门禁与 CI 都不设置它。若允许任意路径，
 * 一次可见的包装层改动就能把门禁指向合成的「一致」载体并拿到 exit 0，门禁形同虚设（AGENTS.md EVID-1）。
 * 判定：覆盖路径（realpath 归一后）不在 tmp 之下 → 打印原因并返回 null，main() 以退出码 2 拒绝、绝不放行。
 */
function resolveCarrierRoot() {
  const override = process.env.VERSION_CARRIER_ROOT;
  if (!override) return repoRoot;
  const resolved = realPathOrSelf(path.resolve(override));
  const tempRoot = realPathOrSelf(os.tmpdir());
  const relative = path.relative(tempRoot, resolved);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return resolved;
  console.error(
    `拒绝 VERSION_CARRIER_ROOT=${override}：该覆盖只允许指向系统临时目录 ${tempRoot} 之下（仅供 ` +
      "self-test-gates.mjs 的合成夹具）；门禁不得被外部环境重定向到伪造的版本载体。",
  );
  return null;
}

const carrierRoot = resolveCarrierRoot();

/** 仓库根 VERSION：等价于 CI 的 `tr -d '[:space:]' < VERSION`。返回 { value } 或 { problems }。 */
function readVersionFile(rootDir) {
  const target = path.join(rootDir, "VERSION");
  if (!fs.existsSync(target)) return { problems: [`仓库根 VERSION 不存在：${target}`] };
  const value = fs.readFileSync(target, "utf8").replace(/\s+/gu, "");
  if (value.length === 0) return { problems: [`仓库根 VERSION 去掉空白后为空：${target}`] };
  return { value, problems: [] };
}

/** frontend/package.json 的 version：等价于 CI 的 `jq -r .version frontend/package.json`。 */
function readPackageVersion(rootDir) {
  const target = path.join(rootDir, "frontend", "package.json");
  if (!fs.existsSync(target)) return { problems: [`frontend/package.json 不存在：${target}`] };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (error) {
    return { problems: [`frontend/package.json 无法解析：${error.message}`] };
  }
  const value = parsed?.version;
  if (typeof value !== "string") {
    return { problems: [`frontend/package.json 缺少字符串 version 字段（实际 ${JSON.stringify(value ?? null)}）`] };
  }
  return { value, problems: [] };
}

/** 无法判定（退出码 2）：逐条打印原因 + 两侧实际读取结果，避免只报「失败」而看不出是哪一侧坏掉。 */
function reportUnusable(problems, versionFile, packageVersion) {
  console.error(`\n无法判定版本载体一致性（fail-closed，退出码 2）：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    `  已读到：VERSION=${JSON.stringify(versionFile.value ?? null)}、package.json version=${JSON.stringify(packageVersion.value ?? null)}`,
  );
  console.error(`  ${RULE_REFERENCE}`);
  return 2;
}

/** 不一致（退出码 1）：写明两侧值、期望格式与修复方式。 */
function reportMismatch(versionFile, packageVersion) {
  const expected = `v${packageVersion.value}`;
  console.error(
    `\n版本载体不一致：仓库根 VERSION = ${JSON.stringify(versionFile.value)}，` +
      `frontend/package.json:version = ${JSON.stringify(packageVersion.value)}，期望 VERSION = ${JSON.stringify(expected)}` +
      `（格式形如 v<package.json 的 version>）。`,
  );
  console.error(`  ${RULE_REFERENCE}`);
  console.error("  修复：把仓库根 VERSION 与 frontend/package.json 的 version 改成同一条版本线后重跑。");
  return 1;
}

function main() {
  // 越界的 VERSION_CARRIER_ROOT 已在 resolveCarrierRoot 打印原因；这里绝不放行（EVID-1）。
  if (carrierRoot === null) return 2;
  const versionFile = readVersionFile(carrierRoot);
  const packageVersion = readPackageVersion(carrierRoot);
  const problems = [...versionFile.problems, ...packageVersion.problems];
  if (problems.length > 0) return reportUnusable(problems, versionFile, packageVersion);
  if (versionFile.value !== `v${packageVersion.value}`) return reportMismatch(versionFile, packageVersion);
  console.log(
    `版本载体一致：${versionFile.value}（仓库根 VERSION 与 frontend/package.json:version 同一条版本线；` +
      `载体根 ${carrierRoot}）`,
  );
  return 0;
}

process.exit(main());
