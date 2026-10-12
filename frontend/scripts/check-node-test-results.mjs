#!/usr/bin/env node
/**
 * node:test 执行性门禁（AGENTS.md TEST-1/TEST-4、EVID-1）。
 *
 * 背景：`pnpm test` 的 node:test 运行器只靠退出码判定。整文件 `test.skip` / `describe.skip`（用例不再注册）、
 * `test.todo`、测试文件被删除、把上一次运行报告当成当前结果——这些都不会让退出码变红，用例数与文件数只要
 * 不为 0 就不会被任何门禁发现；check-test-results.mjs 只解析 Vitest 与 Playwright 报告，node:test 侧是盲区。
 *
 * 本脚本只做一件事：解析 `pnpm test` 产出的原生 JSON 报告（.artifacts/node-test/results.json，由
 * scripts/node-test-json-reporter.mjs 通过 Node 官方 reporter API 写出），断言必需文件与用例真的执行过。
 * 它不启动第二套测试运行器，也不替代任何行为断言。
 *
 * 断言：
 * ① 报告新鲜度：报告开始时间不早于清单文件最新 mtime（报告缺时间戳时改用报告文件 mtime 兜底并打印依据），
 *    且清单文件必须仍存在于磁盘——文件被删除或改名时旧报告不得放行；
 * ② 清单内文件逐个出现在报告中，通过数不少于棘轮 minPassed，且无未登记跳过；
 * ③ 报告内任何文件（清单内外一视同仁）的失败 / 被取消用例，任何 `cases` 为空的文件（收集失败 /
 *    describe.skip / 用例被删除）、整文件跳过（用例数 > 0 且全部跳过）与「收集失败」（Node 在文件级
 *    失败时合成的 file-root 用例）→ 失败；
 * ④ 磁盘上的 node:test 文件集合必须与清单完全相等：少一个（被删除/改名/漏登记）或多一个（新增后删除
 *    即可静默绕过的未登记文件）都失败——不再用「文件/用例总数下限」这种派生重复值表达同一条规则；
 * ⑤ 报告自洽性：按用例记录统计出的通过/失败/跳过/取消数与 Node 自己的 run 级汇总（test:summary）
 *    必须一致；不一致说明 reporter 的解析口径与真实运行不符，fail-closed。
 * 清单外的文件部分跳过、存在 test.todo → 只告警（test.todo 由 minPassed 棘轮挡住用例被掏空）。
 *
 * 环境变量：NODE_TEST_REPORT_ROOT 覆盖报告根目录，**只允许指向系统临时目录（os.tmpdir()）之下**，仅供
 * scripts/self-test-gates.mjs 的临时装置使用。本地门禁与 CI 都不设置它；指向 tmp 之外时打印原因并以
 * 退出码 2 拒绝：任何可见的 CI / 包装层改动都不得把门禁重定向到伪造的健康报告。
 *
 * 退出码：0 = 通过；1 = 断言失败（缺失/跳过/取消/失败/数量不足/报告过期/报告不自洽）；
 * 2 = 报告缺失、不可解析、形状或版本不匹配、缺少 run 级汇总，或 NODE_TEST_REPORT_ROOT 越界被拒绝。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 已存在路径取 realpath（消除 Windows 短名与符号链接差异）；不存在时原样返回，交由报告读取失败处理。 */
