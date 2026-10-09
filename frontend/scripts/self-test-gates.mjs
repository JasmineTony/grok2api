#!/usr/bin/env node
/**
 * 门禁自测（AGENTS.md DEV-4）。
 *
 * 一个不会失败的门禁等于没有门禁。本脚本用临时装置验证：
 *  - check-structure：新增超限文件 / 超限函数继续增大 / 缺少基线 → 非零退出
 *  - check-bundle-budget：首屏闭包超限 / 路由新增闭包超限 / 无法识别路由 / 相对基线增长 → 非零退出
 * 并通过「阈值放宽」与「符合基线」两组反例，确认门禁不是无条件失败。
 *
 * 装置全部建立在系统临时目录，不写入仓库；路径通过环境变量注入被测脚本。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptsDir, "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok2api-gate-selftest-"));

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function commentLines(count, label) {
  const rows = [];
  for (let index = 0; index < count; index += 1) rows.push(`// ${label} ${index + 1}`);
  return `${rows.join("\n")}\n`;
}

function relativeKey(file) {
  return path.relative(frontendDir, file).replaceAll("\\", "/");
}

function runGate(script, env) {
  const result = spawnSync(process.execPath, [path.join(scriptsDir, script)], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function budgetConfig(thresholds, baseline = null) {
  return `${JSON.stringify(
    {
      note: "门禁自测装置",
      thresholds: {
        initialJsGzipKiB: 260,
        routeIncrementGzipKiB: 180,
        allJsGzipKiB: 650,
        allCssGzipKiB: 20,
        maxChunkRawKiB: 500,
        ...thresholds,
      },
      growthTolerancePercent: 5,
      baseline,
    },
    null,
    2,
  )}\n`;
}

// ---- 结构门禁装置 ----
const structureSrc = path.join(root, "structure-src");
const structureFile = path.join(structureSrc, "oversized.ts");
writeFile(structureFile, commentLines(700, "structure probe"));
const structureKey = relativeKey(structureFile);
const emptyBaseline = path.join(root, "structure-baseline-empty.json");
const matchingBaseline = path.join(root, "structure-baseline-match.json");
const grownBaseline = path.join(root, "structure-baseline-grown.json");
writeFile(emptyBaseline, `${JSON.stringify({ files: {}, functions: {} })}\n`);
writeFile(matchingBaseline, `${JSON.stringify({ files: { [structureKey]: 700 }, functions: {} })}\n`);
writeFile(grownBaseline, `${JSON.stringify({ files: { [structureKey]: 690 }, functions: {} })}\n`);
const missingBaseline = path.join(root, "does-not-exist.json");

// ---- 体积预算装置 ----
const distDir = path.join(root, "dist");
const assetsDir = path.join(distDir, "assets");
writeFile(
  path.join(distDir, "index.html"),
  '<!doctype html><html><head><script type="module" src="/assets/entry.js"></script></head><body></body></html>\n',
);
writeFile(path.join(assetsDir, "shared.js"), `export const shared = "${"s".repeat(4096)}";\n`);
writeFile(
  path.join(assetsDir, "entry.js"),
  'import { shared } from "./shared.js";\nvoid import(`./route.js`);\nconsole.log(shared);\n',
);
writeFile(path.join(assetsDir, "route.js"), `export const route = "${"r".repeat(400 * 1024)}";\n`);
const distWithoutRoutes = path.join(root, "dist-no-routes");
writeFile(path.join(distWithoutRoutes, "assets", "shared.js"), `export const shared = "x";\n`);
writeFile(
  path.join(distWithoutRoutes, "index.html"),
  '<!doctype html><html><head><script type="module" src="/assets/entry.js"></script></head><body></body></html>\n',
);
writeFile(
  path.join(distWithoutRoutes, "assets", "entry.js"),
  'import { shared } from "./shared.js";\nconsole.log(shared);\n',
);

const budgetOk = path.join(root, "budget-ok.json");
const budgetTightInitial = path.join(root, "budget-tight-initial.json");
const budgetTightRoute = path.join(root, "budget-tight-route.json");
const budgetGrowth = path.join(root, "budget-growth.json");
writeFile(budgetOk, budgetConfig({}));
writeFile(budgetTightInitial, budgetConfig({ initialJsGzipKiB: 0 }));
writeFile(budgetTightRoute, budgetConfig({ routeIncrementGzipKiB: 0 }));
writeFile(
  budgetGrowth,
  budgetConfig({}, { initialClosure: { gzipBytes: 1 }, allJs: { gzipBytes: 1 }, allCss: { gzipBytes: 1 } }),
);

const structureEnv = { STRUCTURE_SRC_DIR: structureSrc };
const budgetEnv = { BUDGET_DIST_DIR: distDir };

const cases = [
  {
    name: "结构：新增超限文件应失败",
    expect: 1,
    run: () => runGate("check-structure.mjs", { ...structureEnv, STRUCTURE_BASELINE_PATH: emptyBaseline }),
  },
  {
    name: "结构：与冻结基线一致应通过",
    expect: 0,
    run: () => runGate("check-structure.mjs", { ...structureEnv, STRUCTURE_BASELINE_PATH: matchingBaseline }),
  },
  {
    name: "结构：超限文件继续增大应失败",
    expect: 1,
    run: () => runGate("check-structure.mjs", { ...structureEnv, STRUCTURE_BASELINE_PATH: grownBaseline }),
  },
  {
    name: "结构：缺少基线文件应报错退出",
    expect: 2,
    run: () => runGate("check-structure.mjs", { ...structureEnv, STRUCTURE_BASELINE_PATH: missingBaseline }),
  },
  {
    name: "预算：阈值宽松应通过",
    expect: 0,
    run: () => runGate("check-bundle-budget.mjs", { ...budgetEnv, BUDGET_CONFIG_PATH: budgetOk }),
  },
  {
    name: "预算：首屏闭包超限应失败",
    expect: 1,
    run: () => runGate("check-bundle-budget.mjs", { ...budgetEnv, BUDGET_CONFIG_PATH: budgetTightInitial }),
  },
  {
    name: "预算：路由新增闭包超限应失败",
    expect: 1,
    run: () => runGate("check-bundle-budget.mjs", { ...budgetEnv, BUDGET_CONFIG_PATH: budgetTightRoute }),
  },
  {
    name: "预算：相对基线增长超容差应失败",
    expect: 1,
    run: () => runGate("check-bundle-budget.mjs", { ...budgetEnv, BUDGET_CONFIG_PATH: budgetGrowth }),
  },
  {
    name: "预算：无法识别路由入口应失败",
    expect: 1,
    run: () =>
      runGate("check-bundle-budget.mjs", {
        BUDGET_DIST_DIR: distWithoutRoutes,
        BUDGET_CONFIG_PATH: budgetOk,
      }),
  },
];

function main() {
  const failures = [];
  try {
    for (const testCase of cases) {
      const { status, output } = testCase.run();
      if (status === testCase.expect) {
        console.log(`  ✓ ${testCase.name}（exit ${status}）`);
        continue;
      }
      failures.push(`${testCase.name}：期望 exit ${testCase.expect}，实际 ${status}\n${output.trim()}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\n门禁自测失败 ${failures.length} 项：`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`门禁自测通过：${cases.length} 个用例（含 ${cases.length - 5} 个必须失败的用例）。`);
}

main();
