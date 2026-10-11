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
 *  - check-test-results：清单文件缺失 / 通过数低于棘轮 / 必填用例标题缺失或未通过 / 报告文件总数低于棘轮 /
 *    出现未登记跳过 / E2E 存在 flaky / 报告早于清单文件 mtime / 报告缺失 → 非零退出；并以健康报告（含 E2E
 *    三种 file 形态：报告自带 `config.rootDir` + 纯文件名、绝对路径、缺 `config.rootDir`）与「缺 startTime 时
 *    改用报告文件 mtime 兜底」两组反例，确认门禁既不是无条件失败，也不会静默跳过新鲜度检查。
 *
 * 装置全部建立在系统临时目录，不写入仓库；路径通过环境变量注入被测脚本。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

// 门禁自测通过 ESLint CLI 同步校验最小样本：
// 覆盖「Node 环境配置生效」与「导出返回类型约束生效」两组正反例，
// 使 DEV-2/FQ-01/FQ-02 的规则存在性有可失败证据，而不是只读配置。
function runLint(filePath, source) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(frontendDir, "node_modules", "eslint", "bin", "eslint.js"),
      "--stdin",
      "--stdin-filename",
      filePath,
      "--format",
      "json",
    ],
    { cwd: frontendDir, input: source, encoding: "utf8" },
  );
  const parsed = JSON.parse(result.stdout);
  return {
    status: parsed.some((item) => item.errorCount > 0) ? 1 : 0,
    output: parsed
      .flatMap((item) => item.messages.map((message) => `${message.ruleId}: ${message.message}`))
      .join("\n"),
  };
}
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