function realPathOrSelf(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

/**
 * 报告与清单文件的根目录：默认 frontend/；NODE_TEST_REPORT_ROOT 只允许指向系统临时目录（os.tmpdir()）之下。
 * 限制理由与 scripts/check-test-results.mjs 的 TEST_REPORT_ROOT 同一口径：该覆盖只为
 * scripts/self-test-gates.mjs 的临时装置存在（根目录来自 fs.mkdtempSync(path.join(os.tmpdir(), ...))），
 * 本地门禁与 CI 都不设置它。若允许任意路径，一次可见的 CI / 包装层改动就能把门禁指向伪造的健康报告并拿到
 * exit 0，门禁形同虚设（AGENTS.md EVID-1：未运行不得称通过）。
 * 判定：覆盖路径（realpath 归一后）不在 tmp 之下 → 打印原因并返回 null，main() 以退出码 2 拒绝、绝不放行。
 */
function resolveReportRoot() {
  const override = process.env.NODE_TEST_REPORT_ROOT;
  if (!override) return frontendDir;
  const resolved = realPathOrSelf(path.resolve(override));
  const tempRoot = realPathOrSelf(os.tmpdir());
  const relative = path.relative(tempRoot, resolved);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return resolved;
  console.error(
    `拒绝 NODE_TEST_REPORT_ROOT=${override}：该覆盖只允许指向系统临时目录 ${tempRoot} 之下（仅供 self-test-gates.mjs 的临时装置）；` +
      "门禁不得被外部环境重定向到伪造报告。",
  );
  return null;
}

const reportRoot = resolveReportRoot();
const REPORT_PATH = ".artifacts/node-test/results.json";
const RERUN_COMMAND = "pnpm test";

/**
 * 磁盘枚举根：与 package.json 的 test 脚本 `--test "src/**\/*.test.ts" "scripts/**\/*.test.ts"` 一致，
 * 只有这两棵树里的 `.test.ts` 会被 node:test 运行。
 */
const TEST_GLOB_ROOTS = ["src", "scripts"];

/**
 * 必需文件清单：`pnpm test` 的 `--test "src/**\/*.test.ts" "scripts/**\/*.test.ts"` 覆盖到的全部文件
 * （2026-10-12 实测存在的 14 个 node:test 文件，逐个取自报告，不是估算）。
 * minPassed 是逐文件通过数棘轮，取同一次实测的通过数；用例被删减、改名或跳过时这里必须失败，
 * 缩减数字属于可见改动，需在改动说明中给出理由。
 * 本清单同时是「磁盘上存在哪些 node:test 文件」的唯一事实来源：新增文件必须同步登记，删除文件必须同步
 * 删除条目，否则 checkDiskTestFiles 会因集合不等而失败（多一个少一个都不放行）。
 */
const REQUIRED_NODE_TESTS = [
  { file: "scripts/build-inputs.test.ts", minPassed: 49 },
  { file: "scripts/build-manifest-plugin.test.ts", minPassed: 9 },
  { file: "src/features/audits/audit-detail-format.test.ts", minPassed: 11 },
  { file: "src/features/audits/audit-format.test.ts", minPassed: 8 },
  { file: "src/features/audits/audit-usage.test.ts", minPassed: 7 },
  { file: "src/features/dashboard/dashboard-activity-format.test.ts", minPassed: 5 },
  { file: "src/features/dashboard/dashboard-provider-format.test.ts", minPassed: 6 },
  { file: "src/features/dashboard/dashboard-trend-buckets.test.ts", minPassed: 5 },
  { file: "src/features/dashboard/dashboard-trend-series.test.ts", minPassed: 4 },
  { file: "src/features/docs/api-docs-examples.test.ts", minPassed: 8 },
  { file: "src/features/media/media-format.test.ts", minPassed: 5 },
  { file: "src/features/quality-guard/quality-guard-query.test.ts", minPassed: 3 },
  { file: "src/shared/lib/format.test.ts", minPassed: 2 },
  { file: "src/shared/lib/usd.test.ts", minPassed: 4 },
];

/**
 * 允许跳过的用例（必须逐条登记理由，默认空 = 任何跳过都失败）。
 * 记录形如 { file, title, reason }。
 */
const ALLOWED_SKIPS = [];

const REPORT_KIND = "node-test-json";
const REPORT_VERSION = 1;

function toRelative(absolutePath) {
  return path.relative(reportRoot, absolutePath).replaceAll("\\", "/");
}

function normalizeReportPath(file) {
  return String(file).replaceAll("\\", "/");
}

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
 * 报告时间戳（epoch 毫秒）。startedAt 缺失或不可解析时退回报告文件 mtime，并打印实际依据，
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
 * 读报告并做 fail-closed 形状校验：缺文件、JSON 解析失败、kind/version 不匹配、files 非数组、
 * 缺少 run 级汇总（test:summary）时返回 null（调用方退出码 2），不放行无法解释的报告。
 */
function readReport(relativePath) {
  const reportPath = path.join(reportRoot, relativePath);
  if (!fs.existsSync(reportPath)) {
    console.error(`缺少 node:test 报告 ${relativePath}，请先运行：${RERUN_COMMAND}`);
    return null;
  }
  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch (error) {
    console.error(`node:test 报告 ${relativePath} 无法解析：${error.message}`);
    return null;
  }
  const problems = [];
  if (report?.kind !== REPORT_KIND) problems.push(`kind 为 ${JSON.stringify(report?.kind ?? null)}`);
  if (report?.version !== REPORT_VERSION) problems.push(`version 为 ${JSON.stringify(report?.version ?? null)}`);
  if (!Array.isArray(report?.files)) problems.push("files 不是数组");
  if (typeof report?.totals?.tests !== "number") problems.push("缺少 run 级汇总 totals（test:summary）");
  if (problems.length > 0) {
    console.error(
      `node:test 报告 ${relativePath} 形状不可用（${problems.join("；")}），先重新运行 ${RERUN_COMMAND}，` +
        `不要沿用无法解释的报告。`,
    );
    return null;
  }
  return { reportPath, report };
}

/**
 * 新鲜度不变量：报告开始时间必须不早于清单文件的最新 mtime，且清单文件都还在磁盘上。
 * 否则报告可能来自更早的运行，让被删减或改坏的当前用例沿用旧报告通过。
 */
function checkFreshness({ label, required, startMs }) {
  const paths = required.map((entry) => path.join(reportRoot, entry.file));
  const present = paths.filter((file) => fs.existsSync(file));
  const absent = paths.filter((file) => !fs.existsSync(file)).map((file) => toRelative(file));
  const failures = [];
  if (absent.length > 0) {
    // 只告警不够：删掉单个清单文件后，旧报告仍满足其余断言，新鲜度又只按剩余文件算 → 静默通过。
    failures.push(
      `${label}：清单文件不在磁盘上（被删除或改名），旧报告不得放行：${absent.join("、")}，请先恢复清单文件：${RERUN_COMMAND}`,
    );
  }
  if (present.length === 0) {
    failures.push(
      `${label}：清单文件全部不在磁盘上，无法核对报告新鲜度（旧报告不得放行），请先恢复清单文件：${RERUN_COMMAND}`,
    );
    return failures;
  }
  const newest = Math.max(...present.map((file) => fs.statSync(file).mtimeMs));
  if (startMs >= newest) return failures;
  failures.push(
    `${label}：报告可能过期——报告开始时间 ${formatMs(startMs)} 早于清单文件最新修改时间 ${formatMs(newest)}，` +
      `请重新运行：${RERUN_COMMAND}`,
  );
  return failures;
}

/** 递归枚举目录下的 `.test.ts`（跳过 node_modules），路径按 reportRoot 归一为相对正斜杠路径。 */
function collectTestFiles(dir, found) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") collectTestFiles(path.join(dir, entry.name), found);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.ts")) found.push(toRelative(path.join(dir, entry.name)));
  }
}

