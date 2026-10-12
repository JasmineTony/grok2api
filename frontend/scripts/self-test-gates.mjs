#!/usr/bin/env node
/**
 * 门禁自测（AGENTS.md DEV-4）。
 *
 * 一个不会失败的门禁等于没有门禁。本脚本用临时装置验证：
 *  - check-structure：新增超限文件 / 超限函数继续增大 / 新增嵌套越限函数 / 缺少基线 → 非零退出；
 *    并覆盖 REV-3 作用域归属（匿名内联回调归属最近外层具名作用域、类构造函数独立作用域、
 *    具名嵌套函数重置为独立作用域）与输出中的键名、深度断言。
 *  - check-bundle-budget：首屏闭包超限 / 路由新增闭包超限 / 无法识别路由 / 相对基线增长 / dist 陈旧
 *    （清单输入指纹不一致 / 缺构建清单 / 产物被改写）→ 非零退出；并通过「阈值放宽」与「符合基线」两组
 *    反例确认门禁不是无条件失败，另用同一份合成 dist 断言首屏入口纳入非 `/assets/` 的同步脚本
 *    （旧正则漏算 `/runtime-config.js`）、且注释里的引用不计入。
 *  - check-test-results：清单文件缺失（部分缺失也算）/ 通过数低于棘轮 / 必填用例标题缺失或未通过 /
 *    报告文件总数低于棘轮 / 出现未登记跳过 / 文件级失效（Vitest 收集期失败、非清单文件整文件跳过）/
 *    移动 project 被移除后 E2E 实例数回落到桌面口径 / E2E 存在 flaky / 报告早于清单文件 mtime / 报告缺失 →
 *    非零退出；并以健康报告（含 E2E 三种 file 形态：报告自带 `config.rootDir` + 纯文件名、绝对路径、
 *    缺 `config.rootDir`）、「非清单文件部分跳过只告警」与「缺 startTime 时改用报告文件 mtime 兜底」三组反例，
 *    确认门禁既不是无条件失败，也不会静默跳过新鲜度检查。
 *  - check-node-test-results：node:test 报告缺失 / 清单文件被删除 / 必需文件未出现在报告中 / 整文件跳过
 *    （test.skip 与 describe.skip 两种形态）/ 清单文件部分跳过 / 用例失败 / 收集失败 / 清单外文件整文件跳过 /
 *    清单外文件有用例失败 / 清单外文件 0 用例（describe.skip 或用例被删）/
 *    NODE_TEST_REPORT_ROOT 指向 tmp 之外（exit 2）/ 报告早于清单文件 mtime / 缺 startedAt 走报告文件 mtime
 *    兜底 / 报告形状不可用 / 报告与 Node 汇总不自洽 / 磁盘多出未登记测试文件（集合必须与清单完全相等）→
 *    非零退出；并以健康报告、「清单外文件部分跳过只告警」两组反例确认门禁不是无条件失败，且每个负样本都按
 *    「只依赖退出码的旧判定会通过」构造（见 assertNodeTestExitCodeClean）。
 *
 * 装置全部建立在系统临时目录，不写入仓库；路径通过环境变量注入被测脚本。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

// 装置清单必须与门禁使用同一套指纹：直接引用产品代码（TS 由 Node 类型剥离加载），不另写一份指纹逻辑。
import { buildInputHash, writeBuildManifest } from "./build-inputs.ts";

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

/**
 * 子进程必须显式带上类型剥离 flag：被测门禁 scripts/check-bundle-budget.mjs 直接
 * `import ... from "./build-inputs.ts"`，而 Node 的类型剥离在 22.6–22.17 默认关闭
 * （package.json 的 engines 只声明 >=22，check:budget / test:gates 因此都在命令行上显式传该 flag）。
 * CLI flag 不会被 spawnSync 子进程继承，缺了它这些版本上子进程会以 ERR_UNKNOWN_FILE_EXTENSION 退出 1，
 * 让本脚本的断言假失败；已知 flag 的 Node 会照常接受，故对所有版本统一补上。
 */
const STRIP_TYPES_FLAG = "--experimental-strip-types";

function runGate(script, env, args = []) {
  // script 为绝对路径时直接执行（ALLOWED_SKIPS 正样本用 tmp 内的改写副本），否则按 scripts/ 下的脚本名解析。
  const target = path.isAbsolute(script) ? script : path.join(scriptsDir, script);
  const result = spawnSync(process.execPath, [STRIP_TYPES_FLAG, target, ...args], {
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
/**
 * 合成 index.html 覆盖三种引用形态：Vite 的 `/assets/` 模块入口、`public/` 原样拷贝的非 `/assets/`
 * 同步脚本（`/runtime-config.js`，D3 缺口）、只出现在 HTML 注释里的引用（不得计入）。
 */
const budgetIndexHtml = [
  "<!doctype html><html><head>",
  '<script src="/runtime-config.js"></script>',
  '<script type="module" src="/assets/entry.js"></script>',
  '<!-- <script src="/assets/commented-out.js"></script> -->',
  "</head><body></body></html>",
  "",
].join("\n");
writeFile(path.join(distDir, "index.html"), budgetIndexHtml);
writeFile(path.join(distDir, "runtime-config.js"), 'window.__RUNTIME_CONFIG__ = { apiBase: "" };\n');
writeFile(path.join(assetsDir, "shared.js"), `export const shared = "${"s".repeat(4096)}";\n`);
writeFile(
  path.join(assetsDir, "entry.js"),
  'import { shared } from "./shared.js";\nvoid import(`./route.js`);\nconsole.log(shared);\n',
);
writeFile(path.join(assetsDir, "route.js"), `export const route = "${"r".repeat(400 * 1024)}";\n`);
/** 只在注释里被引用：注释剥离失效时首屏闭包会多算一个文件，下面的计数与 gzip 断言即失败。 */
writeFile(path.join(assetsDir, "commented-out.js"), `export const commentedOut = "${"c".repeat(64)}";\n`);

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

/**
 * 装置 dist 必须带「与当前构建输入一致」的 `.build-manifest.json`：门禁读取 dist 前会调用
 * scripts/build-inputs.ts 的 isBuildFresh。这里用产品代码的 buildInputHash / writeBuildManifest 产出清单，
 * 不在自测里另写一套指纹，否则正样本只证明自测自洽。
 */
function writeFreshManifest(outDir) {
  writeBuildManifest(outDir, buildInputHash(frontendDir));
}
writeFreshManifest(distDir);
writeFreshManifest(distWithoutRoutes);

/** 陈旧夹具（F1）：清单记录的输入指纹与当前构建输入不一致（等价于改了构建输入未重新 build）。 */
const distStaleInput = path.join(root, "dist-stale-input");
fs.cpSync(distDir, distStaleInput, { recursive: true });
/** 陈旧夹具（F2）：完全没有构建清单——旧实现看不到任何新鲜度信息，`--update` 可把陈旧数字冻结进基线。 */
const distWithoutManifest = path.join(root, "dist-without-manifest");
fs.cpSync(distDir, distWithoutManifest, { recursive: true });
fs.rmSync(path.join(distWithoutManifest, ".build-manifest.json"));
/** 陈旧夹具（F3）：build 之后产物被改写（outputHash 与清单不一致）。 */
const distTamperedOutput = path.join(root, "dist-tampered-output");
fs.cpSync(distDir, distTamperedOutput, { recursive: true });
fs.appendFileSync(path.join(distTamperedOutput, "assets", "shared.js"), "// 被改写的产物\n");

/**
 * 夹具（P3-1）：同一标签重复出现 `src` —— HTML 规范首个生效。真实入口 `/runtime-config.js` 写在前面，
 * 后面跟一个真实存在的 decoy：`set()` 后写覆盖先写的旧实现只认 decoy，首屏闭包丢掉真实入口。
 */
const distDuplicateAttribute = path.join(root, "dist-duplicate-attribute");
fs.cpSync(distDir, distDuplicateAttribute, { recursive: true });
/**
 * 确定性伪随机负载（LCG）：gzip 几乎压不动。decoy 必须大到能撑破首屏阈值（460 KiB 原始 → ≈297 KiB
 * gzip > 260 KiB），判别力才不依赖「错误入口」与真实入口之间的字节小数位差异。
 */
function noisePayload(bytes) {
  let state = 20261012;
  let out = "";
  while (out.length < bytes) {
    state = (state * 1103515245 + 12345) % 2147483648;
    out += state.toString(36);
  }
  return out.slice(0, bytes);
}
writeFile(
  path.join(distDuplicateAttribute, "assets", "decoy.js"),
  `export const decoy = "${noisePayload(460 * 1024)}";\n`,
);
writeFile(
  path.join(distDuplicateAttribute, "index.html"),
  budgetIndexHtml.replace(
    '<script src="/runtime-config.js"></script>',
    '<script src="/runtime-config.js" src="/assets/decoy.js"></script>',
  ),
);
writeFreshManifest(distDuplicateAttribute);
if (
  !fs
    .readFileSync(path.join(distDuplicateAttribute, "index.html"), "utf8")
    .includes('<script src="/runtime-config.js" src="/assets/decoy.js"></script>')
) {
  throw new Error("自测装置失效：重复属性夹具未生成（index.html 锚点未命中）");
}

/**
 * 夹具（P3-2）：`<link rel="prefetch" href="/assets/prefetch-only.js">` 是空闲预取，不属于首屏闭包。
 * 目标文件真实存在且不被任何入口静态引用，且大到能撑破首屏阈值（460 KiB 原始 → ≈292 KiB gzip）：
 * 只看 href 不看 rel 的旧实现会把它算进首屏闭包（3 → 4 个文件、292.39 KiB）并直接超限失败。
 */
const distPrefetchLink = path.join(root, "dist-prefetch-link");
fs.cpSync(distDir, distPrefetchLink, { recursive: true });
writeFile(
  path.join(distPrefetchLink, "assets", "prefetch-only.js"),
  `export const prefetched = "${noisePayload(460 * 1024)}";\n`,
);
writeFile(
  path.join(distPrefetchLink, "index.html"),
  budgetIndexHtml.replace(
    '<script type="module" src="/assets/entry.js"></script>',
    '<link rel="prefetch" href="/assets/prefetch-only.js">\n<script type="module" src="/assets/entry.js"></script>',
  ),
);
writeFreshManifest(distPrefetchLink);
/** 判别力前提：prefetch-only.js 只被该 `<link>` 引用，闭包计数差异只能来自 rel 判定。 */
if (fs.readFileSync(path.join(distPrefetchLink, "assets", "entry.js"), "utf8").includes("prefetch-only")) {
  throw new Error("自测装置失效：prefetch-only.js 不应被入口静态引用，否则闭包计数与 rel 无关");
}

/**
 * 夹具判别力前提（TEST-7，D3）：修复前的入口采集只认 `/assets/` 前缀。同一份合成 index.html 上，
 * 旧正则必须采集不到 `/runtime-config.js`（且会把注释里的引用算进去），否则下面的断言证明不了缺口被补上。
 */
const LEGACY_ENTRY_PATTERN = /(?:src|href)="(\/assets\/[^"]+)"/g;
const legacyEntryReferences = [...budgetIndexHtml.matchAll(LEGACY_ENTRY_PATTERN)].map((match) => match[1]);
if (legacyEntryReferences.some((reference) => reference.includes("runtime-config"))) {
  throw new Error(`自测装置失效：旧正则不应采集到非 /assets 引用，实际 ${legacyEntryReferences.join("、")}`);
}
/**
 * 首屏闭包期望值 = entry.js + shared.js（静态 import）+ runtime-config.js；route.js 是懒加载入口，
 * commented-out.js 只在注释里被引用，均不得计入。gzip 用门禁同一参数（level 9）。
 */
const initialClosureFiles = [
  path.join(assetsDir, "entry.js"),
  path.join(assetsDir, "shared.js"),
  path.join(distDir, "runtime-config.js"),
];
const initialClosureBytes = initialClosureFiles.reduce(
  (total, file) => total + gzipSync(fs.readFileSync(file), { level: 9 }).length,
  0,
);
const initialClosureKiB = Math.round((initialClosureBytes / 1024) * 100) / 100;
const expectedInitialClosure = `首屏关键 JS 闭包：${initialClosureFiles.length} 个文件，${initialClosureKiB} KiB gzip`;
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
// E2E 侧的 minPassed 是 (spec × project) 实例数，不是 spec 文件数：`e2eProbe` 用 desktop + mobile 两列推导。
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
  {
    file: "src/shared/i18n/deferred-resources-retry.test.tsx",
    passed: 3,
    titles: [
      "首次加载失败后再次调用会重新请求并成功，不再复用失败态",
      "成功路径连调两次只加载一次资源模块（失败重置不得退化成每次重置）",
    ],
  },
  {
    file: "src/app/deferred-resources-failure.test.tsx",
    passed: 1,
    titles: ["另一条懒加载路由仍能解析并渲染，失败态不被单例永久缓存"],
  },
  {
    file: "src/app/route-error-boundary.test.tsx",
    passed: 3,
    titles: ["懒加载页面模块加载失败时展示可恢复错误界面，而不是空白页"],
  },
];
/**
 * 必填标题逐字取自真实 spec，与被测脚本的 REQUIRED_E2E.requiredTitles 保持一致。
 * `desktop` / `mobile` 是 project 展开后的 (spec × project) 实例数（2026-10-12 实测 25 + 25 = 50，7 个文件），
 * `passed` = desktop + mobile，即被测脚本的实例口径棘轮值；矩阵削回桌面后报告会回落到 `desktop` 列数字。
 */
