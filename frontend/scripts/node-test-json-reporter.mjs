#!/usr/bin/env node
/**
 * node:test → JSON 报告 reporter（pnpm test 的机器可读取证载体，供 scripts/check-node-test-results.mjs 解析）。
 *
 * 为什么需要它：Node 内置 reporter 只有 default / dot / junit / lcov / spec / tap，**没有 json**
 * （实测 `node -e "import('node:test/reporters').then(m => console.log(Object.keys(m)))"` 的输出），
 * 而 `--test-reporter=json` 不是内建名字：在 `--test` 之前使用时会被静默降级成 default reporter（不产出文件），
 * 在 `--test` 之后使用时连 reporter 参数一起被忽略。TAP 与 JUnit 也不行——两者都丢掉「用例属于哪个测试文件」
 * 这一维度（多个文件运行时所有用例并列在顶层，只有文件级失败才出现文件名），无法支撑逐文件断言。
 * 本模块用 Node 官方 reporter API（默认导出 async generator）把事件流序列化为一份 JSON 报告，只做序列化，
 * 不做任何断言；断言与退出码都在 check-node-test-results.mjs，避免同一套业务语义出现两份。
 *
 * 用法（由 package.json 的 test 脚本接线，不要手工调用）：
 *   node --experimental-strip-types --test-reporter=spec --test-reporter-destination=stdout \
 *     --test-reporter=./scripts/node-test-json-reporter.mjs \
 *     --test-reporter-destination=.artifacts/node-test/results.json --test "src/**\/*.test.ts" "scripts/**\/*.test.ts"
 * 注意：reporter 与 destination 数量必须一一对应；destination 的父目录必须先存在（Node 不会创建）；
 * reporter 必须用相对路径或 file:// URL（Windows 绝对路径会被 ESM loader 拒绝）。
 *
 * 报告结构（kind/version 由 check-node-test-results.mjs 做 fail-closed 形状校验）：
 * {
 *   "kind": "node-test-json", "version": 1, "nodeVersion": "v24.0.1", "cwd": "<绝对路径>",
 *   "startedAt": "<ISO 8601，reporter 模块加载时刻>", "finishedAt": "<ISO 8601>",
 *   "diagnostics": ["tests 12", "pass 12", ...],                    // run 级汇总行（人工取证）
 *   "totals": { "tests", "passed", "failed", "cancelled", "skipped", "todo" },  // 最后一个 run 级 test:summary
 *   "files": [{
 *     "file": "src/shared/lib/format.test.ts",                      // 相对 cwd 的正斜杠路径
 *     "cases": [{ "name", "kind": "test"|"file-root", "status": "passed"|"failed"|"skipped"|"todo"|"cancelled", "failureType"? }],
 *     "cases": [{ "name", "kind": "test"|"file-root", "status": "passed"|"failed"|"skipped"|"todo"|"cancelled", "failureType"? }],
 *     "summary": { "tests", "passed", ... } | null                  // 该文件的 test:summary；收集失败的文件为 null
 *   }]
 * }
 * `kind: "file-root"` 是 Node 在文件级失败（导入/收集报错等）时合成的、以文件名为用例名的事件，
 * 它不是真实用例；check-node-test-results.mjs 用它区分「收集失败」与「用例失败」。
 */
import path from "node:path";

/** reporter 模块加载时刻即本次运行起点（早于任何测试文件执行），用于报告新鲜度判定。 */
const startedAt = new Date().toISOString();
const rootDir = process.cwd();

/** 归一化为相对 frontend/ 的正斜杠路径，报告内容与机器无关。 */
function relativeFile(file) {
  return path.relative(rootDir, path.resolve(file)).replaceAll("\\", "/");
}

/** 事件里真正归属某个测试文件的绝对路径；test:stderr 之类只有文件名的载荷不具备文件归属。 */
function eventFile(data) {
  if (typeof data.file !== "string" || data.file.length === 0) return null;
  return path.isAbsolute(data.file) ? relativeFile(data.file) : null;
}

function fileReportOf(files, file) {
  const existing = files.get(file);
  if (existing) return existing;
  const created = { file, cases: [], summary: null };
  files.set(file, created);
  return created;
}

/** 用例状态：失败（含超时/钩子失败）、被父用例取消、跳过、待办、普通通过。 */
function caseStatus(event, data, details) {
  if (event.type === "test:fail") {
    return details.error?.failureType === "cancelledByParent" ? "cancelled" : "failed";
  }
  if (data.skip === true) return "skipped";
  if (data.todo === true) return "todo";
  return "passed";
}

/** 单个事件 → 报告条目；run 级 totals 取最后一个不带 file 的 test:summary（Node 只发一次）。 */
function applyEvent(files, diagnostics, state, event) {
  const data = event.data ?? {};
  const details = data.details ?? {};
  if (event.type === "test:pass" || event.type === "test:fail") {
    const file = eventFile(data);
    if (file === null) return;
    const entry = fileReportOf(files, file);
    // suite 事件不是用例，必须在这里丢弃：写进 cases 会污染用例计数与报告自洽性校验。
    // 历史上这里额外记录了一个 `suites` 字段，但 `test:pass` 对 `test.skip` 的 suite 同样成立，
    // 跳过的 suite 会被一律标成 passed，而该字段没有任何消费者（门禁只读 cases），故删除这个误导字段。
    if (details.type === "suite") return;
    entry.cases.push({
      name: data.name ?? "",
      kind: data.name === path.basename(file) ? "file-root" : "test",
      status: caseStatus(event, data, details),
      ...(details.error?.failureType ? { failureType: details.error.failureType } : {}),
    });
    return;
  }
  if (event.type === "test:summary" && data.counts) {
    const file = eventFile(data);
    if (file === null) state.totals = data.counts;
    else fileReportOf(files, file).summary = data.counts;
    return;
  }
  if (event.type === "test:diagnostic" && typeof data.message === "string") diagnostics.push(data.message);
}

export default async function* nodeTestJsonReporter(source) {
  const files = new Map();
  const diagnostics = [];
  const state = { totals: null };
  for await (const event of source) applyEvent(files, diagnostics, state, event);
  const report = {
    kind: "node-test-json",
    version: 1,
    nodeVersion: process.version,
    cwd: rootDir,
    startedAt,
    finishedAt: new Date().toISOString(),
    diagnostics,
    totals: state.totals,
    files: [...files.values()].sort((left, right) => left.file.localeCompare(right.file)),
  };
  yield `${JSON.stringify(report, null, 2)}\n`;
}