/**
 * 磁盘测试文件集合与清单必须完全相等（AGENTS.md CHG-6：同一模式必须全量覆盖，不做局部判定）。
 * 理由：清单是逐文件 minPassed 的唯一来源，`MIN_NODE_TEST_FILES` / `MIN_NODE_TEST_CASES` 只是它的派生
 * 重复值（且只在 checkRequired 已失败时才触发）；而「新增一个不受约束的清单外文件 → 再整体删除」在只有
 * 清单判定的实现下完全静默。要求集合相等后，多一个少一个都必须显式登记或删除清单条目。
 */
function checkDiskTestFiles(label, required) {
  const found = [];
  for (const sub of TEST_GLOB_ROOTS) collectTestFiles(path.join(reportRoot, sub), found);
  const onDisk = [...new Set(found)].sort();
  const expected = required.map((entry) => entry.file).sort();
  const missing = expected.filter((file) => !onDisk.includes(file));
  const unregistered = onDisk.filter((file) => !expected.includes(file));
  const failures = [];
  if (missing.length > 0) {
    failures.push(
      `${label}：必需清单中的 node:test 文件不在磁盘上：${missing.join("、")}（被删除或改名；` +
        `磁盘与清单必须完全相等，请恢复文件或同步清单：${RERUN_COMMAND}）`,
    );
  }
  if (unregistered.length > 0) {
    failures.push(
      `${label}：磁盘上的 node:test 文件未登记在必需清单中：${unregistered.join("、")}（新增文件必须同步登记` +
        ` REQUIRED_NODE_TESTS，否则「新增后再删除」可以静默绕过棘轮）`,
    );
  }
  return { failures, diskCount: onDisk.length };
}
function emptyTally() {
  return {
    passed: 0,
    failed: 0,
    skipped: 0,
    todo: 0,
    cancelled: 0,
    passedTitles: [],
    failedTitles: [],
    skippedTitles: [],
    cancelledTitles: [],
    todoTitles: [],
    collectionFailures: [],
    /** 报告里该文件原始 cases 条目数（含 file-root 收集失败条目），用于识别「0 用例」的文件。 */
    caseEntries: 0,
  };
}

/**
 * 逐用例记入状态计数。未知状态 fail-closed（按失败计），不放行无法解释的报告。
 * `kind: "file-root"` 是 Node 在文件级失败（导入/收集报错）时合成的、以文件名为用例名的事件，
 * 不计入用例数，只标记收集失败。
 */