function withInstanceTotals(entries) {
  return entries.map((entry) => ({ ...entry, passed: entry.desktop + entry.mobile }));
}
const e2eProbe = withInstanceTotals([
  {
    file: "e2e/auth.e2e.ts",
    desktop: 6,
    mobile: 6,
    titles: [
      "未登录访问受保护路由会被重定向到登录页",
      "正确凭据登录成功、进入受保护页面并在刷新后保持登录",
      "空账号池下推理未就绪，但健康检查与管理 API 可用",
    ],
  },
  {
    file: "e2e/client-keys.e2e.ts",
    desktop: 4,
    mobile: 4,
    titles: ["创建密钥：表单校验失败后成功创建并展示一次性明文", "删除密钥：确认后行与真实服务端记录同时消失"],
  },
  {
    file: "e2e/navigation.e2e.ts",
    desktop: 5,
    mobile: 4,
    titles: [
      "侧栏导航到账号和设置，深链接刷新后保持页面与当前导航状态",
      "账号菜单切换英文和中文，导航与刷新后仍使用所选语言",
      "375px 登录页与横屏无横向溢出，Tab 和 Enter 可完成真实登录",
    ],
  },
  {
    file: "e2e/request-audits.e2e.ts",
    desktop: 3,
    mobile: 3,
    titles: ["状态筛选改变真实查询范围并显示激活计数，清除后恢复空态"],
  },
  {
    file: "e2e/settings.e2e.ts",
    desktop: 5,
    mobile: 5,
    titles: [
      "设置页分页可切换：Grok Build 与 Grok Web 面板按标签显隐",
      "设置页保存真实写入服务端：成功提示后刷新页面仍读到新值",
      "设置保存遇到 409 版本冲突时提示冲突并保留用户草稿",
    ],
  },
  {
    file: "e2e/accounts.e2e.ts",
    desktop: 2,
    mobile: 2,
    titles: [
      "导入非法账号文件：提示导入失败且真实服务端账号数不变",
      "导入合法账号文件：列表出现新账号且服务端可读回，随后清理恢复空号池",
    ],
  },
  {
    file: "e2e/mobile-device.e2e.ts",
    desktop: 0,
    mobile: 1,
    titles: ["移动 project 应用真实设备描述符：hasTouch、isMobile、DPR 与 UA"],
  },
]);
/**
 * E2E 报告的 project 形态：与被测脚本 REQUIRED_E2E_PROJECTS 及 playwright.config.ts:40-44 一致，
 * `key` 指向探针条目里的实例数列（desktop ← chromium、mobile ← mobile-chromium）。
 */
const E2E_PROJECTS = [
  { name: "chromium", key: "desktop" },
  { name: "mobile-chromium", key: "mobile" },
];
/** 只保留桌面 project（等价于 playwright.config.ts 删掉 mobile-chromium 后的报告）。 */
const E2E_DESKTOP_ONLY_PROJECTS = E2E_PROJECTS.filter((project) => project.key === "desktop");
/** 未登记 project 形态：mobile 列改名为 webkit → 必须 fail-closed（未登记 + 缺 mobile-chromium）。 */
const E2E_UNKNOWN_PROJECTS = [
  { name: "chromium", key: "desktop" },
  { name: "webkit", key: "mobile" },
];
/** 缺 project 维度形态（旧版 reporter 或手改报告）：tests 不带 projectName → 必须 fail-closed。 */
const E2E_PROJECTLESS = [
  { name: undefined, key: "desktop" },
  { name: undefined, key: "mobile" },
];
/**
 * 夹具判别力前提（TEST-7）：只按「文件 → 通过数」聚合的旧实现只要求清单文件齐、通过数 ≥ 文件棘轮、
 * 必填标题通过、无失败 / 跳过 / flaky、文件数 ≥ 6。F4 组合反例必须在构造时满足全部五条，否则它只能
 * 证明「本来就会失败」，证明不了新门禁补上了 project 维度盲区（旧实现实测放行，见 AUDIT.md §24.2 P2-1）。
 */