function runGate(script, env, args = []) {
  const result = spawnSync(process.execPath, [path.join(scriptsDir, script), ...args], {
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

// ---- 测试执行性门禁装置（check-test-results.mjs：TEST-3 / TEST-5 / EVID-1）----
// 报告与清单文件都写在临时目录，用 TEST_REPORT_ROOT 注入（该变量仅供自测使用），
// 既不读取也不覆盖仓库内 .artifacts 的真实报告。下面的用例数、必填标题与文件总数按被测脚本的棘轮值构造
// （minPassed / requiredTitles / MIN_VITEST_FILES / MIN_E2E_FILES），棘轮调整时必须同步更新，否则正样本会失败。
const probeNow = Date.now();
const freshInputMs = probeNow - 60_000;
const staleMs = probeNow - 3_600_000;
/** 必填标题逐字取自真实测试文件，与被测脚本的 REQUIRED_VITEST.requiredTitles 保持一致。 */
const vitestProbe = [
  {
    file: "src/features/auth/login-page.test.tsx",
    passed: 11,
    titles: [
      "提供稳定定位、可访问名称、密码管理器语义与键盘顺序",
      "错误凭据显示真实 API 本地化错误、聚焦密码，修正后可以重试",
      "请求中禁用提交，双击、再次点击和密码框 Enter 均不产生重复登录",
      "键盘与粘贴登录保留密码原文，真实解码更新身份和令牌，并替换登录历史",
    ],
  },
  {
    file: "src/app/deferred-pages.test.tsx",
    passed: 13,
    titles: ["StrictMode 双挂载下懒加载仍解析成功，卸载后不残留页面"],
  },
  {
    file: "src/app/deferred-pages-loading.test.tsx",
    passed: 7,
    titles: ["StrictMode 首次挂载、重渲染及重新挂载均复用加载结果，卸载不残留页面"],
  },
];
/** 必填标题逐字取自真实 spec，与被测脚本的 REQUIRED_E2E.requiredTitles 保持一致。 */
const e2eProbe = [
  {
    file: "e2e/auth.e2e.ts",
    passed: 6,
    titles: [
      "未登录访问受保护路由会被重定向到登录页",
      "正确凭据登录成功、进入受保护页面并在刷新后保持登录",
      "空账号池下推理未就绪，但健康检查与管理 API 可用",
    ],
  },
  {
    file: "e2e/client-keys.e2e.ts",
    passed: 4,
    titles: ["创建密钥：表单校验失败后成功创建并展示一次性明文", "删除密钥：确认后行与真实服务端记录同时消失"],
  },
  {
    file: "e2e/navigation.e2e.ts",
    passed: 5,
    titles: [
      "侧栏导航到账号和设置，深链接刷新后保持页面与当前导航状态",
      "账号菜单切换英文和中文，导航与刷新后仍使用所选语言",
      "375px 登录页与横屏无横向溢出，Tab 和 Enter 可完成真实登录",
    ],
  },
  {
    file: "e2e/request-audits.e2e.ts",
    passed: 3,
    titles: ["状态筛选改变真实查询范围并显示激活计数，清除后恢复空态"],
  },
  {
    file: "e2e/settings.e2e.ts",
    passed: 3,
    titles: ["设置页分页可切换：Grok Build 与 Grok Web 面板按标签显隐"],
  },
];
/** 被测脚本的必需文件总数棘轮；用只含 1 个通过用例的填充文件补足，正样本在真实下限上通过。 */
const MIN_VITEST_PROBE_FILES = 123;
function padVitestEntries(entries, target = MIN_VITEST_PROBE_FILES) {
  const padded = entries.map((entry) => entry);
  for (let index = padded.length; index < target; index += 1) {
    padded.push({ file: `src/shared/gate-fixture-${index + 1}.test.tsx`, passed: 1 });
  }
  return padded;
}
const vitestHealthyEntries = padVitestEntries(vitestProbe);
const vitestHealthyTotal = vitestHealthyEntries.reduce((total, entry) => total + entry.passed, 0);
const e2eProbeTotal = e2eProbe.reduce((total, entry) => total + entry.passed, 0);
/** 一支用例重试后才通过：其余计数不变，用于验证 flaky 不被计入通过。 */
const e2eProbeFlaky = e2eProbe.map((entry, index) => (index === 0 ? { ...entry, flaky: 1 } : entry));
const vitestBelowRatchet = vitestProbe.map((entry, index) =>
  index === 0 ? { ...entry, passed: entry.passed - 1 } : entry,
);
/** 必填标题被删除（换成普通通过用例，计数不变），用于验证标题断言独立于通过数棘轮。 */
const vitestMissingTitle = vitestProbe.map((entry, index) => (index === 1 ? { ...entry, titles: [] } : entry));
/** 必填标题存在但状态为 failed，用于验证「必须为 passed」而不只是「存在于报告」。 */
const vitestFailedTitle = vitestProbe.map((entry, index) =>
  index === 1 ? { ...entry, titles: [], failedTitles: entry.titles, failed: 1 } : entry,
);

/** 写文件并固定 mtime，使新鲜度判定与写入顺序无关。 */
function writeProbeFile(file, content, mtimeMs) {
  writeFile(file, content);
  fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
}

function statusAssertions(file, status, count) {
  return Array.from({ length: count }, (_, index) => ({ fullName: `${file} ${status} #${index + 1}`, status }));
}

/** Vitest JSON：startMs 为 undefined 时故意省略 startTime，用于验证报告文件 mtime 兜底分支。 */
function vitestJson(rootDir, entries, startMs) {
  return `${JSON.stringify({
    startTime: startMs,
    testResults: entries.map((entry) => ({
      name: path.join(rootDir, entry.file),
      status: "passed",
      assertionResults: [
        ...(entry.titles ?? []).map((title) => ({ fullName: `装置用例 ${title}`, status: "passed" })),
        ...(entry.failedTitles ?? []).map((title) => ({ fullName: `装置用例 ${title}`, status: "failed" })),
        ...statusAssertions(entry.file, "passed", entry.passed - (entry.titles ?? []).length),
        ...statusAssertions(entry.file, "failed", (entry.failed ?? 0) - (entry.failedTitles ?? []).length),
        ...statusAssertions(entry.file, "skipped", entry.skipped ?? 0),
      ],
    })),
  })}\n`;
}

/**
 * Playwright JSON：与真实产物一致——`config.rootDir` 指向 e2e 目录，suite/spec 的 `file` 是相对 rootDir 的
 * 纯文件名（`auth.e2e.ts`）；`shape` 用于构造绝对路径形态与缺 rootDir 形态。
 */
function playwrightJson(entries, startMs, shape) {
  const specOf = (file, status, index, expectedStatus = "passed") => ({
    title: `${file} ${status} #${index + 1}`,
    file,
    tests: [{ status, expectedStatus }],
  });
  const suitesOf = (entry) => {
    const file = shape.fileOf(entry.file);
    const named = (entry.titles ?? []).length;
    const expectedFailure = entry.expectedFailure ?? 0;
    const unknownStatus = entry.unknownStatus ?? 0;
    return {
      title: entry.file,
      file,
      suites: [],
      specs: [
        ...(entry.titles ?? []).map((title) => ({
          title,
          file,
          tests: [{ status: "expected", expectedStatus: "passed" }],
        })),
        ...Array.from({ length: Math.max(entry.passed - named - expectedFailure - unknownStatus, 0) }, (_, index) =>
          specOf(file, "expected", index),
        ),
        ...Array.from({ length: expectedFailure }, (_, index) => specOf(file, "expected", index, "failed")),
        ...Array.from({ length: unknownStatus }, (_, index) => specOf(file, "weird", index)),
        ...Array.from({ length: entry.flaky ?? 0 }, (_, index) => specOf(file, "flaky", index)),
        ...Array.from({ length: entry.skipped ?? 0 }, (_, index) => specOf(file, "skipped", index)),
      ],
    };
  };
  return `${JSON.stringify({
    config: shape.rootDir === null ? {} : { rootDir: shape.rootDir },
    errors: [],
    stats: {
      startTime: new Date(startMs).toISOString(),
      duration: 1000,
      expected: 0,
      unexpected: 0,
      flaky: 0,
      skipped: 0,
    },
    suites: entries.map(suitesOf),
  })}\n`;
}

/** 建一个报告根目录：写清单文件（mtime 固定）与可选的两份报告。 */
function buildReportRoot(name, options) {
  const dir = path.join(root, name);
  for (const entry of [...(options.vitest ?? []), ...(options.e2e ?? [])]) {
    writeProbeFile(path.join(dir, entry.file), `// ${entry.file} 装置\n`, freshInputMs);
  }
  const reportMtimeMs = options.reportMtimeMs ?? probeNow;
  if (options.vitest !== undefined) {
    writeProbeFile(
      path.join(dir, ".artifacts", "vitest", "results.json"),
      vitestJson(dir, options.vitest, options.vitestStartMs),
      reportMtimeMs,
    );
  }
  if (options.e2e !== undefined) {
    writeProbeFile(
      path.join(dir, ".artifacts", "playwright", "results.json"),
      playwrightJson(options.e2e, options.e2eStartMs, e2eShapeOf(dir, options)),
      reportMtimeMs,
    );
  }
  return dir;
}

/**
 * E2E 报告的 file 形态：默认与真实产物一致（file 是纯文件名 + `config.rootDir` 指向 <dir>/e2e）；
 * e2eAbsoluteShape 构造绝对路径形态，e2eWithoutRootDir 构造缺 `config.rootDir` 的形态。
 */
function e2eShapeOf(dir, options) {
  if (options.e2eAbsoluteShape) return { rootDir: null, fileOf: (file) => path.join(dir, file) };
  if (options.e2eWithoutRootDir) return { rootDir: null, fileOf: (file) => path.basename(file) };
  return { rootDir: path.join(dir, "e2e"), fileOf: (file) => path.basename(file) };
}

const healthyReportRoot = buildReportRoot("report-healthy", {
  vitest: vitestHealthyEntries,
  vitestStartMs: probeNow,
  e2e: e2eProbe,
  e2eStartMs: probeNow,
});
const missingEntryReportRoot = buildReportRoot("report-missing-entry", {
  vitest: padVitestEntries(vitestProbe.filter((entry) => !entry.file.includes("login-page"))),
  vitestStartMs: probeNow,
});
const belowRatchetReportRoot = buildReportRoot("report-below-ratchet", {
  vitest: padVitestEntries(vitestBelowRatchet),
  vitestStartMs: probeNow,
});
const missingTitleReportRoot = buildReportRoot("report-missing-title", {
  vitest: padVitestEntries(vitestMissingTitle),
  vitestStartMs: probeNow,
});
const failedTitleReportRoot = buildReportRoot("report-failed-title", {
  vitest: padVitestEntries(vitestFailedTitle),
  vitestStartMs: probeNow,
});
const belowMinFilesReportRoot = buildReportRoot("report-below-min-files", {
  vitest: padVitestEntries(vitestProbe, MIN_VITEST_PROBE_FILES - 1),
  vitestStartMs: probeNow,
});
const skippedReportRoot = buildReportRoot("report-skipped", {
  vitest: padVitestEntries(vitestProbe.map((entry, index) => (index === 0 ? { ...entry, skipped: 1 } : entry))),
  vitestStartMs: probeNow,
});
const staleReportRoot = buildReportRoot("report-stale", { vitest: vitestHealthyEntries, vitestStartMs: staleMs });
const noTimestampReportRoot = buildReportRoot("report-no-timestamp", {
  vitest: vitestHealthyEntries,
  vitestStartMs: undefined,
  reportMtimeMs: staleMs,
});
const staleE2eReportRoot = buildReportRoot("report-stale-e2e", {
  vitest: vitestHealthyEntries,
  vitestStartMs: probeNow,
  e2e: e2eProbe,
  e2eStartMs: staleMs,
});
const flakyE2eReportRoot = buildReportRoot("report-flaky-e2e", {
  vitest: vitestHealthyEntries,
  vitestStartMs: probeNow,
  e2e: e2eProbeFlaky,
  e2eStartMs: probeNow,
});
const missingTitleE2eReportRoot = buildReportRoot("report-missing-title-e2e", {
  vitest: vitestHealthyEntries,
  vitestStartMs: probeNow,
  e2e: e2eProbe.map((entry, index) => (index === 4 ? { ...entry, titles: [] } : entry)),
  e2eStartMs: probeNow,
});
const belowMinFilesE2eReportRoot = buildReportRoot("report-below-min-files-e2e", {
  vitest: vitestHealthyEntries,
  vitestStartMs: probeNow,
  e2e: e2eProbe.filter((entry) => entry.file !== "e2e/settings.e2e.ts"),
  e2eStartMs: probeNow,
});
const absoluteE2eReportRoot = buildReportRoot("report-absolute-e2e", {
  vitest: vitestHealthyEntries,
  vitestStartMs: probeNow,
  e2e: e2eProbe,
  e2eStartMs: probeNow,
  e2eAbsoluteShape: true,
});
const noRootDirE2eReportRoot = buildReportRoot("report-no-rootdir-e2e", {
  vitest: vitestHealthyEntries,
  vitestStartMs: probeNow,
  e2e: e2eProbe,
  e2eStartMs: probeNow,
  e2eWithoutRootDir: true,
});
/** 夹具：首个 E2E 文件含一个 test.fail() 预期失败用例（status="expected" + expectedStatus="failed"）。 */
const expectedFailureE2eEntries = e2eProbe.map((entry, index) =>
  index === 0 ? { ...entry, passed: entry.passed - 1, expectedFailure: 1 } : entry,
);
const expectedFailureE2eReportRoot = buildReportRoot("report-e2e-expected-failure", {
  vitest: vitestHealthyEntries,
  vitestStartMs: probeNow,
  e2e: expectedFailureE2eEntries,
  e2eStartMs: probeNow,
});
/** 夹具：首个 E2E 文件含一个未知状态用例（既非 expected/unexpected/flaky/skipped）。 */
const unknownStatusE2eEntries = e2eProbe.map((entry, index) =>
  index === 0 ? { ...entry, passed: entry.passed - 1, unknownStatus: 1 } : entry,
);
const unknownStatusE2eReportRoot = buildReportRoot("report-e2e-unknown-status", {
  vitest: vitestHealthyEntries,
  vitestStartMs: probeNow,
  e2e: unknownStatusE2eEntries,
  e2eStartMs: probeNow,
});
/** 夹具：只写报告、不写清单文件——新鲜度无法核对时旧报告不得放行。 */
const absentFilesReportRoot = path.join(root, "report-absent-files");
writeProbeFile(
  path.join(absentFilesReportRoot, ".artifacts", "vitest", "results.json"),
  vitestJson(absentFilesReportRoot, vitestHealthyEntries, staleMs),
  probeNow,
);
const missingReportRoot = path.join(root, "report-missing");

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
  {
    name: "Lint：Node 脚本未定义变量应失败（FQ-01 负样本）",
    expect: 1,
    contains: ["no-undef"],
    run: () => runLint("scripts/lint-contract-probe.mjs", "missingGateInput();"),
  },
  {
    name: "Lint：Node 脚本使用 Node 全局应通过（FQ-01 正样本）",
    expect: 0,
    run: () => runLint("scripts/lint-contract-probe.mjs", "console.log(process.platform);"),
  },
  {
    name: "Lint：Node 脚本误用浏览器全局应失败（环境边界）",
    expect: 1,
    contains: ["no-undef"],
    run: () => runLint("scripts/lint-contract-probe.mjs", "document.querySelector('body');"),
  },
  {
    name: "Lint：导出函数遗漏返回类型应失败（FQ-02 负样本）",
    expect: 1,
    contains: ["@typescript-eslint/explicit-module-boundary-types"],
    run: () => runLint("scripts/lint-contract-probe.ts", "export function gateValue() { return 1; }"),
  },
  {
    name: "Lint：显式导出契约应通过（FQ-02 正样本）",
    expect: 0,
    run: () => runLint("scripts/lint-contract-probe.ts", "export function gateValue(): number { return 1; }"),
  },
  {
    name: "Lint：显式 any 应失败（DEV-2 负样本）",
    expect: 1,
    contains: ["@typescript-eslint/no-explicit-any"],
    run: () =>
      runLint("scripts/lint-contract-probe.ts", "export function gateValue(input: any): number { return input; }"),
  },
  {
    name: "测试执行：Vitest 健康报告应通过（清单齐 / 必填标题齐 / 达棘轮 / 文件总数达标 / 时间戳新）",
    expect: 0,
    contains: [
      "必需前端场景执行门禁通过",
      `Vitest 报告：参与判定的文件 ${vitestHealthyEntries.length} 个、用例 ${vitestHealthyTotal} 个`,
    ],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: healthyReportRoot }),
  },
  {
    name: "测试执行：必需文件未出现在报告中应失败",
    expect: 1,
    contains: ["必需文件未出现在报告中 src/features/auth/login-page.test.tsx"],
    absent: ["报告可能过期"],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: missingEntryReportRoot }),
  },
  {
    name: "测试执行：通过数低于棘轮应失败",
    expect: 1,
    contains: [
      `src/features/auth/login-page.test.tsx 通过 ${vitestBelowRatchet[0].passed} 个，少于要求的 ${vitestProbe[0].passed} 个`,
    ],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: belowRatchetReportRoot }),
  },
  {
    name: "测试执行：必需文件出现未登记跳过应失败",
    expect: 1,
    contains: ["存在未登记跳过用例"],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: skippedReportRoot }),
  },
  {
    name: "测试执行：报告早于清单文件 mtime 应失败（过期报告）",
    expect: 1,
    contains: ["报告可能过期", "请重新运行：pnpm test:ui:coverage"],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: staleReportRoot }),
  },
  {
    name: "测试执行：报告缺 startTime 时改用报告文件 mtime 兜底且仍能判过期",
    expect: 1,
    contains: ["mtime 兜底", "报告可能过期"],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: noTimestampReportRoot }),
  },
  {
    name: "测试执行：报告文件缺失应报错退出",
    expect: 2,
    contains: ["缺少测试报告 .artifacts/vitest/results.json"],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: missingReportRoot }),
  },
  {
    name: "测试执行：E2E 健康报告应通过（ISO 时间戳 + 清单齐）",
    expect: 0,
    contains: [`E2E 报告：参与判定的文件 ${e2eProbe.length} 个、用例 ${e2eProbeTotal} 个`],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: healthyReportRoot }, ["--e2e"]),
  },
  {
    name: "测试执行：E2E 报告早于清单文件 mtime 应失败",
    expect: 1,
    contains: ["E2E：报告可能过期"],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: staleE2eReportRoot }, ["--e2e"]),
  },
  {
    name: "测试执行：E2E 报告 file 为绝对路径应通过（无 config.rootDir）",
    expect: 0,
    contains: [`E2E 报告：参与判定的文件 ${e2eProbe.length} 个、用例 ${e2eProbeTotal} 个`],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: absoluteE2eReportRoot }, ["--e2e"]),
  },
  {
    name: "测试执行：E2E 报告缺 config.rootDir 时按 <root>/e2e 归一应通过",
    expect: 0,
    contains: [`E2E 报告：参与判定的文件 ${e2eProbe.length} 个、用例 ${e2eProbeTotal} 个`],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: noRootDirE2eReportRoot }, ["--e2e"]),
  },
  {
    name: "测试执行：E2E 存在 flaky 用例应失败（重试不得掩盖缺陷）",
    expect: 1,
    contains: ["重试后才通过（flaky）", "flaky：重试后才通过"],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: flakyE2eReportRoot }, ["--e2e"]),
  },
  {
    name: "测试执行：必需用例标题缺失应失败（通过数不变也不能放行）",
    expect: 1,
    contains: ["必填用例「StrictMode 双挂载下懒加载仍解析成功，卸载后不残留页面」不在报告中（被删除、改名或未运行）"],
    absent: ["少于要求的"],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: missingTitleReportRoot }),
  },
  {
    name: "测试执行：必需用例标题存在但未通过应失败（必须为 passed）",
    expect: 1,
    contains: ["必填用例「StrictMode 双挂载下懒加载仍解析成功，卸载后不残留页面」未通过："],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: failedTitleReportRoot }),
  },
  {
    name: "测试执行：报告文件总数低于棘轮应失败（防删文件绕过）",
    expect: 1,
    contains: ["Vitest：报告只含 122 个文件，少于要求的 123 个（测试文件被删除或未运行）"],
    absent: ["必需文件未出现在报告中"],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: belowMinFilesReportRoot }),
  },
  {
    name: "测试执行：E2E 必需用例标题缺失应失败",
    expect: 1,
    contains: [
      "E2E：e2e/settings.e2e.ts 必填用例「设置页分页可切换：Grok Build 与 Grok Web 面板按标签显隐」不在报告中",
    ],
    absent: ["少于要求的"],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: missingTitleE2eReportRoot }, ["--e2e"]),
  },
  {
    name: "测试执行：E2E 必需文件总数低于棘轮应失败",
    expect: 1,
    contains: [
      "E2E：报告只含 4 个文件，少于要求的 5 个（测试文件被删除或未运行）",
      "E2E：必需文件未出现在报告中 e2e/settings.e2e.ts",
    ],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: belowMinFilesE2eReportRoot }, ["--e2e"]),
  },
  {
    name: "测试执行：E2E 用例被标记为 test.fail() 预期失败应失败（不得掩盖断言）",
    expect: 1,
    contains: ["被标记为预期失败 test.fail()，不得用于必需场景", "E2E：e2e/auth.e2e.ts 有 1 个失败用例"],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: expectedFailureE2eReportRoot }, ["--e2e"]),
  },
  {
    name: "测试执行：E2E 用例出现未知状态应失败（fail-closed）",
    expect: 1,
    contains: ["未知状态 weird，不得放行"],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: unknownStatusE2eReportRoot }, ["--e2e"]),
  },
  {
    name: "测试执行：清单文件全部不在磁盘时应失败（旧报告不得放行）",
    expect: 1,
    contains: ["清单文件全部不在磁盘上，无法核对报告新鲜度（旧报告不得放行）"],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: absentFilesReportRoot }),
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