function tallyCase(tally, item) {
  const name = typeof item?.name === "string" ? item.name : "";
  if (item?.kind === "file-root") {
    if (item.status !== "passed") tally.collectionFailures.push(name || item.status);
    return;
  }
  if (item?.status === "passed") {
    tally.passed += 1;
    tally.passedTitles.push(name);
    return;
  }
  if (item?.status === "failed") {
    tally.failed += 1;
    tally.failedTitles.push(name);
    return;
  }
  if (item?.status === "skipped") {
    tally.skipped += 1;
    tally.skippedTitles.push(name);
    return;
  }
  if (item?.status === "cancelled") {
    tally.cancelled += 1;
    tally.cancelledTitles.push(name);
    return;
  }
  if (item?.status === "todo") {
    tally.todo += 1;
    tally.todoTitles.push(name);
    return;
  }
  // 未知状态 fail-closed：宁可失败，也不让无法解释的报告通过。
  tally.failed += 1;
  tally.failedTitles.push(`${name}（未知状态 ${String(item?.status)}，不得放行）`);
}

function summarize(report) {
  const files = new Map();
  for (const entry of report.files) {
    const file = normalizeReportPath(entry.file);
    const tally = files.get(file) ?? emptyTally();
    const cases = entry.cases ?? [];
    tally.caseEntries += cases.length;
    for (const item of cases) tallyCase(tally, item);
    files.set(file, tally);
  }
  return files;
}

function isAllowedSkip(file, title) {
  return ALLOWED_SKIPS.some((entry) => entry.file === file && title.includes(entry.title));
}

/** 参与判定的用例数（通过 + 失败 + 跳过 + 取消 + todo）。 */
function caseCount(tally) {
  return tally.passed + tally.failed + tally.skipped + tally.cancelled + tally.todo;
}

/** 逐清单文件断言：出现在报告中、通过数达棘轮、无未登记跳过。失败/取消/零用例由 checkFileFailures 统一判定。 */
function checkRequired(label, files, required) {
  const failures = [];
  for (const { file, minPassed } of required) {
    const tally = files.get(file);
    if (!tally) {
      failures.push(`${label}：必需文件未出现在报告中 ${file}（用例被删除、改名或未运行）`);
      continue;
    }
    if (tally.passed < minPassed) {
      failures.push(`${label}：${file} 通过 ${tally.passed} 个，少于要求的 ${minPassed} 个`);
    }
    const unregistered = tally.skippedTitles.filter((title) => !isAllowedSkip(file, title));
    if (unregistered.length > 0) {
      failures.push(`${label}：${file} 存在未登记跳过用例 ${unregistered.join("、")}`);
    }
  }
  return failures;
}

/**
 * 文件级失效判定（清单内外一视同仁）：收集失败、失败用例、被取消用例、整文件跳过、报告里 0 用例。
 * 只按清单文件判定会让清单外文件成为逃生口：14 个清单文件刚好达标时，清单外文件的 failed 用例
 * 既不算失败也不告警（旧实现 exit 0），`describe.skip` 让清单外文件 `cases: []` 时同样静默。
 */
function checkFileFailures(label, files, required) {
  const failures = [];
  const warnings = [];
  for (const [file, tally] of files) {
    for (const reason of tally.collectionFailures) {
      failures.push(`${label}：${file} 收集失败（文件级用例未执行：${reason}），断言结果不可信`);
    }
    if (tally.failed > 0) {
      failures.push(`${label}：${file} 有 ${tally.failed} 个失败用例：${tally.failedTitles.join("、")}`);
    }
    if (tally.cancelled > 0) {
      failures.push(`${label}：${file} 有 ${tally.cancelled} 个被取消用例：${tally.cancelledTitles.join("、")}`);
    }
    if (tally.caseEntries === 0) {
      failures.push(`${label}：${file} 在报告中 0 个用例（收集失败 / 整文件跳过 / 用例被删除），不得放行`);
    }
    const total = caseCount(tally);
    const wholeFileSkipped = total > 0 && tally.skipped === total;
    if (wholeFileSkipped) {
      failures.push(`${label}：${file} 整文件跳过（${total} 个用例全部未执行），不得放行`);
    }
    const registered = required.some((entry) => entry.file === file);
    // 只有「部分跳过」与 test.todo 降级为告警；整文件跳过已计入失败，不重复告警。
    if (tally.skipped > 0 && !wholeFileSkipped && !registered) {
      warnings.push(`${label}：${file} 部分跳过：${tally.skippedTitles.join("、")}`);
    }
    if (tally.todo > 0 && !registered) {
      warnings.push(`${label}：${file} 存在 test.todo 未实现用例：${tally.todoTitles.join("、")}`);
    }
  }
  return { failures, warnings };
}