function assertE2eFileLevelClean(label, entries) {
  const fileRatchet = {
    "e2e/auth.e2e.ts": 12,
    "e2e/client-keys.e2e.ts": 8,
    "e2e/navigation.e2e.ts": 9,
    "e2e/request-audits.e2e.ts": 6,
    "e2e/settings.e2e.ts": 10,
    "e2e/accounts.e2e.ts": 4,
    "e2e/mobile-device.e2e.ts": 1,
  };
  const dirty = entries.filter((entry) => {
    const instances = (entry.desktop ?? 0) + (entry.mobile ?? 0) + (entry.flaky ?? 0) + (entry.skipped ?? 0);
    const ratchet = fileRatchet[entry.file] ?? 0;
    return instances < ratchet || (entry.expectedFailure ?? 0) > 0 || (entry.unknownStatus ?? 0) > 0;
  });
  if (dirty.length > 0) {
    throw new Error(`夹具 ${label} 文件维度不干净（旧实现会失败）：${dirty.map((entry) => entry.file).join("、")}`);
  }
}
/**
 * 夹具（F1）：project 矩阵被削回桌面（删除 mobile-chromium project）后的报告——6 个文件 / 25 个实例，
 * 恰好满足移动矩阵加入前的旧口径（逐文件通过数不低于旧的 6/4/5/3/3），因此旧实现放行（假通过）；
 * 当前棘轮为 7 文件 + 12/8/9/6/10/4/1 + 逐 project 下限，本夹具必须失败。
 */
const e2eDesktopOnlyProbe = e2eProbe
  .filter((entry) => entry.desktop > 0)
  .map((entry) => ({ ...entry, mobile: 0, passed: entry.desktop }));
/**
 * 夹具（F4）：§24.2 P2-1 的组合反例——`e2e/auth.e2e.ts` 把 2 个跨端用例改标 `@desktop`（mobile −2）
 * 并新增 1 个无标签用例（两个 project 各 +1）：该文件 6+6 变成 7+5 仍是 12，总实例仍是 50，
 * 文件维度与旧实现全部放行，只有 project 维度会失败。
 */
const e2eProjectDilutedProbe = e2eProbe.map((entry) =>
  entry.file === "e2e/auth.e2e.ts" ? { ...entry, desktop: entry.desktop + 1, mobile: entry.mobile - 1 } : entry,
);
assertE2eFileLevelClean("e2e-project-diluted", e2eProjectDilutedProbe);
/** 被测脚本的必需文件总数棘轮；用只含 1 个通过用例的填充文件补足，正样本在真实下限上通过。 */
const MIN_VITEST_PROBE_FILES = 126;
function padVitestEntries(entries, target = MIN_VITEST_PROBE_FILES) {
  const padded = entries.map((entry) => entry);
  for (let index = padded.length; index < target; index += 1) {
    padded.push({ file: `src/shared/gate-fixture-${index + 1}.test.tsx`, passed: 1 });
  }
  return padded;
}
const vitestHealthyEntries = padVitestEntries(vitestProbe);
const vitestHealthyTotal = vitestHealthyEntries.reduce((total, entry) => total + entry.passed, 0);
/**
 * 实例口径的固定期望（真实产物 2026-10-12：chromium 25 + mobile-chromium 25 = 50 个实例、7 个文件；
 * 仅断言桌面布局本身成立的用例保留 `@desktop`，其余用例在两个 project 都运行）。
 * 写死而不从 `e2eProbe` 推导：从探针推导的话，矩阵被削减时正样本会跟着缩水，等于没有棘轮。
 */
const E2E_EXPECTED_FILES = 7;
const E2E_EXPECTED_CASES = 50;
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
  /** 收集期失败：文件级 status 非 passed 且 assertionResults 为空（真实产物里导入报错即此形态）。 */
  const resultsOf = (entry) => {
    if (entry.collectError) return [];
    return [
      ...(entry.titles ?? []).map((title) => ({ fullName: `装置用例 ${title}`, status: "passed" })),
      ...(entry.failedTitles ?? []).map((title) => ({ fullName: `装置用例 ${title}`, status: "failed" })),
      ...statusAssertions(entry.file, "passed", entry.passed - (entry.titles ?? []).length),
      ...statusAssertions(entry.file, "failed", (entry.failed ?? 0) - (entry.failedTitles ?? []).length),
      ...statusAssertions(entry.file, "skipped", entry.skipped ?? 0),
    ];
  };
  return `${JSON.stringify({
    startTime: startMs,
    testResults: entries.map((entry) => ({
      name: path.join(rootDir, entry.file),
      status: entry.collectError ? "failed" : "passed",
      assertionResults: resultsOf(entry),
    })),
  })}\n`;
}

/**
 * Playwright JSON：与真实产物一致——`config.rootDir` 指向 e2e 目录，suite/spec 的 `file` 是相对 rootDir 的
 * 纯文件名（`auth.e2e.ts`）；`shape` 用于构造绝对路径形态、缺 rootDir 形态与 project 形态。
 * 每个 project 各产出一份 spec（真实产物即此形态：2026-10-12 的 42 实例报告），`tests[].projectName` 是被测
 * 脚本判定 project 覆盖的唯一来源；`shape.projects[].name` 为 undefined 时刻意省略该字段，用于构造
 * 「报告缺 project 维度」的 fail-closed 夹具。
 */
function playwrightJson(entries, startMs, shape) {
  const spec = (title, file, status, projectName, expectedStatus = "passed") => ({
    title,
    file,
    tests: [{ status, expectedStatus, projectName }],
  });
  const filler = (file, status, count, projectName, expectedStatus = "passed") =>
    Array.from({ length: Math.max(count, 0) }, (_, index) =>
      spec(`${file} ${status} #${index + 1}`, file, status, projectName, expectedStatus),
    );
  /**
   * 必填标题与异常用例（预期失败 / 未知状态 / flaky / 运行时跳过 / 静态跳过）都落在实例数够用的那个 project
   * 上，其余 project 只补该文件在该 project 下的实例数——与真实产物的分布一致，也保证文件实例总数不受影响。
   */
  const specsOf = (entry) => {
    const file = shape.fileOf(entry.file);
    const primary =
      shape.projects.find((project) => (entry[project.key] ?? 0) >= (entry.titles ?? []).length) ?? shape.projects[0];
    const specs = [];
    for (const project of shape.projects) {
      const total = entry[project.key] ?? 0;
      if (project !== primary) {
        specs.push(...filler(file, "expected", total, project.name));
        continue;
      }
      const expectedFailure = entry.expectedFailure ?? 0;
      const unknownStatus = entry.unknownStatus ?? 0;
      const filled = total - (entry.titles ?? []).length - expectedFailure - unknownStatus;
      specs.push(
        ...(entry.titles ?? []).map((title) => spec(title, file, "expected", project.name)),
        ...filler(file, "expected", filled, project.name),
        ...filler(file, "expected", expectedFailure, project.name, "failed"),
        ...filler(file, "weird", unknownStatus, project.name),
        ...filler(file, "flaky", entry.flaky ?? 0, project.name),
        ...filler(file, "skipped", entry.skipped ?? 0, project.name),
        // 静态 test.skip() / test.describe.skip() / test.fixme()：status 与 expectedStatus 都是 "skipped"。
        ...filler(file, "skipped", entry.skippedStatic ?? 0, project.name, "skipped"),
      );
    }
    return { title: entry.file, file, suites: [], specs };
  };
  const suites = entries.map(specsOf);
  const instanceCount = suites.reduce((total, suite) => total + suite.specs.length, 0);
  return `${JSON.stringify({
    config: playwrightConfigOf(shape),
    errors: [],
    stats: {
      startTime: new Date(startMs).toISOString(),
      duration: 1000,
      expected: 0,
      unexpected: 0,
      flaky: 0,
      // listOnly 形态复现 `playwright test --list`：收集清单里全部用例只出现在 stats.skipped。
      skipped: shape.listOnly ? instanceCount : 0,
    },
    suites,
  })}\n`;
}

