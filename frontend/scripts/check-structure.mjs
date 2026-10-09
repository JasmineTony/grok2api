#!/usr/bin/env node
/**
 * 结构门禁（AGENTS.md REV-1 / REV-2）。
 *
 * 规则：
 *  - 新增代码不得引入新的超限文件（> 600 行）或超限函数（> 50 行）。
 *  - 存量超限项由 structure-baseline.json 冻结，只允许持平或下降。
 *
 * 已知边界：只统计具名函数/组件（函数声明、类方法、变量或属性绑定的函数表达式/箭头函数）。
 * 作为参数内联的匿名回调不参与判定，避免行号漂移造成误报。
 *
 * 用法：
 *   node scripts/check-structure.mjs            # 校验，超限即非零退出
 *   node scripts/check-structure.mjs --update   # 重新冻结基线（仅在有意整改后使用）
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 允许通过环境变量注入路径，仅供 scripts/self-test-gates.mjs 用固定装置验证门禁会失败。
const srcDir = process.env.STRUCTURE_SRC_DIR ?? path.join(frontendDir, "src");
const baselinePath = process.env.STRUCTURE_BASELINE_PATH ?? path.join(frontendDir, "structure-baseline.json");
const shouldUpdate = process.argv.includes("--update");

const FILE_LINE_LIMIT = 600;
const FUNCTION_LINE_LIMIT = 50;
const SOURCE_PATTERN = /\.(ts|tsx)$/;
const IGNORED_PATTERN = /\.(test|spec)\.(ts|tsx)$|\.d\.ts$/;

function collectSourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
      continue;
    }
    if (!SOURCE_PATTERN.test(entry.name) || IGNORED_PATTERN.test(entry.name)) continue;
    files.push(full);
  }
  return files;
}

function relativePath(file) {
  return path.relative(frontendDir, file).replaceAll("\\", "/");
}

function countLines(text) {
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  return trimmed.length === 0 ? 0 : trimmed.split("\n").length;
}

function enclosingClassName(node) {
  let current = node.parent;
  while (current) {
    if (ts.isClassDeclaration(current) && current.name) return current.name.text;
    current = current.parent;
  }
  return null;
}

/** 返回具名函数的稳定标识；无法稳定命名的匿名函数返回 null。 */
function functionKey(sourceFile, node) {
  if (ts.isFunctionDeclaration(node)) return node.name ? node.name.text : null;
  if (ts.isMethodDeclaration(node)) {
    const owner = enclosingClassName(node);
    return owner ? `${owner}.${node.name.getText(sourceFile)}` : node.name.getText(sourceFile);
  }
  const parent = node.parent;
  if (parent && (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent))) {
    return parent.name.getText(sourceFile);
  }
  return null;
}

function spanLines(sourceFile, node) {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
  const end = sourceFile.getLineAndCharacterOfPosition(node.end).line;
  return end - start + 1;
}

function collectFunctionSizes(file) {
  const text = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const sizes = new Map();
  const visit = (node) => {
    const isFunctionLike =
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node);
    if (isFunctionLike) {
      const name = functionKey(sourceFile, node);
      const lines = spanLines(sourceFile, node);
      if (name !== null && lines > FUNCTION_LINE_LIMIT) {
        const key = `${relativePath(file)}#${name}`;
        sizes.set(key, Math.max(sizes.get(key) ?? 0, lines));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sizes;
}

function readBaseline() {
  if (!fs.existsSync(baselinePath)) {
    console.error(`缺少结构基线：${relativePath(baselinePath)}。首次落地请先运行 --update。`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(baselinePath, "utf8"));
}

function compare(current, frozen, kind) {
  const failures = [];
  const improved = [];
  for (const [key, lines] of current) {
    const frozenLines = frozen[key];
    if (frozenLines === undefined) {
      failures.push(`新增超限${kind}：${key} = ${lines} 行`);
      continue;
    }
    if (lines > frozenLines) {
      failures.push(`超限${kind}继续增大：${key} = ${lines} 行（基线 ${frozenLines} 行）`);
    }
  }
  for (const [key, frozenLines] of Object.entries(frozen)) {
    if (!current.has(key)) improved.push(`${key}（基线 ${frozenLines} 行）`);
  }
  return { failures, improved };
}

function main() {
  const sourceFiles = collectSourceFiles(srcDir);
  const fileSizes = new Map();
  const functionSizes = new Map();
  for (const file of sourceFiles) {
    const lines = countLines(fs.readFileSync(file, "utf8"));
    if (lines > FILE_LINE_LIMIT) fileSizes.set(relativePath(file), lines);
    for (const [key, value] of collectFunctionSizes(file)) functionSizes.set(key, value);
  }

  if (shouldUpdate) {
    const payload = {
      note: "存量债务冻结基线（AGENTS.md §5）。只允许持平或下降，整改后可用 --update 收缩。",
      limits: { fileLines: FILE_LINE_LIMIT, functionLines: FUNCTION_LINE_LIMIT },
      files: Object.fromEntries([...fileSizes].sort((a, b) => a[0].localeCompare(b[0]))),
      functions: Object.fromEntries([...functionSizes].sort((a, b) => a[0].localeCompare(b[0]))),
    };
    fs.writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(
      `已更新结构基线：超限文件 ${fileSizes.size} 个，超限函数 ${functionSizes.size} 个 → ${relativePath(baselinePath)}`,
    );
    return;
  }

  const baseline = readBaseline();
  const files = compare(fileSizes, baseline.files ?? {}, "文件");
  const functions = compare(functionSizes, baseline.functions ?? {}, "函数");
  const failures = [...files.failures, ...functions.failures];

  console.log(`扫描源码文件：${sourceFiles.length} 个`);
  console.log(
    `超限文件（> ${FILE_LINE_LIMIT} 行）：${fileSizes.size} 个，冻结基线 ${Object.keys(baseline.files ?? {}).length} 个`,
  );
  console.log(
    `超限函数（> ${FUNCTION_LINE_LIMIT} 行）：${functionSizes.size} 个，冻结基线 ${Object.keys(baseline.functions ?? {}).length} 个`,
  );
  const improved = [...files.improved, ...functions.improved];
  if (improved.length > 0) {
    console.log(`已整改（建议用 --update 收缩基线）：${improved.length} 项`);
  }
  if (failures.length > 0) {
    console.error(`\n结构门禁失败 ${failures.length} 项：`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log("结构门禁通过：未新增超限文件或超限函数。");
}

main();