function totalsOf(files) {
  const totals = emptyTally();
  for (const tally of files.values()) {
    totals.passed += tally.passed;
    totals.failed += tally.failed;
    totals.skipped += tally.skipped;
    totals.cancelled += tally.cancelled;
    totals.todo += tally.todo;
    totals.collectionFailures.push(...tally.collectionFailures);
  }
  return totals;
}

/**
 * 报告自洽性：按用例记录统计的数量与 Node 自己的 run 级汇总必须逐项一致。
 * 不一致说明 reporter 的口径与实际运行不符（例如把 suite 当成用例、漏读事件），此时不得放行。
 */
function checkSelfConsistency(label, report, files) {
  const totals = totalsOf(files);
  const expected = [
    ["用例数", caseCount(totals) + totals.collectionFailures.length, report.totals.tests],
    ["通过数", totals.passed, report.totals.passed],
    ["失败数", totals.failed + totals.collectionFailures.length, report.totals.failed],
    ["跳过数", totals.skipped, report.totals.skipped],
    ["取消数", totals.cancelled, report.totals.cancelled],
    ["todo 数", totals.todo, report.totals.todo],
  ];
  const failures = [];
  for (const [name, mine, nodeValue] of expected) {
    if (mine !== nodeValue) {
      failures.push(
        `${label}：报告自洽性校验失败——按用例记录统计的${name}为 ${mine}，Node run 级汇总为 ` +
          `${String(nodeValue)}（reporter 解析口径与实际运行不符，不得放行）`,
      );
    }
  }
  return failures;
}

/**
 * 完整断言：清单命中 + 棘轮通过数 + 磁盘集合与清单相等 + 文件级失效 + 报告新鲜度 + 报告自洽性。
 * `totals`、`fileCount`、`diskCount` 供汇总行自证门禁不是空转。
 */
function checkReport({ label, report, files, startMs }) {
  const fileCheck = checkFileFailures(label, files, REQUIRED_NODE_TESTS);
  const failures = [
    ...checkRequired(label, files, REQUIRED_NODE_TESTS),
    ...fileCheck.failures,
    ...checkSelfConsistency(label, report, files),
    ...checkFreshness({ label, required: REQUIRED_NODE_TESTS, startMs }),
  ];
  const diskCheck = checkDiskTestFiles(label, REQUIRED_NODE_TESTS);
  const totals = totalsOf(files);
  const cases = caseCount(totals);
  failures.push(...diskCheck.failures);
  if (totals.passed === 0) failures.push(`${label}：报告内没有任何通过用例，门禁不可信`);
  return {
    failures,
    warnings: fileCheck.warnings,
    totals,
    fileCount: files.size,
    cases,
    diskCount: diskCheck.diskCount,
  };
}

/**
 * 汇总行：参与判定的文件数 / 用例数 + 各状态计数（对照 REV-3 的「参与判定的作用域 N 个」，
 * 用非零规模证明门禁不是空转）。
 */
function logReport({ label, fileCount, totals, cases, diskCount, startMs }) {
  console.log(
    `${label} 报告：参与判定的文件 ${fileCount} 个、用例 ${cases} 个（通过 ${totals.passed}、失败 ${totals.failed}、` +
      `跳过 ${totals.skipped}、取消 ${totals.cancelled}、todo ${totals.todo}、收集失败 ` +
      `${totals.collectionFailures.length}），磁盘上的 node:test 文件 ${diskCount} 个（必须与清单完全相等），` +
      `报告开始时间 ${formatMs(startMs)}`,
  );
}

function main() {
  // 越界的 NODE_TEST_REPORT_ROOT 已在 resolveReportRoot 打印原因；这里绝不放行（EVID-1）。
  if (reportRoot === null) return 2;
  const run = readReport(REPORT_PATH);
  if (run === null) return 2;
  const files = summarize(run.report);
  const startMs = reportStartMs("node:test", run.report.startedAt, run.reportPath);
  const check = checkReport({ label: "node:test", report: run.report, files, startMs });

  logReport({
    label: "node:test",
    fileCount: check.fileCount,
    totals: check.totals,
    cases: check.cases,
    diskCount: check.diskCount,
    startMs,
  });
  for (const warning of check.warnings) console.warn(`  告警（清单外，不影响退出码）：${warning}`);

  if (check.failures.length > 0) {
    console.error(`\nnode:test 执行门禁失败 ${check.failures.length} 项：`);
    for (const failure of check.failures) console.error(`  - ${failure}`);
    return 1;
  }
  console.log("node:test 执行门禁通过：清单内文件均已运行、通过、未跳过且报告新鲜、自洽。");
  return 0;
}

process.exit(main());
