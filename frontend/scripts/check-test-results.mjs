#!/usr/bin/env node
/**
 * 测试执行性门禁（AGENTS.md TEST-3 / TEST-5、EVID-1）。
 *
 * 背景：`.github/workflows/ghcr-image.yml` 的 `Assert required integration tests ran` 只解析
 * 后端 Go 测试报告，前端「必需场景确实执行过」没有门禁：用例被删除、被改名为不匹配、
 * 被 `.skip`，或整个报告为空时，CI 仍会绿。
 *
 * 本脚本只做一件事：解析既有运行器产出的原生报告（Vitest JSON / Playwright JSON），
 * 断言必需场景存在、通过且未被跳过。它不启动第二套测试运行器，也不替代任何行为断言。
 *
 * 用法：
 *   node scripts/check-test-results.mjs          # 校验 Vitest 组件/集成报告（需先 pnpm test:ui:coverage）
 *   node scripts/check-test-results.mjs --e2e    # 同时校验 Playwright 全栈 E2E 报告（需先 pnpm test:e2e）
 *
 * 断言五件事：① 清单内文件出现在报告中；② 通过数不少于棘轮 minPassed，且无失败 / 未登记跳过 / flaky
 * （重试后才通过不放行）；③ 清单登记的必填用例标题（requiredTitles，逐字取自真实测试文件的 it/test 名称）出现在
 * 报告中且为 passed；④ 报告内文件总数不少于实测棘轮（防止整体删除测试文件绕过）；⑤ 报告不比清单文件旧
 * （报告开始时间不早于清单文件最新 mtime），避免沿用过期报告假通过。
 *
 * 另有两条文件级失效判定，对清单内外的文件一视同仁、不降级为告警：① Vitest 报告里
 * `testResults[].status !== "passed"`（收集期失败，`assertionResults` 为空——只读用例状态会让整个文件消失）；
 * ② 某文件全部用例都未执行（跳过数 == 用例总数且 > 0），整文件跳过等于该文件对覆盖没有任何贡献。
 *
 * E2E 报告的 `suite.file` / `spec.file` 相对报告自带 `config.rootDir`（Playwright 1.64 等于 testDir）解析，
 * 再相对 frontend/ 归一为 `e2e/xxx.e2e.ts`；`config.rootDir` 缺失时退回 `frontend/e2e`。
 *
 * 环境变量：TEST_REPORT_ROOT 覆盖报告根目录，**只允许指向系统临时目录（os.tmpdir()）之下**，仅供
 * scripts/self-test-gates.mjs 的临时装置使用；本地门禁与 CI 都不设置它。指向 tmp 之外时打印原因并以
 * 退出码 2 拒绝：任何可见的 CI / 包装层改动（workflow env:、脚本前缀）都不得把门禁重定向到伪造的健康报告。
 *
 * 退出码：0 = 通过；1 = 断言失败（缺失/跳过/失败/flaky/数量不足/报告过期）；2 = 报告缺失、不可解析，
 * 或 TEST_REPORT_ROOT 越界被拒绝。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const withE2e = process.argv.includes("--e2e");

/** 已存在路径取 realpath（消除 Windows 短名与符号链接差异）；不存在时原样返回，交由报告读取失败处理。 */
function realPathOrSelf(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

/**
 * 报告与清单文件的根目录：默认 frontend/；TEST_REPORT_ROOT 只允许指向系统临时目录（os.tmpdir()）之下。
 * 限制理由：该覆盖只为 scripts/self-test-gates.mjs 的临时装置存在——它的根目录来自
 * fs.mkdtempSync(path.join(os.tmpdir(), ...))，本地门禁与 CI 都不设置该变量。若允许任意路径，一次可见的
 * CI / 包装层改动就能把门禁指向伪造的健康报告并拿到 exit 0，门禁形同虚设。
 * 判定：覆盖路径（realpath 归一后）不在 tmp 之下 → 打印原因并返回 null，main() 以退出码 2 拒绝、绝不放行。
 * 评审准则（AGENTS.md EVID-1：未运行不得称通过）：门禁不得被外部环境重定向。
 */
function resolveReportRoot() {
  const override = process.env.TEST_REPORT_ROOT;
  if (!override) return frontendDir;
  const resolved = realPathOrSelf(path.resolve(override));
  const tempRoot = realPathOrSelf(os.tmpdir());
  const relative = path.relative(tempRoot, resolved);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return resolved;
  console.error(
    `拒绝 TEST_REPORT_ROOT=${override}：该覆盖只允许指向系统临时目录 ${tempRoot} 之下（仅供 self-test-gates.mjs 的临时装置）；` +
      "门禁不得被外部环境重定向到伪造报告。",
  );
  return null;
}

const reportRoot = resolveReportRoot();
/**
 * 报告内必需文件最小总数（棘轮，防止整体删除测试文件绕过清单 / 标题检查）。
 * 实测值（2026-10-12，本工作树；复现：`pnpm test:ui:coverage && node scripts/check-test-results.mjs`
 * 输出「参与判定的文件 125 个」）：Vitest 125 个（原 123 + 本轮 FE-19-8 新增的 2 个用例文件）。
 * E2E 的计数口径是 **(spec × project) 实例**，不是 spec 文件数：Playwright JSON 把每个 project 各展开一遍，
 * 复现 `pnpm test:e2e && node scripts/check-test-results.mjs --e2e` 输出「参与判定的文件 6 个、用例 42 个」
 * （chromium 21 + mobile-chromium 21；仅断言桌面布局本身成立的用例保留 `@desktop`）。删掉 `mobile-chromium` project
 * 或把它的 `grepInvert` 收窄成 `/./` 后，文件数回落 5、实例数回落 21，必须在这里失败——移动覆盖丧失不得静默通过。
 * 只增不减；确实需要下调时必须是可见改动并说明理由。
 */
const MIN_VITEST_FILES = 125;
const MIN_E2E_FILES = 6;

/**
 * Vitest 组件/集成报告：文件 → 最少通过用例数 + 必填用例标题。新增必需场景必须在此登记。
 * minPassed 是棘轮（ratchet），取实测通过数（2026-10-11 的 .artifacts/vitest/results.json：
 * login 11 / deferred-pages 13 / deferred-pages-loading 7；2026-10-12 新增：
 * i18n/deferred-resources-retry 3 / app/deferred-resources-failure 1），只增不减。
 * requiredTitles 逐字取自对应测试文件的 it() 名称（按包含匹配），必须出现在报告中且为 passed；
 * 用例被删减、改名或跳过时，「少跑用例」是可见改动，而不是静默通过。
 */
const REQUIRED_VITEST = [
  {
    file: "src/features/auth/login-page.test.tsx",
    minPassed: 11,
    requiredTitles: [
      "提供稳定定位、可访问名称、密码管理器语义与键盘顺序",
      "错误凭据显示真实 API 本地化错误、聚焦密码，修正后可以重试",
      "请求中禁用提交，双击、再次点击和密码框 Enter 均不产生重复登录",
      "键盘与粘贴登录保留密码原文，真实解码更新身份和令牌，并替换登录历史",
    ],
  },
  {
    file: "src/app/deferred-pages.test.tsx",
    minPassed: 13,
    requiredTitles: ["StrictMode 双挂载下懒加载仍解析成功，卸载后不残留页面"],
  },
  {
    file: "src/app/deferred-pages-loading.test.tsx",
    minPassed: 7,
    requiredTitles: ["StrictMode 首次挂载、重渲染及重新挂载均复用加载结果，卸载不残留页面"],
  },
  {
    file: "src/shared/i18n/deferred-resources-retry.test.tsx",
    minPassed: 3,
    requiredTitles: [
      "首次加载失败后再次调用会重新请求并成功，不再复用失败态",
      "成功路径连调两次只加载一次资源模块（失败重置不得退化成每次重置）",
    ],
  },
  {
    file: "src/app/deferred-resources-failure.test.tsx",
    minPassed: 1,
    requiredTitles: ["另一条懒加载路由仍能解析并渲染，失败态不被单例永久缓存"],
  },
];

/**
 * Playwright 全栈 E2E 报告：文件 → 最少通过用例数 + 必填用例标题（棘轮，语义同上）。
 * minPassed 同样是 (spec × project) 实例口径（2026-10-12 实测：auth 12 / client-keys 8 / navigation 9 /
 * request-audits 6 / settings 6 / mobile-device 1，共 6 个文件、42 个实例；chromium 21 + mobile-chromium 21）；
 * 移动 project 被移除或收窄后这些数字回落到桌面实例数（auth 6 / client-keys 4 / navigation 5 / request-audits 3 /
 * settings 3，共 21 个实例），必须在门禁上失败。
 * requiredTitles 逐字取自对应 spec 的 test() 名称（按包含匹配）。
 */
const REQUIRED_E2E = [
  {
    file: "e2e/auth.e2e.ts",
    minPassed: 12,
    requiredTitles: [
      "未登录访问受保护路由会被重定向到登录页",
      "正确凭据登录成功、进入受保护页面并在刷新后保持登录",
      "空账号池下推理未就绪，但健康检查与管理 API 可用",
    ],
  },
  {
    file: "e2e/client-keys.e2e.ts",
    minPassed: 8,
    requiredTitles: ["创建密钥：表单校验失败后成功创建并展示一次性明文", "删除密钥：确认后行与真实服务端记录同时消失"],
  },
  {
    file: "e2e/navigation.e2e.ts",
    minPassed: 9,
    requiredTitles: [
      "侧栏导航到账号和设置，深链接刷新后保持页面与当前导航状态",
      "账号菜单切换英文和中文，导航与刷新后仍使用所选语言",
      "375px 登录页与横屏无横向溢出，Tab 和 Enter 可完成真实登录",
    ],
  },
  {
    file: "e2e/request-audits.e2e.ts",
    minPassed: 6,
    requiredTitles: ["状态筛选改变真实查询范围并显示激活计数，清除后恢复空态"],
  },
  {
    file: "e2e/settings.e2e.ts",
    minPassed: 6,
    requiredTitles: ["设置页分页可切换：Grok Build 与 Grok Web 面板按标签显隐"],
  },
  {
    file: "e2e/mobile-device.e2e.ts",
    minPassed: 1,
    requiredTitles: ["移动 project 应用真实设备描述符：hasTouch、isMobile、DPR 与 UA"],
  },
];

/**
 * 允许跳过的用例（必须逐条登记理由，默认空 = 任何跳过都失败）。
 * 记录形如 { file, title, reason }。
 */
const ALLOWED_SKIPS = [];

function readReport(relativePath, command) {
  const reportPath = path.join(reportRoot, relativePath);
  if (!fs.existsSync(reportPath)) {
    console.error(`缺少测试报告 ${relativePath}，请先运行：${command}`);
    return null;
  }
  try {
    return { reportPath, report: JSON.parse(fs.readFileSync(reportPath, "utf8")) };
  } catch (error) {
    console.error(`测试报告 ${relativePath} 无法解析：${error.message}`);
    return null;
  }
}

function toRelative(absolutePath) {
  return path.relative(reportRoot, absolutePath).replaceAll("\\", "/");
}

/** 归一化报告时间戳为 epoch 毫秒：Vitest 的 startTime 是数字，Playwright 的 stats.startTime 是 ISO 8601 字符串。 */
function toEpochMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function formatMs(epochMs) {
  return `${new Date(epochMs).toISOString()}（epoch ${epochMs} ms）`;
}

/**
 * 报告自身的时间戳（epoch 毫秒）。字段缺失或不可解析时退回报告文件 mtime，并打印实际依据，
 * 不允许静默跳过新鲜度检查。
 */
function reportStartMs(label, value, reportPath) {
  const parsed = toEpochMs(value);
  if (parsed !== null) return parsed;
  const fallback = fs.statSync(reportPath).mtimeMs;
  console.warn(`  ${label}：报告缺少可用时间戳字段，改用报告文件 mtime 兜底（${formatMs(fallback)}）`);
  return fallback;
}

/**
 * 新鲜度不变量：报告开始时间必须不早于清单文件的最新 mtime。否则报告可能来自更早的运行，
 * 让被删减或改坏的当前用例沿用旧报告通过。返回失败原因数组。
 */
function checkFreshness({ label, required, startMs, rerunCommand }) {
  const paths = required.map((entry) => path.join(reportRoot, entry.file));
  const present = paths.filter((file) => fs.existsSync(file));
  const absent = paths.filter((file) => !fs.existsSync(file)).map((file) => toRelative(file));
  const failures = [];
  if (absent.length > 0) {
    // 只告警不够：删掉单个清单文件后，旧报告仍满足 requiredTitles，新鲜度又只按剩余文件算 → 静默通过。
    failures.push(
      `${label}：清单文件不在磁盘上（被删除或改名），旧报告不得放行：${absent.join("、")}，请先恢复清单文件：${rerunCommand}`,
    );
  }
  if (present.length === 0) {
    failures.push(
      `${label}：清单文件全部不在磁盘上，无法核对报告新鲜度（旧报告不得放行），请先恢复清单文件或重新运行：${rerunCommand}`,
    );
  }
  const newest = Math.max(...present.map((file) => fs.statSync(file).mtimeMs));
  if (startMs >= newest) return failures;
  failures.push(
    `${label}：报告可能过期——报告开始时间 ${formatMs(startMs)} 早于清单文件最新修改时间 ${formatMs(newest)}，请重新运行：${rerunCommand}`,
  );
  return failures;
}

function emptyTally() {
  return {
    passed: 0,
    failed: 0,
    skipped: 0,
    flaky: 0,
    passedTitles: [],
    failedTitles: [],
    skippedTitles: [],
    flakyTitles: [],
    fileFailures: [],
  };
}

function tallyStatus(tally, status, title) {
  if (status === "passed") {
    tally.passed += 1;
    tally.passedTitles.push(title);
  } else if (status === "failed") {
    tally.failed += 1;
    tally.failedTitles.push(title);
  } else {
    tally.skipped += 1;
    tally.skippedTitles.push(`${title}（${String(status)}）`);
  }
}

/**
 * Vitest JSON：文件级结果 `testResults[].status` 与用例级结果 `testResults[].assertionResults[].status`。
 * 收集期失败（如导入报错）产出 `status: "failed"` 且 `assertionResults` 为空，只读用例状态会让整个文件消失。
 */
function summarizeVitest(report) {
  const files = new Map();
  for (const result of report.testResults ?? []) {
    const file = toRelative(result.name);
    const tally = files.get(file) ?? emptyTally();
    // fail-closed：status 缺失同样视为文件级失效，不放行无法解释的报告。
    if (result.status !== "passed") {
      tally.fileFailures.push(`文件级状态为 ${result.status ?? "缺失"}，收集期失败，断言结果不可信`);
    }
    for (const assertion of result.assertionResults ?? []) {
      tallyStatus(tally, assertion.status, assertion.fullName ?? assertion.title ?? "");
    }
    files.set(file, tally);
  }
  return files;
}

/**
 * Playwright 报告里 `suite.file` / `spec.file` 相对 `config.rootDir` 解析：1.64 的 rootDir 等于
 * testDir（frontend/e2e），取值是纯文件名（"auth.e2e.ts"）。缺 rootDir 时按约定退回 <reportRoot>/e2e。
 */
function playwrightBaseDir(report) {
  const rootDir = report.config?.rootDir;
  return typeof rootDir === "string" && rootDir.length > 0 ? path.resolve(rootDir) : path.join(reportRoot, "e2e");
}

/** 归一为相对 reportRoot 的路径；绝对路径形态直接使用（不因 rootDir 缺失退化）。 */
function normalizeSpecFile(baseDir, specFile) {
  const target = specFile ?? "";
  return path.isAbsolute(target) ? toRelative(target) : toRelative(path.resolve(baseDir, target));
}

/** Playwright JSON：suites 递归，spec.tests[].status ∈ expected|unexpected|flaky|skipped。 */
function walkPlaywrightSuites(suites, files, baseDir) {
  for (const suite of suites ?? []) {
    walkPlaywrightSuites(suite.suites, files, baseDir);
    for (const spec of suite.specs ?? []) {
      const file = normalizeSpecFile(baseDir, spec.file);
      const tally = files.get(file) ?? emptyTally();
      const tests = spec.tests ?? [];
      const statuses = tests.map((test) => test.status ?? "");
      // Playwright 把「正常通过」与「test.fail() 预期失败且真的失败」都记为 status="expected"，
      // 区别只在 expectedStatus（前者 "passed"、后者 "failed"）。只读 status 会让被标记为预期失败的
      // 必需场景整段失效却仍计为通过，因此这里显式判失败。
      const expectedFailure = tests.some((test) => (test.expectedStatus ?? "passed") !== "passed");
      if (expectedFailure) {
        tally.failed += 1;
        tally.failedTitles.push(`${spec.title}（被标记为预期失败 test.fail()，不得用于必需场景）`);
      } else if (statuses.includes("unexpected")) {
        tally.failed += 1;
        tally.failedTitles.push(spec.title);
      } else if (statuses.includes("flaky")) {
        tally.flaky += 1;
        tally.flakyTitles.push(`${spec.title}（flaky：重试后才通过）`);
      } else if (statuses.includes("skipped")) {
        tally.skipped += 1;
        tally.skippedTitles.push(`${spec.title}（skipped）`);
      } else if (statuses.length > 0 && statuses.every((status) => status === "expected")) {
        tally.passed += 1;
        tally.passedTitles.push(spec.title);
      } else {
        // 未知状态 fail-closed（与 Vitest 分支同一口径）：宁可失败，也不放行无法解释的报告。
        tally.failed += 1;
        tally.failedTitles.push(`${spec.title}（未知状态 ${statuses.join("|") || "空"}，不得放行）`);
      }
      files.set(file, tally);
    }
  }
  return files;
}

function isAllowedSkip(file, title) {
  return ALLOWED_SKIPS.some((entry) => entry.file === file && title.includes(entry.title));
}

/**
 * 必填用例标题断言：清单登记的标题必须出现在报告中且状态为 passed。
 * 标题做包含匹配（Vitest 的 fullName 带 describe 前缀、Playwright 用 spec.title），
 * 已存在但未通过时给出实际状态，避免只报「缺失」掩盖真实原因。
 */
function missingRequiredTitles(label, file, tally, requiredTitles) {
  const failures = [];
  const unpassedTitles = [...tally.failedTitles, ...tally.flakyTitles, ...tally.skippedTitles];
  for (const title of requiredTitles ?? []) {
    if (tally.passedTitles.some((observed) => observed.includes(title))) continue;
    const unpassed = unpassedTitles.find((observed) => observed.includes(title));
    failures.push(
      `${label}：${file} 必填用例「${title}」${unpassed ? `未通过：${unpassed}` : "不在报告中（被删除、改名或未运行）"}`,
    );
  }
  return failures;
}

/**
 * 逐文件断言：存在、通过数足够、必填用例标题通过、无失败、无未登记跳过；并做文件级失效判定
 * （清单内外的文件一视同仁，不得降级为告警）；返回失败原因数组。
 */
function checkRequired(label, files, required) {
  const failures = [];
  const skippedOutsideRequired = [];
  for (const { file, minPassed, requiredTitles } of required) {
    const tally = files.get(file);
    if (!tally) {
      failures.push(`${label}：必需文件未出现在报告中 ${file}（用例被删除、改名或未运行）`);
      continue;
    }
    if (tally.passed < minPassed) {
      failures.push(`${label}：${file} 通过 ${tally.passed} 个，少于要求的 ${minPassed} 个`);
    }
    failures.push(...missingRequiredTitles(label, file, tally, requiredTitles));
    if (tally.failed > 0) {
      // 失败标题必须一并打印：否则「预期失败 test.fail() 被计为失败」与「普通失败」在输出上不可区分，
      // 夹具也就无法对判定原因做断言。
      failures.push(`${label}：${file} 有 ${tally.failed} 个失败用例：${tally.failedTitles.join("、")}`);
    }
    const unregistered = tally.skippedTitles.filter((title) => !isAllowedSkip(file, title));
    if (unregistered.length > 0) {
      failures.push(`${label}：${file} 存在未登记跳过用例 ${unregistered.join("、")}`);
    }
  }
  for (const [file, tally] of files) {
    // 文件级失效同样对清单外的文件生效：否则删掉清单外的用例文件、或把某个文件整体跳过，都不留痕迹。
    for (const reason of tally.fileFailures) failures.push(`${label}：${file} ${reason}`);
    const fileCases = tally.passed + tally.failed + tally.skipped + tally.flaky;
    const wholeFileSkipped = fileCases > 0 && tally.skipped === fileCases;
    if (wholeFileSkipped) {
      failures.push(`${label}：${file} 整文件跳过（${fileCases} 个用例全部未执行），不得放行`);
    }
    const registered = required.some((entry) => entry.file === file);
    const allowlisted = ALLOWED_SKIPS.some((entry) => entry.file === file);
    // 只有「部分跳过」才降级为告警；整文件跳过已计入失败，不重复告警。
    if (tally.skipped > 0 && !wholeFileSkipped && !registered && !allowlisted) {
      skippedOutsideRequired.push(`${file}：${tally.skippedTitles.join("、")}`);
    }
  }
  return { failures, skippedOutsideRequired };
}

function totalsOf(files) {
  const totals = emptyTally();
  for (const tally of files.values()) {
    totals.passed += tally.passed;
    totals.failed += tally.failed;
    totals.skipped += tally.skipped;
    totals.flaky += tally.flaky;
  }
  return totals;
}

/** 参与判定的用例数（通过 + 失败 + 跳过 + flaky）。 */
function totalCases(totals) {
  return totals.passed + totals.failed + totals.skipped + totals.flaky;
}

/** 收集所有文件的 flaky 用例（重试后才通过），用于失败原因与汇总。 */
function flakyEntries(files) {
  const rows = [];
  for (const [file, tally] of files) {
    for (const title of tally.flakyTitles) rows.push(`${file}：${title}`);
  }
  return rows;
}

/**
 * 单份报告的完整断言：清单命中 + 棘轮通过数 + 必填用例标题 + 报告文件总数下限 + 无未登记跳过 + 无 flaky +
 * 无文件级失效（收集期失败 / 整文件跳过）+ 报告新鲜度。
 * `totals` 与 `fileCount` 供汇总行自证门禁不是空转。
 */
function checkReport({ label, files, required, minimumFiles, startMs, rerunCommand }) {
  const check = checkRequired(label, files, required);
  const totals = totalsOf(files);
  const failures = [...check.failures];
  if (files.size < minimumFiles) {
    failures.push(`${label}：报告只含 ${files.size} 个文件，少于要求的 ${minimumFiles} 个（测试文件被删除或未运行）`);
  }
  failures.push(...checkFreshness({ label, required, startMs, rerunCommand }));
  const flaky = flakyEntries(files);
  if (flaky.length > 0) {
    failures.push(`${label}：${flaky.length} 个用例重试后才通过（flaky），禁止以重试掩盖缺陷：${flaky.join("、")}`);
  }
  if (totals.passed === 0) failures.push(`${label}：报告内没有任何通过用例，门禁不可信`);
  return { failures, warnings: check.skippedOutsideRequired, totals, fileCount: files.size };
}

/**
 * 汇总行：参与判定的文件数 / 用例数 + 各状态计数。对照 REV-3 的「参与判定的作用域 N 个」，
 * 用非零规模证明门禁不是空转。
 */
function logReport({ label, fileCount, totals, startMs }) {
  console.log(
    `${label} 报告：参与判定的文件 ${fileCount} 个、用例 ${totalCases(totals)} 个（通过 ${totals.passed}、` +
      `失败 ${totals.failed}、跳过 ${totals.skipped}、flaky ${totals.flaky}），报告开始时间 ${formatMs(startMs)}`,
  );
}

function main() {
  // TEST_REPORT_ROOT 越界已被 resolveReportRoot 拒绝：不读取任何报告，直接以退出码 2 失败。
  if (reportRoot === null) return 2;
  const vitestRun = readReport(".artifacts/vitest/results.json", "pnpm test:ui:coverage");
  if (vitestRun === null) return 2;
  const failures = [];
  const warnings = [];

  const vitestFiles = summarizeVitest(vitestRun.report);
  const vitestStartMs = reportStartMs("Vitest", vitestRun.report.startTime, vitestRun.reportPath);
  const vitest = checkReport({
    label: "Vitest",
    files: vitestFiles,
    required: REQUIRED_VITEST,
    minimumFiles: MIN_VITEST_FILES,
    startMs: vitestStartMs,
    rerunCommand: "pnpm test:ui:coverage",
  });
  failures.push(...vitest.failures);
  warnings.push(...vitest.warnings);

  let e2e = null;
  let e2eStartMs = null;
  if (withE2e) {
    const e2eRun = readReport(".artifacts/playwright/results.json", "pnpm test:e2e");
    if (e2eRun === null) return 2;
    const e2eFiles = walkPlaywrightSuites(e2eRun.report.suites, new Map(), playwrightBaseDir(e2eRun.report));
    e2eStartMs = reportStartMs("E2E", e2eRun.report.stats?.startTime, e2eRun.reportPath);
    e2e = checkReport({
      label: "E2E",
      files: e2eFiles,
      required: REQUIRED_E2E,
      minimumFiles: MIN_E2E_FILES,
      startMs: e2eStartMs,
      rerunCommand: "pnpm test:e2e",
    });
    failures.push(...e2e.failures);
    warnings.push(...e2e.warnings);
  }

  logReport({ label: "Vitest", fileCount: vitest.fileCount, totals: vitest.totals, startMs: vitestStartMs });
  if (e2e !== null && e2eStartMs !== null) {
    logReport({ label: "E2E", fileCount: e2e.fileCount, totals: e2e.totals, startMs: e2eStartMs });
  }
  for (const warning of warnings) console.warn(`  跳过告警（未登记在必需清单）：${warning}`);

  if (failures.length > 0) {
    console.error(`\n必需前端场景执行门禁失败 ${failures.length} 项：`);
    for (const failure of failures) console.error(`  - ${failure}`);
    return 1;
  }
  console.log("必需前端场景执行门禁通过：清单内用例均已运行、通过、未跳过且无 flaky。");
  return 0;
}

process.exit(main());
