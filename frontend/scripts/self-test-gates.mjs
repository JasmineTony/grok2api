#!/usr/bin/env node
/**
 * 门禁自测（AGENTS.md DEV-4）。
 *
 * 一个不会失败的门禁等于没有门禁。本脚本用临时装置验证：
 *  - check-structure：新增超限文件 / 超限函数继续增大 / 新增嵌套越限函数 / 缺少基线 → 非零退出；
 *    并覆盖 REV-3 作用域归属（匿名内联回调归属最近外层具名作用域、类构造函数独立作用域、
 *    具名嵌套函数重置为独立作用域）与输出中的键名、深度断言。
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

// ---- 嵌套深度（REV-3）装置 ----
const nestingSrc = path.join(root, "nesting-src");
const nestingFile = path.join(nestingSrc, "deep-nesting.ts");
writeFile(
  nestingFile,
  [
    "export function deeplyNested(value: number): number {",
    "  if (value > 0) {",
    "    for (const item of [value]) {",
    "      while (item > 0) {",
    "        try {",
    "          return item;",
    "        } catch {",
    "          return 0;",
    "        }",
    "      }",
    "    }",
    "  }",
    "  return value;",
    "}",
    "",
  ].join("\n"),
);
const nestingKey = `${relativeKey(nestingFile)}#deeplyNested`;
const nestingEmptyBaseline = path.join(root, "structure-baseline-nesting-empty.json");
const nestingMatchingBaseline = path.join(root, "structure-baseline-nesting-match.json");
const nestingFrozenBaseline = path.join(root, "structure-baseline-nesting-frozen.json");
writeFile(nestingEmptyBaseline, `${JSON.stringify({ files: {}, functions: {}, nesting: {} })}\n`);
writeFile(nestingMatchingBaseline, `${JSON.stringify({ files: {}, functions: {}, nesting: { [nestingKey]: 4 } })}\n`);
writeFile(nestingFrozenBaseline, `${JSON.stringify({ files: {}, functions: {}, nesting: { [nestingKey]: 5 } })}\n`);
const nestingEnv = { STRUCTURE_SRC_DIR: nestingSrc };

// ---- REV-3 作用域归属装置（F2 匿名回调 / F4 构造函数 / F3 具名嵌套重置）----
// 三个装置各占独立源码目录，避免彼此的超限项互相干扰。
const anonymousCallbackSrc = path.join(root, "rev3-anonymous-callback-src");
const anonymousCallbackFile = path.join(anonymousCallbackSrc, "anonymous-callback.ts");
writeFile(
  anonymousCallbackFile,
  [
    "export function Component({ items }: { items: number[] }): number {",
    "  return items.map((item) => {",
    "    if (item > 0) {",
    "      for (const other of items) {",
    "        try {",
    "          if (other > item) return other;",
    "        } catch {",
    "          return item;",
    "        }",
    "      }",
    "    }",
    "    return item;",
    "  });",
    "}",
    "",
  ].join("\n"),
);
const anonymousCallbackKey = `${relativeKey(anonymousCallbackFile)}#Component`;

const constructorSrc = path.join(root, "rev3-constructor-src");
const constructorFile = path.join(constructorSrc, "module-constructor.ts");
writeFile(
  constructorFile,
  [
    "class ModuleLevelProbe {",
    "  constructor(value: number) {",
    "    if (value > 0) {",
    "      for (const item of [value]) {",
    "        try {",
    "          if (item > 0) return;",
    "        } catch {",
    "          return;",
    "        }",
    "      }",
    "    }",
    "  }",
    "}",
    "",
    "void ModuleLevelProbe;",
    "",
  ].join("\n"),
);
const constructorKey = `${relativeKey(constructorFile)}#ModuleLevelProbe.constructor`;

const namedResetSrc = path.join(root, "rev3-named-reset-src");
const namedResetFile = path.join(namedResetSrc, "named-reset.ts");
writeFile(
  namedResetFile,
  [
    "export function outerScopeProbe(value: number): number {",
    "  if (value > 0) {",
    "    for (const item of [value]) {",
    "      while (item > 0) {",
    "        function innerScopeProbe(input: number): number {",
    "          if (input > 0) {",
    "            return input;",
    "          }",
    "          return 0;",
    "        }",
    "        return innerScopeProbe(item);",
    "      }",
    "    }",
    "  }",
    "  return value;",
    "}",
    "",
  ].join("\n"),
);
// 具名嵌套函数重置为独立作用域：外层自身 3 层、内层自身 1 层，均不越限（若内层继承外层深度则为 4 层并报出）。
const namedResetEnv = { STRUCTURE_SRC_DIR: namedResetSrc, STRUCTURE_BASELINE_PATH: nestingEmptyBaseline };
const anonymousCallbackEnv = { STRUCTURE_SRC_DIR: anonymousCallbackSrc, STRUCTURE_BASELINE_PATH: nestingEmptyBaseline };
const constructorEnv = { STRUCTURE_SRC_DIR: constructorSrc, STRUCTURE_BASELINE_PATH: nestingEmptyBaseline };

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
    contains: ["参与判定的作用域（REV-3）：1 个"],
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
    name: "结构：新增嵌套越限函数应失败",
    expect: 1,
    run: () => runGate("check-structure.mjs", { ...nestingEnv, STRUCTURE_BASELINE_PATH: nestingEmptyBaseline }),
  },
  {
    name: "结构：嵌套深度与冻结基线一致应通过",
    expect: 0,
    run: () => runGate("check-structure.mjs", { ...nestingEnv, STRUCTURE_BASELINE_PATH: nestingMatchingBaseline }),
  },
  {
    name: "结构：嵌套深度已整改应通过",
    expect: 0,
    run: () => runGate("check-structure.mjs", { ...nestingEnv, STRUCTURE_BASELINE_PATH: nestingFrozenBaseline }),
  },
  {
    name: "结构：匿名内联回调内 4 层嵌套应失败（F2 作用域归属）",
    expect: 1,
    contains: [`${anonymousCallbackKey} = 4 层`, "参与判定的作用域（REV-3）：2 个"],
    run: () => runGate("check-structure.mjs", anonymousCallbackEnv),
  },
  {
    name: "结构：模块级类构造函数内 4 层嵌套应失败（F4 构造函数作用域）",
    expect: 1,
    contains: [`${constructorKey} = 4 层`],
    run: () => runGate("check-structure.mjs", constructorEnv),
  },
  {
    name: "结构：具名嵌套函数重置为独立作用域应通过（F3）",
    expect: 0,
    absent: ["outerScopeProbe", "innerScopeProbe"],
    run: () => runGate("check-structure.mjs", namedResetEnv),
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

/** 校验单个用例：先比退出码，再校验输出必须包含 / 不得包含的片段；通过返回 null。 */
function checkCase(testCase, status, output) {
  if (status !== testCase.expect) return `期望 exit ${testCase.expect}，实际 ${status}\n${output.trim()}`;
  for (const fragment of testCase.contains ?? []) {
    if (!output.includes(fragment)) return `输出未包含 ${fragment}\n${output.trim()}`;
  }
  for (const fragment of testCase.absent ?? []) {
    if (output.includes(fragment)) return `输出不应包含 ${fragment}\n${output.trim()}`;
  }
  return null;
}

function main() {
  const failures = [];
  try {
    for (const testCase of cases) {
      const { status, output } = testCase.run();
      const problem = checkCase(testCase, status, output);
      if (problem === null) {
        console.log(`  ✓ ${testCase.name}（exit ${status}）`);
        continue;
      }
      failures.push(`${testCase.name}：${problem}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\n门禁自测失败 ${failures.length} 项：`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  const expectedFailures = cases.filter((testCase) => testCase.expect !== 0).length;
  console.log(`门禁自测通过：${cases.length} 个用例（含 ${expectedFailures} 个必须失败的用例）。`);
}

main();
