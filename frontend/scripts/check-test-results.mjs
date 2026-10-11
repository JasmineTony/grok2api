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
 * 断言三件事：① 清单内文件出现在报告中；② 通过数不少于棘轮 minPassed，且无失败 / 未登记跳过 / flaky
 * （重试后才通过不放行）；③ 报告不比清单文件旧（报告开始时间不早于清单文件最新 mtime），避免沿用过期报告假通过。
 *
 * E2E 报告的 `suite.file` / `spec.file` 相对报告自带 `config.rootDir`（Playwright 1.64 等于 testDir）解析，
 * 再相对 frontend/ 归一为 `e2e/xxx.e2e.ts`；`config.rootDir` 缺失时退回 `frontend/e2e`。
 *
 * 环境变量：TEST_REPORT_ROOT 覆盖报告根目录，**仅供 scripts/self-test-gates.mjs 的临时装置使用**。
 * 本地门禁与 CI 都不设置它（默认 frontend/），它不是绕过门禁的开关。
 *
 * 退出码：0 = 通过；1 = 断言失败（缺失/跳过/失败/flaky/数量不足/报告过期）；2 = 报告缺失或不可解析。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** 报告与清单文件的根目录；默认 frontend/，TEST_REPORT_ROOT 只供 self-test-gates.mjs 的临时装置注入。 */
const reportRoot = process.env.TEST_REPORT_ROOT ? path.resolve(process.env.TEST_REPORT_ROOT) : frontendDir;
const withE2e = process.argv.includes("--e2e");
/**
 * Vitest 组件/集成报告：文件 → 最少通过用例数。新增必需场景必须在此登记。
 * minPassed 是棘轮（ratchet），取实测通过数（2026-10-11 的 .artifacts/vitest/results.json：
 * login 11 / deferred-pages 13 / deferred-pages-loading 7），只增不减。
 * 用例被删减或改写导致通过数下降时，必须在本文件显式下调该数字：让「少跑用例」是可见改动，而不是静默通过。
 */
const REQUIRED_VITEST = [
  { file: "src/features/auth/login-page.test.tsx", minPassed: 11 },
  { file: "src/app/deferred-pages.test.tsx", minPassed: 13 },
  { file: "src/app/deferred-pages-loading.test.tsx", minPassed: 7 },
];

/**
 * Playwright 全栈 E2E 报告：文件 → 最少通过用例数（棘轮，语义同上）。
 * 计数口径为 spec 内 test() 实测（2026-10-11：auth 6 / client-keys 4 / navigation 5 / request-audits 3 / settings 3）。
 */
const REQUIRED_E2E = [
  { file: "e2e/auth.e2e.ts", minPassed: 6 },
  { file: "e2e/client-keys.e2e.ts", minPassed: 4 },
  { file: "e2e/navigation.e2e.ts", minPassed: 5 },
  { file: "e2e/request-audits.e2e.ts", minPassed: 3 },
  { file: "e2e/settings.e2e.ts", minPassed: 3 },
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
  if (absent.length > 0) {
    console.warn(`  ${label}：清单文件不在磁盘上，未参与新鲜度核对：${absent.join("、")}`);
  }
  if (present.length === 0) {
    console.warn(`  ${label}：清单文件全部不在磁盘上，无法核对报告新鲜度`);
    return [];
  }
  const newest = Math.max(...present.map((file) => fs.statSync(file).mtimeMs));
  if (startMs >= newest) return [];
  return [
    `${label}：报告可能过期——报告开始时间 ${formatMs(startMs)} 早于清单文件最新修改时间 ${formatMs(newest)}，请重新运行：${rerunCommand}`,
  ];
}

function emptyTally() {
  return { passed: 0, failed: 0, skipped: 0, flaky: 0, skippedTitles: [], flakyTitles: [] };
}

function tallyStatus(tally, status, title) {
  if (status === "passed") tally.passed += 1;
  else if (status === "failed") tally.failed += 1;
  else {
    tally.skipped += 1;
    tally.skippedTitles.push(`${title}（${String(status)}）`);
  }
}

/** Vitest JSON：testResults[].assertionResults[].status。 */
function summarizeVitest(report) {
  const files = new Map();
  for (const result of report.testResults ?? []) {
    const tally = files.get(toRelative(result.name)) ?? emptyTally();
    for (const assertion of result.assertionResults ?? []) {
      tallyStatus(tally, assertion.status, assertion.fullName ?? assertion.title ?? "");
    }
    files.set(toRelative(result.name), tally);
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
      const statuses = (spec.tests ?? []).flatMap((test) => test.status ?? []);
      if (statuses.includes("unexpected")) tally.failed += 1;
      else if (statuses.includes("flaky")) {
        tally.flaky += 1;
        tally.flakyTitles.push(`${spec.title}（flaky：重试后才通过）`);
      } else if (statuses.includes("skipped")) {
        tally.skipped += 1;
        tally.skippedTitles.push(`${spec.title}（skipped）`);
      } else if (statuses.length > 0) tally.passed += 1;
      files.set(file, tally);
    }
  }
  return files;
}

function isAllowedSkip(file, title) {
  return ALLOWED_SKIPS.some((entry) => entry.file === file && title.includes(entry.title));
}

/** 逐文件断言：存在、通过数足够、无失败、无未登记跳过；返回失败原因数组。 */
function checkRequired(label, files, required) {
  const failures = [];
  const skippedOutsideRequired = [];
  for (const { file, minPassed } of required) {
    const tally = files.get(file);
    if (!tally) {
      failures.push(`${label}：必需文件未出现在报告中 ${file}（用例被删除、改名或未运行）`);
      continue;
    }
    if (tally.passed < minPassed) {
      failures.push(`${label}：${file} 通过 ${tally.passed} 个，少于要求的 ${minPassed} 个`);
    }
    if (tally.failed > 0) failures.push(`${label}：${file} 有 ${tally.failed} 个失败用例`);
    const unregistered = tally.skippedTitles.filter((title) => !isAllowedSkip(file, title));
    if (unregistered.length > 0) {
      failures.push(`${label}：${file} 存在未登记跳过用例 ${unregistered.join("、")}`);
    }
  }
  for (const [file, tally] of files) {
    const registered = required.some((entry) => entry.file === file);
    const allowlisted = ALLOWED_SKIPS.some((entry) => entry.file === file);
    if (tally.skipped > 0 && !registered && !allowlisted) {
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
 * 单份报告的完整断言：清单命中 + 棘轮通过数 + 无未登记跳过 + 无 flaky + 报告新鲜度。
 * `totals` 与 `fileCount` 供汇总行自证门禁不是空转。
 */
function checkReport({ label, files, required, startMs, rerunCommand }) {
  const check = checkRequired(label, files, required);
  const totals = totalsOf(files);
  const failures = [...check.failures, ...checkFreshness({ label, required, startMs, rerunCommand })];
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