/** 报告形态 → config：listOnly 形态带 argv（含 `--list`），其余只按 rootDir 是否存在构造。 */
function playwrightConfigOf(shape) {
  if (shape.listOnly) return { argv: ["playwright", "test", "--list"] };
  return shape.rootDir === null ? {} : { rootDir: shape.rootDir };
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
 * E2E 报告的形态：默认与真实产物一致（file 是纯文件名 + `config.rootDir` 指向 <dir>/e2e）；e2eAbsoluteShape
 * 构造绝对路径形态，e2eWithoutRootDir 构造缺 `config.rootDir` 形态，e2eProjects 覆盖 project 形态，
 * e2eListOnly 构造 `playwright test --list` 的收集清单形态（config.argv 含 `--list`、stats 只有 skipped）。
 */
function e2eShapeOf(dir, options) {
  const projects = options.e2eProjects ?? E2E_PROJECTS;
  const listOnly = options.e2eListOnly === true;
  if (options.e2eAbsoluteShape) return { rootDir: null, fileOf: (file) => path.join(dir, file), projects, listOnly };
  if (options.e2eWithoutRootDir) return { rootDir: null, fileOf: (file) => path.basename(file), projects, listOnly };
  return { rootDir: path.join(dir, "e2e"), fileOf: (file) => path.basename(file), projects, listOnly };
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
/**
 * 夹具：`playwright test --list` 写出的收集清单（config.argv 含 `--list`、stats.skipped 等于用例总数、
 * stats.expected = 0）。它不含任何执行结果，旧判定会把它当健康报告（清单齐、无失败、通过数够）放行。
 */
const listOnlyE2eReportRoot = buildReportRoot("report-e2e-list-only", {
  vitest: vitestHealthyEntries,
  vitestStartMs: probeNow,
  e2e: e2eProbe,
  e2eStartMs: probeNow,
  e2eListOnly: true,
});
/** 夹具：首个 E2E 文件含一个 test.fail() 预期失败用例（status="expected" + expectedStatus="failed"）。 */
const expectedFailureE2eEntries = e2eProbe.map((entry, index) =>
  index === 0 ? { ...entry, desktop: entry.desktop - 1, expectedFailure: 1 } : entry,
);
const expectedFailureE2eReportRoot = buildReportRoot("report-e2e-expected-failure", {
  vitest: vitestHealthyEntries,
  vitestStartMs: probeNow,
  e2e: expectedFailureE2eEntries,
  e2eStartMs: probeNow,
});
/** 夹具：首个 E2E 文件含一个未知状态用例（既非 expected/unexpected/flaky/skipped）。 */
const unknownStatusE2eEntries = e2eProbe.map((entry, index) =>
  index === 0 ? { ...entry, desktop: entry.desktop - 1, unknownStatus: 1 } : entry,
);
const unknownStatusE2eReportRoot = buildReportRoot("report-e2e-unknown-status", {
  vitest: vitestHealthyEntries,
  vitestStartMs: probeNow,
  e2e: unknownStatusE2eEntries,
  e2eStartMs: probeNow,
});

/**
 * 夹具：`e2e/auth.e2e.ts` 含 1 个静态跳过实例——`test.skip()` / `test.describe.skip()` / `test.fixme()` 的
 * 真实形态是 status 与 expectedStatus 都是 "skipped"（只有运行时 `test.skip(cond)` 才保留 expectedStatus
 * "passed"）。该文件的通过数（12）与逐 project 通过数（21 + 21）都不变，只有「跳过」这一条判据能拦下它，
 * 因此不靠数量棘轮兜底：旧判据把 expectedStatus !== "passed" 一律当成 test.fail()，会把这条跳过误报成
 * 「预期失败」（诊断错误），同时让 tally.skipped 恒为 0，使 ALLOWED_SKIPS 登记通道在 E2E 侧失效。
 */
const staticSkipE2eEntries = e2eProbe.map((entry) =>
  entry.file === "e2e/auth.e2e.ts" ? { ...entry, skippedStatic: 1 } : entry,
);
const staticSkipE2eReportRoot = buildReportRoot("report-e2e-static-skip", {
  vitest: vitestHealthyEntries,
  vitestStartMs: probeNow,
  e2e: staticSkipE2eEntries,
  e2eStartMs: probeNow,
});
/**
 * 正样本：同一份含静态跳过的报告 + 把该跳过逐条登记进 ALLOWED_SKIPS 的门禁副本。副本由被测脚本逐字复制后
 * 只替换 `const ALLOWED_SKIPS = [];` 一行（锚点未命中即抛错，不静默降级），与装置一起落在 os.tmpdir() 之下，
 * 符合脚本自身对 TEST_REPORT_ROOT 的限制。判别力：旧判据把这条跳过算成 test.fail() 预期失败，登记通道对
 * E2E 无效，本用例在旧实现下必然 exit 1。
 */
const allowedSkipGatePath = path.join(root, "check-test-results-allowlisted.mjs");
const allowedSkipRegistration = { file: "e2e/auth.e2e.ts", title: "auth.e2e.ts skipped #1" };
const gateSource = fs.readFileSync(path.join(scriptsDir, "check-test-results.mjs"), "utf8");
const allowlistSource = gateSource.replace(
  "const ALLOWED_SKIPS = [];",
  `const ALLOWED_SKIPS = [${JSON.stringify(allowedSkipRegistration)}];`,
);
if (allowlistSource === gateSource) throw new Error("self-test 装置锚点未命中：ALLOWED_SKIPS 声明行已变更");
writeFile(allowedSkipGatePath, allowlistSource);
/** 夹具：只写报告、不写清单文件——新鲜度无法核对时旧报告不得放行。 */
const absentFilesReportRoot = path.join(root, "report-absent-files");
writeProbeFile(
  path.join(absentFilesReportRoot, ".artifacts", "vitest", "results.json"),
  vitestJson(absentFilesReportRoot, vitestHealthyEntries, staleMs),
  probeNow,
);
const missingReportRoot = path.join(root, "report-missing");
/**
 * 夹具（F1）：project 矩阵被削回桌面（等价于 playwright.config.ts 删掉 mobile-chromium）后的 E2E 报告——
 * 5 个文件 / 21 个实例，只满足移动矩阵加入前的旧口径（5 文件 + 6/4/5/3/3 通过数）；在当前棘轮
 * （6 文件 + 12/8/9/6/6 + 逐 project 下限）下必须失败：移动覆盖丧失不得静默通过。
 */
const e2eDesktopOnlyReportRoot = buildReportRoot("report-e2e-desktop-only", {
  vitest: vitestHealthyEntries,
  vitestStartMs: probeNow,
  e2e: e2eDesktopOnlyProbe,
  e2eStartMs: probeNow,
  e2eProjects: E2E_DESKTOP_ONLY_PROJECTS,
});
/**
 * 夹具（F4）：§24.2 P2-1 的组合反例报告——`e2e/auth.e2e.ts` 把 2 个跨端用例改标 `@desktop`（mobile −2）
 * 并新增 1 个无标签用例（两个 project 各 +1）：文件 6+6 变成 7+5 仍是 12，总实例仍是 42，文件维度与旧实现
 * 全部放行，只有 project 维度（mobile-chromium 20 < 21、auth 的 mobile 5 < 6）会失败。
 */
const e2eProjectDilutedReportRoot = buildReportRoot("report-e2e-project-diluted", {
  vitest: vitestHealthyEntries,
  vitestStartMs: probeNow,
  e2e: e2eProjectDilutedProbe,
  e2eStartMs: probeNow,
});
/** 夹具（F5）：报告缺 project 维度（tests 无 projectName，旧版 reporter 或手改报告）→ fail-closed。 */
const e2eProjectlessReportRoot = buildReportRoot("report-e2e-projectless", {
  vitest: vitestHealthyEntries,
  vitestStartMs: probeNow,
  e2e: e2eProbe,
  e2eStartMs: probeNow,
  e2eProjects: E2E_PROJECTLESS,
});
/** 夹具（F6）：报告出现未登记 project（webkit）且缺 mobile-chromium → fail-closed。 */
const e2eUnknownProjectReportRoot = buildReportRoot("report-e2e-unknown-project", {
  vitest: vitestHealthyEntries,
  vitestStartMs: probeNow,
  e2e: e2eProbe,
  e2eStartMs: probeNow,
  e2eProjects: E2E_UNKNOWN_PROJECTS,
});
/**
 * 夹具（F2）：报告本身完整通过，但清单里的一个测试文件已从磁盘删除——新鲜度只按剩余文件核对，
 * 旧实现只 `console.warn`（exit 0），修复后任何缺失都必须失败。
 */
const missingListFileReportRoot = buildReportRoot("report-missing-list-file", {
  vitest: vitestHealthyEntries,
  vitestStartMs: probeNow,
});
fs.rmSync(path.join(missingListFileReportRoot, "src/app/deferred-pages-loading.test.tsx"));
/** 清单外的装置文件（填充文件里最靠后的一支），用于构造文件级失效夹具。 */
const lastProbeFile = vitestHealthyEntries[vitestHealthyEntries.length - 1].file;
/** 夹具（F3a）：非清单文件收集期失败（文件级 status="failed" 且 assertionResults 为空）。 */
const collectionFailureReportRoot = buildReportRoot("report-collection-failure", {
  vitest: vitestHealthyEntries.map((entry, index) =>
    index === vitestHealthyEntries.length - 1 ? { ...entry, passed: 0, collectError: true } : entry,
  ),
  vitestStartMs: probeNow,
});
/** 夹具（F3b）：非清单文件整文件跳过（跳过数 == 断言总数且 > 0），旧实现只告警。 */
const wholeFileSkipReportRoot = buildReportRoot("report-whole-file-skip", {
  vitest: vitestHealthyEntries.map((entry, index) =>
    index === vitestHealthyEntries.length - 1 ? { ...entry, passed: 0, skipped: 1 } : entry,
  ),
  vitestStartMs: probeNow,
});
/** 反例：非清单文件部分跳过仍只告警，不得因 F3b 的修复被升级为失败。 */
const partialSkipReportRoot = buildReportRoot("report-partial-skip", {
  vitest: vitestHealthyEntries.map((entry, index) =>
    index === vitestHealthyEntries.length - 1 ? { ...entry, skipped: 1 } : entry,
  ),
  vitestStartMs: probeNow,
});

/**
 * ---- node:test 执行性门禁装置（check-node-test-results.mjs：TEST-1 / EVID-1）----
 * 报告写在临时根目录的 .artifacts/node-test/results.json，清单文件写在同一个根目录下，用
 * NODE_TEST_REPORT_ROOT 注入（该变量仅供自测使用），不读取也不覆盖仓库内的真实报告。
 * 下面的清单按被测脚本的棘轮值（REQUIRED_NODE_TESTS）构造，它同时是「磁盘上有哪些 node:test 文件」的
 * 唯一事实来源；棘轮调整时必须同步更新，否则正样本会失败。
 */
/** 被测脚本的必需文件清单（与 check-node-test-results.mjs 的 REQUIRED_NODE_TESTS 逐项一致）。 */
const nodeTestProbe = [
  { file: "scripts/build-inputs.test.ts", passed: 49 },
  { file: "scripts/build-manifest-plugin.test.ts", passed: 9 },
  { file: "src/features/audits/audit-detail-format.test.ts", passed: 11 },
  { file: "src/features/audits/audit-format.test.ts", passed: 8 },
  { file: "src/features/audits/audit-usage.test.ts", passed: 7 },
  { file: "src/features/dashboard/dashboard-activity-format.test.ts", passed: 5 },
  { file: "src/features/dashboard/dashboard-provider-format.test.ts", passed: 6 },
  { file: "src/features/dashboard/dashboard-trend-buckets.test.ts", passed: 5 },
  { file: "src/features/dashboard/dashboard-trend-series.test.ts", passed: 4 },
  { file: "src/features/docs/api-docs-examples.test.ts", passed: 8 },
  { file: "src/features/media/media-format.test.ts", passed: 5 },
  { file: "src/features/quality-guard/quality-guard-query.test.ts", passed: 3 },
  { file: "src/shared/lib/format.test.ts", passed: 2 },
  { file: "src/shared/lib/usd.test.ts", passed: 4 },
];
const NODE_TEST_PROBE_FILES = nodeTestProbe.length;
const NODE_TEST_PROBE_CASES = nodeTestProbe.reduce((total, entry) => total + entry.passed, 0);
/** 清单外的新增 node:test 文件，用于构造文件级失效（整文件跳过 / 部分跳过 / 收集失败）夹具。 */
const nodeTestFiller = { file: "src/shared/gate-fixture-node.test.ts", passed: 1 };
/** 被掏空的清单文件（usd 有 4 个用例）：整文件跳过 / describe.skip / 部分跳过 / 用例失败都作用在它身上。 */
const nodeTestTarget = "src/shared/lib/usd.test.ts";

/** 把清单中某个文件的计数替换成 patch，其余文件保持不变。 */
function nodeTestEntryWith(file, patch) {
  return nodeTestProbe.map((entry) => (entry.file === file ? { ...entry, ...patch } : entry));
}

/**
 * 夹具判别力前提（TEST-7）：只依赖退出码的旧判定下，node --test 仅当存在 failed / cancelled / 收集失败用例时
 * 才退出非 0。下面这些夹具必须在构造时就满足「退出码干净」，否则它们只能证明「本来就会失败」，
 * 证明不了新门禁补上了「跳过 / 删除 / 过期报告」的盲区。
 */
function assertNodeTestExitCodeClean(label, entries) {
  const dirty = entries.filter(
    (entry) => (entry.failed ?? 0) > 0 || (entry.cancelled ?? 0) > 0 || (entry.collectionError ?? 0) > 0,
  );
  if (dirty.length > 0) {
    throw new Error(
      `夹具 ${label} 声称退出码干净，却含失败/取消/收集失败用例：${dirty.map((entry) => entry.file).join("、")}`,
    );
  }
}

/**
 * node:test 报告装置：与 scripts/node-test-json-reporter.mjs 的输出同形（kind / version / totals / files）。
 * totals 由用例条目推导，默认自洽；`mutate` 用于构造形状不可用与不自洽的夹具；`startMs` 省略时报告不带 startedAt。
 */
function nodeTestProbeReport(entries, options) {
  const casesOf = (entry, status, count) =>
    Array.from({ length: count }, (_, index) => ({
      name: `${entry.file} ${status} #${index + 1}`,
      kind: "test",
      status,
    }));
  const totals = { tests: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0 };
  const files = entries.map((entry) => {
    totals.passed += entry.passed ?? 0;
    totals.failed += (entry.failed ?? 0) + (entry.collectionError ?? 0);
    totals.skipped += entry.skipped ?? 0;
    totals.todo += entry.todo ?? 0;
    totals.cancelled += entry.cancelled ?? 0;
    return {
      file: entry.file,
      cases: [
        ...casesOf(entry, "passed", entry.passed ?? 0),
        ...casesOf(entry, "failed", entry.failed ?? 0),
        ...casesOf(entry, "skipped", entry.skipped ?? 0),
        ...casesOf(entry, "todo", entry.todo ?? 0),
        ...casesOf(entry, "cancelled", entry.cancelled ?? 0),
        // 收集失败：Node 在文件级失败时合成的、以文件名为用例名的事件（不计入真实用例数）。
        ...Array.from({ length: entry.collectionError ?? 0 }, () => ({
          name: path.basename(entry.file),
          kind: "file-root",
          status: "failed",
          failureType: "testCodeFailure",
        })),
      ],
      summary: null,
    };
  });
  totals.tests = totals.passed + totals.failed + totals.skipped + totals.todo + totals.cancelled;
  return {
    kind: "node-test-json",
    version: 1,
    nodeVersion: process.version,
    cwd: root,
    finishedAt: new Date(options.startMs ?? probeNow).toISOString(),
    diagnostics: [],
    totals,
    files,
    ...(options.startMs === undefined ? {} : { startedAt: new Date(options.startMs).toISOString() }),
  };
}

/** 建一个 node:test 报告根目录：写清单文件（mtime 固定）与报告（时间戳 / mtime / 内容可控）。 */
function buildNodeTestRoot(name, options = {}) {
  const dir = path.join(root, name);
  for (const entry of nodeTestProbe) {
    writeProbeFile(path.join(dir, entry.file), `// ${entry.file} 装置\n`, freshInputMs);
  }
  const report = nodeTestProbeReport(options.entries ?? nodeTestProbe, options);
  if (options.mutate) options.mutate(report);
  if (options.writeReport !== false) {
    writeProbeFile(
      path.join(dir, ".artifacts", "node-test", "results.json"),
      options.reportText ?? `${JSON.stringify(report, null, 2)}\n`,
      options.reportMtimeMs ?? probeNow,
    );
  }
  return dir;
}

const nodeTestHealthyRoot = buildNodeTestRoot("node-test-healthy", { startMs: probeNow });
assertNodeTestExitCodeClean("node-test-healthy", nodeTestProbe);
const nodeTestMissingEntryRoot = buildNodeTestRoot("node-test-missing-entry", {
  entries: nodeTestProbe.filter((entry) => entry.file !== nodeTestTarget),
  startMs: probeNow,
});
assertNodeTestExitCodeClean("node-test-missing-entry", nodeTestProbe);
/** 夹具：报告健康，但清单里的一个测试文件已从磁盘删除（旧判定完全看不到）。 */
const nodeTestMissingListFileRoot = buildNodeTestRoot("node-test-missing-list-file", { startMs: probeNow });
fs.rmSync(path.join(nodeTestMissingListFileRoot, nodeTestTarget));
assertNodeTestExitCodeClean("node-test-missing-list-file", nodeTestProbe);
/** 夹具：整文件 test.skip（用例全部未执行、0 失败）→ 退出码仍为 0。 */
const nodeTestWholeFileSkipRoot = buildNodeTestRoot("node-test-whole-file-skip", {
  entries: nodeTestEntryWith(nodeTestTarget, { passed: 0, skipped: 4 }),
  startMs: probeNow,
});
assertNodeTestExitCodeClean("node-test-whole-file-skip", nodeTestEntryWith(nodeTestTarget, { passed: 0, skipped: 4 }));
/** 夹具：describe.skip 把清单文件整体跳过——该文件不再注册任何用例，报告里只剩 0 用例条目。 */
const nodeTestDescribeSkipRoot = buildNodeTestRoot("node-test-describe-skip", {
  entries: nodeTestEntryWith(nodeTestTarget, { passed: 0 }),
  startMs: probeNow,
});
assertNodeTestExitCodeClean("node-test-describe-skip", nodeTestEntryWith(nodeTestTarget, { passed: 0 }));
/** 夹具：清单文件部分跳过（用例数不变，仍有 3 个通过）。 */
const nodeTestPartialSkipRoot = buildNodeTestRoot("node-test-partial-skip", {
  entries: nodeTestEntryWith(nodeTestTarget, { passed: 3, skipped: 1 }),
  startMs: probeNow,
});
assertNodeTestExitCodeClean("node-test-partial-skip", nodeTestEntryWith(nodeTestTarget, { passed: 3, skipped: 1 }));
/** 夹具：清单文件少跑一个用例（通过数低于棘轮，用例总数也低于棘轮）。 */
const nodeTestBelowCasesRoot = buildNodeTestRoot("node-test-below-cases", {
  entries: nodeTestEntryWith(nodeTestTarget, { passed: 3 }),
  startMs: probeNow,
});
assertNodeTestExitCodeClean("node-test-below-cases", nodeTestEntryWith(nodeTestTarget, { passed: 3 }));
/** 夹具：清单文件有用例失败（这种形状退出码本就会红，这里验证的是逐文件原因与自洽性不误报）。 */
const nodeTestFailedCaseRoot = buildNodeTestRoot("node-test-failed-case", {
  entries: nodeTestEntryWith(nodeTestTarget, { passed: 3, failed: 1 }),
  startMs: probeNow,
});
/**
 * 夹具：清单文件出现被取消用例（父用例失败导致，真实形态为 failureType=cancelledByParent，
 * 采集口径已用真实 node 输出核对）——这种形状退出码本就会红，这里验证的是逐文件原因与自洽性不误报。
 */
const nodeTestCancelledRoot = buildNodeTestRoot("node-test-cancelled", {
  entries: nodeTestEntryWith(nodeTestTarget, { cancelled: 1 }),
  startMs: probeNow,
});
/** 夹具：清单外文件收集失败（导入报错）——以 file-root 用例呈现，不计入真实用例数。 */
const nodeTestCollectionFailureRoot = buildNodeTestRoot("node-test-collection-failure", {
  entries: [...nodeTestProbe, { ...nodeTestFiller, passed: 0, collectionError: 1 }],
  startMs: probeNow,
});
/** 夹具：清单外文件整文件跳过 → 必须失败（不得只告警）。 */
const nodeTestWholeFileSkipFillerRoot = buildNodeTestRoot("node-test-whole-file-skip-filler", {
  entries: [...nodeTestProbe, { ...nodeTestFiller, passed: 0, skipped: 2 }],
  startMs: probeNow,
});
assertNodeTestExitCodeClean("node-test-whole-file-skip-filler", [
  ...nodeTestProbe,
  { ...nodeTestFiller, passed: 0, skipped: 2 },
]);
/** 反例：清单外文件部分跳过仍只告警，不得因整文件跳过的修复被升级为失败。 */
const nodeTestPartialSkipFillerRoot = buildNodeTestRoot("node-test-partial-skip-filler", {
  entries: [...nodeTestProbe, { ...nodeTestFiller, passed: 1, skipped: 1 }],
  startMs: probeNow,
});
assertNodeTestExitCodeClean("node-test-partial-skip-filler", [
  ...nodeTestProbe,
  { ...nodeTestFiller, passed: 1, skipped: 1 },
]);
/**
 * 夹具（F8）：清单外文件里有 failed 用例（totals.failed=1）——14 个清单文件刚好达标，旧实现只按清单文件
 * 判定失败/取消，既不算失败也不告警 → exit 0；修复后报告内任何文件的 failed 用例都必须计入失败。
 * 该形状在真实 node --test 下退出码本就是红的，这里验证的是「门禁自己会不会放行」（故不适用
 * assertNodeTestExitCodeClean）。
 */
const nodeTestFillerFailedRoot = buildNodeTestRoot("node-test-filler-failed", {
  entries: [...nodeTestProbe, { ...nodeTestFiller, passed: 0, failed: 1 }],
  startMs: probeNow,
});
/**
 * 夹具（F9）：清单外文件 `cases: []`（describe.skip 把整文件跳过，或用例被删只留 describe）——用例总数仍是
 * 126、清单文件全部达标，旧实现的整文件跳过判定要求 total > 0 才成立 → exit 0；修复后 0 用例即失败。
 */
const nodeTestFillerEmptyCasesRoot = buildNodeTestRoot("node-test-filler-empty-cases", {
  entries: [...nodeTestProbe, { ...nodeTestFiller, passed: 0 }],
  startMs: probeNow,
});
/**
 * 夹具（F10）：NODE_TEST_REPORT_ROOT 指向仓库内路径（不在 os.tmpdir() 之下）——该覆盖只允许指向系统临时
 * 目录，越界必须 exit 2 拒绝，否则一次可见的包装层改动就能把门禁重定向到伪造的健康报告。
 */
const nodeTestEscapeRoot = path.join(frontendDir, "scripts");
/**
 * 夹具（F11）：磁盘上多出一个未登记在 REQUIRED_NODE_TESTS 的测试文件——报告健康、清单文件全部达标，
 * 旧实现（只有清单判定 + 派生的文件/用例总数下限）exit 0；要求磁盘集合与清单完全相等后必须失败。
 * 这正是「新增一个不受约束的清单外文件 → 再整体删除」的绕过入口。
 */
const nodeTestUnregisteredFileRoot = buildNodeTestRoot("node-test-unregistered-file", { startMs: probeNow });
writeProbeFile(
  path.join(nodeTestUnregisteredFileRoot, "src/shared/gate-extra-node.test.ts"),
  "// 未登记在必需清单中的 node:test 文件 装置\n",
  freshInputMs,
);
/** 夹具：报告比清单文件旧（沿用上一次运行的结果）→ 必须失败。 */
const nodeTestStaleRoot = buildNodeTestRoot("node-test-stale", { startMs: staleMs });
assertNodeTestExitCodeClean("node-test-stale", nodeTestProbe);
/** 夹具：报告缺 startedAt，只有报告文件 mtime 可用且已过期 → 必须走 mtime 兜底并失败，不得静默跳过。 */
const nodeTestNoTimestampRoot = buildNodeTestRoot("node-test-no-timestamp", {
  startMs: undefined,
  reportMtimeMs: staleMs,
});
assertNodeTestExitCodeClean("node-test-no-timestamp", nodeTestProbe);
/** 夹具：报告文件缺失（从未运行或产物被清理）→ 退出码 2。 */
const nodeTestMissingReportRoot = buildNodeTestRoot("node-test-missing-report", { writeReport: false });
/** 夹具：报告形状不可用（缺 run 级汇总）→ 退出码 2，不放行无法解释的报告。 */
const nodeTestBadShapeRoot = buildNodeTestRoot("node-test-bad-shape", {
  startMs: probeNow,
  mutate: (report) => {
    delete report.totals;
  },
});
/** 夹具：报告与 Node 自己的 run 级汇总不自洽（reporter 口径与实际运行不符）→ 必须 fail-closed。 */
const nodeTestInconsistentRoot = buildNodeTestRoot("node-test-inconsistent", {
  startMs: probeNow,
  mutate: (report) => {
    report.totals.passed += 1;
  },
});
/** 夹具（F12）：报告 kind 不匹配（旧版 reporter 或手改报告）→ 形状不可用，exit 2。 */
const nodeTestWrongKindRoot = buildNodeTestRoot("node-test-wrong-kind", {
  startMs: probeNow,
  mutate: (report) => {
    report.kind = "vitest-json";
  },
});
/** 夹具（F13）：报告 version 不匹配 → 形状不可用，exit 2。 */
const nodeTestWrongVersionRoot = buildNodeTestRoot("node-test-wrong-version", {
  startMs: probeNow,
  mutate: (report) => {
    report.version = 2;
  },
});
/** 夹具（F14）：报告 files 不是数组 → 形状不可用，exit 2。 */
const nodeTestFilesNotArrayRoot = buildNodeTestRoot("node-test-files-not-array", {
  startMs: probeNow,
  mutate: (report) => {
    report.files = {};
  },
});
/** 夹具（F15）：报告内容不是合法 JSON（被截断 / 手改坏）→ exit 2，不得沿用无法解释的报告。 */
const nodeTestUnparsableRoot = buildNodeTestRoot("node-test-unparsable", {
  startMs: probeNow,
  reportText: '{ "kind": "node-test-json", "version": 1, \n',
});
/** 夹具（F16）：清单文件全部不在磁盘上（present.length === 0）→ 新鲜度无法核对，旧报告不得放行。 */
const nodeTestNoListFilesRoot = buildNodeTestRoot("node-test-no-list-files", { startMs: probeNow });
for (const entry of nodeTestProbe) fs.rmSync(path.join(nodeTestNoListFilesRoot, entry.file));

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
    contains: [expectedInitialClosure, "体积预算门禁通过。"],
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
    name: "预算：dist 输入指纹与当前构建输入不一致应失败（旧实现 exit 0）",
    expect: 2,
    contains: ["dist 早于当前构建输入（isBuildFresh=false）", "请先运行 pnpm build", "CHG-5"],
    absent: ["体积预算门禁通过"],
    run: () =>
      runGate("check-bundle-budget.mjs", {
        ...budgetEnv,
        BUDGET_DIST_DIR: distStaleInput,
        BUDGET_CONFIG_PATH: budgetOk,
        // 只改构建输入（VITE_* 参与输入指纹）而不重新 build：同一份 dist 从通过变为陈旧。
        VITE_GATE_SELFTEST_INPUT: "1",
      }),
  },
  {
    name: "预算：dist 缺少构建清单应失败（旧实现完全看不到新鲜度）",
    expect: 2,
    contains: ["dist 早于当前构建输入（isBuildFresh=false）"],
    absent: ["体积预算门禁通过"],
    run: () =>
      runGate("check-bundle-budget.mjs", {
        ...budgetEnv,
        BUDGET_DIST_DIR: distWithoutManifest,
        BUDGET_CONFIG_PATH: budgetOk,
      }),
  },
  {
    name: "预算：build 之后产物被改写应失败（outputHash 不匹配）",
    expect: 2,
    contains: ["dist 早于当前构建输入（isBuildFresh=false）"],
    absent: ["体积预算门禁通过"],
    run: () =>
      runGate("check-bundle-budget.mjs", {
        ...budgetEnv,
        BUDGET_DIST_DIR: distTamperedOutput,
        BUDGET_CONFIG_PATH: budgetOk,
      }),
  },
  {
    name: "预算：同一标签重复 src 时取首个，真实入口仍计入（旧实现后写覆盖先写）",
    expect: 0,
    contains: [expectedInitialClosure, "体积预算门禁通过。"],
    run: () =>
      runGate("check-bundle-budget.mjs", {
        BUDGET_DIST_DIR: distDuplicateAttribute,
        BUDGET_CONFIG_PATH: budgetOk,
      }),
  },
  {
    name: "预算：<link rel=prefetch> 不计入首屏闭包（旧实现只看 href 会多算）",
    expect: 0,
    contains: [expectedInitialClosure, "体积预算门禁通过。"],
    run: () =>
      runGate("check-bundle-budget.mjs", {
        BUDGET_DIST_DIR: distPrefetchLink,
        BUDGET_CONFIG_PATH: budgetOk,
      }),
  },
  {
    name: "预算：BUDGET_DIST_DIR 指向 tmp 之外应被拒绝（exit 2，不得重定向门禁）",
    expect: 2,
    contains: ["拒绝 BUDGET_DIST_DIR", "只允许指向系统临时目录"],
    absent: ["体积预算门禁通过", "缺少 frontend/dist"],
    run: () =>
      runGate("check-bundle-budget.mjs", {
        BUDGET_DIST_DIR: frontendDir,
        BUDGET_CONFIG_PATH: budgetOk,
      }),
  },
  {
    name: "预算：BUDGET_CONFIG_PATH 指向 tmp 之外应被拒绝（exit 2，不得用伪造配置放宽阈值）",
    expect: 2,
    contains: ["拒绝 BUDGET_CONFIG_PATH", "只允许指向系统临时目录"],
    absent: ["体积预算门禁通过"],
    run: () =>
      runGate("check-bundle-budget.mjs", {
        ...budgetEnv,
        BUDGET_CONFIG_PATH: path.join(frontendDir, "bundle-budget.json"),
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
    contains: [
      `E2E 报告：参与判定的文件 ${E2E_EXPECTED_FILES} 个、用例 ${E2E_EXPECTED_CASES} 个`,
      "E2E project 报告：2 个 project（chromium 通过 25 个、mobile-chromium 通过 25 个）",
    ],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: healthyReportRoot }, ["--e2e"]),
  },
  {
    name: "测试执行：E2E 报告来自 playwright test --list（收集清单）应报错退出（未运行不得称通过）",
    expect: 2,
    contains: ["playwright test --list", "请运行：pnpm test:e2e"],
    absent: ["必需前端场景执行门禁通过"],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: listOnlyE2eReportRoot }, ["--e2e"]),
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
    contains: [`E2E 报告：参与判定的文件 ${E2E_EXPECTED_FILES} 个、用例 ${E2E_EXPECTED_CASES} 个`],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: absoluteE2eReportRoot }, ["--e2e"]),
  },
  {
    name: "测试执行：E2E 报告缺 config.rootDir 时按 <root>/e2e 归一应通过",
    expect: 0,
    contains: [`E2E 报告：参与判定的文件 ${E2E_EXPECTED_FILES} 个、用例 ${E2E_EXPECTED_CASES} 个`],
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
    contains: ["Vitest：报告只含 125 个文件，少于要求的 126 个（测试文件被删除或未运行）"],
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
      "E2E：报告只含 6 个文件，少于要求的 7 个（测试文件被删除或未运行）",
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
    name: "测试执行：E2E 静态跳过（expectedStatus=skipped）应报未登记跳过，不得误判为 test.fail()",
    expect: 1,
    contains: ["存在未登记跳过用例", "auth.e2e.ts skipped #1（skipped）"],
    absent: ["预期失败", "少于要求的"],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: staticSkipE2eReportRoot }, ["--e2e"]),
  },
  {
    name: "测试执行：E2E 静态跳过登记进 ALLOWED_SKIPS 后应通过（登记通道生效，旧实现 exit 1）",
    expect: 0,
    contains: ["必需前端场景执行门禁通过"],
    absent: ["预期失败", "存在未登记跳过用例"],
    run: () => runGate(allowedSkipGatePath, { TEST_REPORT_ROOT: staticSkipE2eReportRoot }, ["--e2e"]),
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
  {
    name: "测试执行：移动 project 被移除（报告回落到 5 文件 / 21 实例）应失败",
    expect: 1,
    contains: [
      "E2E 报告：参与判定的文件 6 个、用例 25 个",
      "E2E：必需文件未出现在报告中 e2e/mobile-device.e2e.ts",
      "E2E：报告只含 6 个文件，少于要求的 7 个（测试文件被删除或未运行）",
      "E2E：e2e/auth.e2e.ts 通过 6 个，少于要求的 12 个",
      "E2E：e2e/navigation.e2e.ts 通过 5 个，少于要求的 9 个",
      "E2E：报告未出现配置声明的 project mobile-chromium（project 被删除或改名，移动覆盖丧失不得静默通过）",
      "E2E：e2e/auth.e2e.ts（mobile-chromium）通过 0 个，少于要求的 6 个",
    ],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: e2eDesktopOnlyReportRoot }, ["--e2e"]),
  },
  {
    name: "测试执行：E2E 组合改动稀释 project 覆盖应失败（文件与总通过数不变、旧实现放行）",
    expect: 1,
    contains: [
      "E2E 报告：参与判定的文件 7 个、用例 50 个",
      "E2E：project mobile-chromium 通过 24 个实例，少于棘轮 25 个",
      "E2E：e2e/auth.e2e.ts（mobile-chromium）通过 5 个，少于要求的 6 个",
    ],
    absent: ["少于要求的 12 个", "必需文件未出现在报告中", "整文件跳过"],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: e2eProjectDilutedReportRoot }, ["--e2e"]),
  },
  {
    name: "测试执行：E2E 报告缺 project 维度应失败（fail-closed）",
    expect: 1,
    contains: [
      "报告缺少 project 维度（test.projectName），不得放行",
      "E2E：报告未出现配置声明的 project chromium（project 被删除或改名，移动覆盖丧失不得静默通过）",
      "E2E：e2e/auth.e2e.ts（chromium）通过 0 个，少于要求的 6 个",
    ],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: e2eProjectlessReportRoot }, ["--e2e"]),
  },
  {
    name: "测试执行：E2E 报告出现未登记 project 应失败（fail-closed）",
    expect: 1,
    contains: [
      "E2E：报告出现未登记的 project webkit（新增 project 必须先在此登记）",
      "E2E：报告未出现配置声明的 project mobile-chromium",
    ],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: e2eUnknownProjectReportRoot }, ["--e2e"]),
  },
  {
    name: "测试执行：清单中的单个测试文件被删除应失败（不得只告警）",
    expect: 1,
    contains: ["清单文件不在磁盘上（被删除或改名）", "src/app/deferred-pages-loading.test.tsx"],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: missingListFileReportRoot }),
  },
  {
    name: "测试执行：清单外文件收集期失败应失败（testResults[].status 非 passed）",
    expect: 1,
    contains: [`Vitest：${lastProbeFile} 文件级状态为 failed，收集期失败，断言结果不可信`],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: collectionFailureReportRoot }),
  },
  {
    name: "测试执行：清单外文件整文件跳过应失败（不得只告警）",
    expect: 1,
    contains: [`Vitest：${lastProbeFile} 整文件跳过（1 个用例全部未执行），不得放行`],
    absent: ["跳过告警（未登记在必需清单）"],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: wholeFileSkipReportRoot }),
  },
  {
    name: "测试执行：清单外文件部分跳过仍只告警（不得升级为失败）",
    expect: 0,
    contains: [`跳过告警（未登记在必需清单）：${lastProbeFile}`],
    absent: ["整文件跳过", "文件级状态为"],
    run: () => runGate("check-test-results.mjs", { TEST_REPORT_ROOT: partialSkipReportRoot }),
  },
  {
    name: "node:test：健康报告应通过（清单齐 / 无跳过取消 / 达文件与用例棘轮 / 新鲜且自洽）",
    expect: 0,
    contains: [
      "node:test 执行门禁通过",
      `node:test 报告：参与判定的文件 ${NODE_TEST_PROBE_FILES} 个、用例 ${NODE_TEST_PROBE_CASES} 个`,
    ],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestHealthyRoot }),
  },
  {
    name: "node:test：必需文件未出现在报告中应失败（用例被删除、改名或未运行）",
    expect: 1,
    contains: ["必需文件未出现在报告中 src/shared/lib/usd.test.ts"],
    absent: ["报告可能过期"],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestMissingEntryRoot }),
  },
  {
    name: "node:test：清单中的测试文件被删除应失败（旧报告不得放行）",
    expect: 1,
    contains: [
      "清单文件不在磁盘上（被删除或改名），旧报告不得放行：src/shared/lib/usd.test.ts",
      "请先恢复清单文件：pnpm test",
    ],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestMissingListFileRoot }),
  },
  {
    name: "node:test：清单文件整文件 test.skip 应失败（退出码为 0，旧判定看不到）",
    expect: 1,
    contains: [
      "src/shared/lib/usd.test.ts 整文件跳过（4 个用例全部未执行），不得放行",
      "src/shared/lib/usd.test.ts 通过 0 个，少于要求的 4 个",
      "src/shared/lib/usd.test.ts 存在未登记跳过用例",
    ],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestWholeFileSkipRoot }),
  },
  {
    name: "node:test：describe.skip 让清单文件不再注册用例应失败（报告里该文件 0 用例）",
    expect: 1,
    contains: [
      "src/shared/lib/usd.test.ts 通过 0 个，少于要求的 4 个",
      "src/shared/lib/usd.test.ts 在报告中 0 个用例（收集失败 / 整文件跳过 / 用例被删除），不得放行",
    ],
    absent: ["必需文件未出现在报告中"],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestDescribeSkipRoot }),
  },
  {
    name: "node:test：清单文件部分跳过应失败（清单内不允许未登记跳过）",
    expect: 1,
    contains: ["src/shared/lib/usd.test.ts 存在未登记跳过用例"],
    absent: ["整文件跳过"],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestPartialSkipRoot }),
  },
  {
    name: "node:test：清单文件有用例失败应失败（并给出逐文件原因）",
    expect: 1,
    contains: ["src/shared/lib/usd.test.ts 有 1 个失败用例", "src/shared/lib/usd.test.ts 通过 3 个，少于要求的 4 个"],
    absent: ["报告自洽性校验失败"],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestFailedCaseRoot }),
  },
  {
    name: "node:test：清单文件出现被取消用例应失败（给出逐文件原因）",
    expect: 1,
    contains: ["src/shared/lib/usd.test.ts 有 1 个被取消用例"],
    absent: ["报告自洽性校验失败"],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestCancelledRoot }),
  },
  {
    name: "node:test：清单外文件收集失败应失败（file-root 用例不计入用例数）",
    expect: 1,
    contains: [
      "src/shared/gate-fixture-node.test.ts 收集失败（文件级用例未执行：gate-fixture-node.test.ts），断言结果不可信",
    ],
    absent: ["报告自洽性校验失败"],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestCollectionFailureRoot }),
  },
  {
    name: "node:test：清单外文件整文件跳过应失败（不得只告警）",
    expect: 1,
    contains: ["src/shared/gate-fixture-node.test.ts 整文件跳过（2 个用例全部未执行），不得放行"],
    absent: ["告警（清单外，不影响退出码）"],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestWholeFileSkipFillerRoot }),
  },
  {
    name: "node:test：清单外文件部分跳过仍只告警（不得升级为失败）",
    expect: 0,
    contains: ["告警（清单外，不影响退出码）", "src/shared/gate-fixture-node.test.ts 部分跳过"],
    absent: ["整文件跳过"],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestPartialSkipFillerRoot }),
  },
  {
    name: "node:test：清单外文件有用例失败应失败（旧实现 exit 0）",
    expect: 1,
    contains: ["src/shared/gate-fixture-node.test.ts 有 1 个失败用例"],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestFillerFailedRoot }),
  },
  {
    name: "node:test：清单外文件 0 用例应失败（describe.skip / 用例被删，旧实现 exit 0）",
    expect: 1,
    contains: [
      "src/shared/gate-fixture-node.test.ts 在报告中 0 个用例（收集失败 / 整文件跳过 / 用例被删除），不得放行",
    ],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestFillerEmptyCasesRoot }),
  },
  {
    name: "node:test：NODE_TEST_REPORT_ROOT 指向仓库内路径应被拒绝（exit 2，不得重定向门禁）",
    expect: 2,
    contains: ["拒绝 NODE_TEST_REPORT_ROOT", "只允许指向系统临时目录"],
    absent: ["缺少 node:test 报告"],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestEscapeRoot }),
  },
  {
    name: "node:test：报告早于清单文件 mtime 应失败（过期报告）",
    expect: 1,
    contains: ["报告可能过期", "请重新运行：pnpm test"],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestStaleRoot }),
  },
  {
    name: "node:test：报告缺 startedAt 时改用报告文件 mtime 兜底且仍能判过期",
    expect: 1,
    contains: ["node:test：报告缺少可用时间戳字段，改用报告文件 mtime 兜底", "报告可能过期"],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestNoTimestampRoot }),
  },
  {
    name: "node:test：报告文件缺失应报错退出",
    expect: 2,
    contains: ["缺少 node:test 报告 .artifacts/node-test/results.json，请先运行：pnpm test"],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestMissingReportRoot }),
  },
  {
    name: "node:test：报告形状不可用（缺 run 级汇总）应报错退出（fail-closed）",
    expect: 2,
    contains: ["形状不可用", "缺少 run 级汇总 totals（test:summary）"],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestBadShapeRoot }),
  },
  {
    name: "node:test：报告与 Node run 级汇总不自洽应失败（fail-closed）",
    expect: 1,
    contains: ["报告自洽性校验失败——按用例记录统计的通过数为 126，Node run 级汇总为 127"],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestInconsistentRoot }),
  },
  {
    name: "node:test：清单文件用例被掏空应失败（逐文件 minPassed 棘轮，防逐文件删用例绕过）",
    expect: 1,
    contains: ["src/shared/lib/usd.test.ts 通过 3 个，少于要求的 4 个"],
    absent: ["必需文件未出现在报告中", "磁盘上的 node:test 文件未登记在必需清单中"],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestBelowCasesRoot }),
  },
  {
    name: "node:test：磁盘多出未登记测试文件应失败（关闭「新增后删除」绕过，旧实现 exit 0）",
    expect: 1,
    contains: [
      "磁盘上的 node:test 文件未登记在必需清单中：src/shared/gate-extra-node.test.ts",
      "磁盘上的 node:test 文件 15 个（必须与清单完全相等）",
    ],
    absent: ["必需文件未出现在报告中"],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestUnregisteredFileRoot }),
  },
  {
    name: "node:test：报告 kind 不匹配应报错退出（fail-closed）",
    expect: 2,
    contains: ["形状不可用", 'kind 为 "vitest-json"'],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestWrongKindRoot }),
  },
  {
    name: "node:test：报告 version 不匹配应报错退出（fail-closed）",
    expect: 2,
    contains: ["形状不可用", "version 为 2"],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestWrongVersionRoot }),
  },
  {
    name: "node:test：报告 files 不是数组应报错退出（fail-closed）",
    expect: 2,
    contains: ["形状不可用", "files 不是数组"],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestFilesNotArrayRoot }),
  },
  {
    name: "node:test：报告 JSON 不可解析应报错退出（fail-closed）",
    expect: 2,
    contains: ["无法解析"],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestUnparsableRoot }),
  },
  {
    name: "node:test：清单文件全部不在磁盘上应失败（present.length === 0，旧报告不得放行）",
    expect: 1,
    contains: ["清单文件全部不在磁盘上，无法核对报告新鲜度（旧报告不得放行）"],
    run: () => runGate("check-node-test-results.mjs", { NODE_TEST_REPORT_ROOT: nodeTestNoListFilesRoot }),
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
