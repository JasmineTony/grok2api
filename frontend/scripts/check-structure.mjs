#!/usr/bin/env node
/**
 * 结构门禁（AGENTS.md REV-1 / REV-2 / REV-3）。
 *
 * 规则：
 *  - 新增代码不得引入新的超限文件（> 600 行）、超限函数（> 50 行）或超限嵌套（> 3 层）。
 *  - 存量超限项由 structure-baseline.json 冻结，只允许持平或下降。
 *
 * 嵌套深度（REV-3）计入 if、for、for...in、for...of、while、do...while、switch、try 与条件表达式：
 *  - else / else if 与所属 if 同层，不计入新层；case 子句体不额外加层；try / catch / finally 同层。
 *  - 条件表达式按嵌套层计，三元链逐层累加。
 *  - 具名函数（函数声明、类方法、变量或属性绑定的具名函数表达式/具名箭头函数）各自是独立作用域，
 *    从自身起点按 0 层重新计数。这与 REV-2 把嵌套函数视为独立单元的口径一致，是有意约定，不是漏报。
 *  - 匿名内联回调（useEffect(() => {…})、onClick={() => {…}}、items.map((item) => {…})、
 *    superRefine((v, ctx) => {…})）不新建作用域、不重置深度，其函数体累计到最近外层具名作用域的深度上，
 *    因此深度反映的是该具名单元的可读性，键也不会随行号漂移。匿名回调位于模块级（没有任何外层具名
 *    作用域，例如 `export default () => {…}`）时归入稳定键 `<module-anonymous>` 单独上报，模块级
 *    语句本身同样归入该键；不存在「整段函数体不参与判定」的路径。
 *  - 类构造函数与 get / set 访问器同样视为独立作用域，键为 `<类名>.constructor`、`<类名>.get<名称>`、
 *    `<类名>.set<名称>`；匿名类表达式无类名可归属时退化为 `<名称>` 本身（同文件同名成员取最大值）。
 *
 * 有意保留的口径（不是缺陷）：
 *  - `else if (b) {}` 记 1 层，语义等价的 `else { if (b) {} }` 记 2 层。保留偏保守的高计数，因为把
 *    后者归一化为同层会整体下调既有计数、放松门禁；而显式块内再嵌 if 也确实多了一层可读性成本。
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
const NESTING_DEPTH_LIMIT = 3;
/** 模块级作用域（模块级语句与模块级匿名回调）的归属键。 */
const MODULE_ANONYMOUS_SCOPE = "<module-anonymous>";
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

/** 返回函数所属类的稳定名称；匿名类表达式按变量/属性绑定名兜底，无法归属时返回 null。 */
function enclosingClassName(node, sourceFile) {
  let current = node.parent;
  while (current) {
    if (ts.isClassDeclaration(current)) return current.name ? current.name.text : null;
    if (ts.isClassExpression(current)) {
      if (current.name) return current.name.text;
      const binding = current.parent;
      if (binding && (ts.isVariableDeclaration(binding) || ts.isPropertyAssignment(binding))) {
        return binding.name.getText(sourceFile);
      }
      return null;
    }
    current = current.parent;
  }
  return null;
}

/** 返回具名函数的稳定标识；匿名函数返回 null，由调用方归属到最近外层具名作用域。 */
function functionKey(sourceFile, node) {
  if (ts.isFunctionDeclaration(node)) return node.name ? node.name.text : null;
  if (ts.isMethodDeclaration(node)) {
    const owner = enclosingClassName(node, sourceFile);
    return owner ? `${owner}.${node.name.getText(sourceFile)}` : node.name.getText(sourceFile);
  }
  if (ts.isConstructorDeclaration(node)) {
    const owner = enclosingClassName(node, sourceFile);
    return owner ? `${owner}.constructor` : "constructor";
  }
  if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    const owner = enclosingClassName(node, sourceFile);
    const accessor = `${ts.isGetAccessorDeclaration(node) ? "get" : "set"}${node.name.getText(sourceFile)}`;
    return owner ? `${owner}.${accessor}` : accessor;
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

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function collectFunctionSizes(file) {
  const text = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const sizes = new Map();
  const visit = (node) => {
    if (isFunctionLike(node)) {
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

/** 计入嵌套深度的语法结构。 */
function isNestingNode(node) {
  return (
    ts.isIfStatement(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isSwitchStatement(node) ||
    ts.isTryStatement(node) ||
    ts.isConditionalExpression(node)
  );
}

/** else / else if 属于所属 if 的同一层，不额外加层。 */
function isElseBranchOfIf(node) {
  const parent = node.parent;
  return parent !== undefined && ts.isIfStatement(parent) && parent.elseStatement === node;
}

/**
 * 收集各具名作用域内的最大嵌套深度。
 * 匿名内联回调不新建作用域、不重置深度，其函数体累计到最近外层具名作用域的深度上；
 * 模块级代码与模块级匿名回调（没有外层具名作用域）统一归入 MODULE_ANONYMOUS_SCOPE，不会被静默丢弃。
 */
function collectNestingDepths(file) {
  const text = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const relative = relativePath(file);
  const depths = new Map();
  const record = (scope, depth) => {
    if (depth <= NESTING_DEPTH_LIMIT) return;
    const key = `${relative}#${scope}`;
    depths.set(key, Math.max(depths.get(key) ?? 0, depth));
  };
  const visit = (node, depth, scope) => {
    if (isFunctionLike(node)) {
      const key = functionKey(sourceFile, node);
      if (key === null) {
        // 匿名内联回调：沿用最近外层具名作用域，不重置深度。
        ts.forEachChild(node, (child) => visit(child, depth, scope));
        return;
      }
      ts.forEachChild(node, (child) => visit(child, 0, key));
      return;
    }
    const next = isNestingNode(node) && !isElseBranchOfIf(node) ? depth + 1 : depth;
    if (next > depth) record(scope, next);
    ts.forEachChild(node, (child) => visit(child, next, scope));
  };
  visit(sourceFile, 0, MODULE_ANONYMOUS_SCOPE);
  return depths;
}

function readBaseline() {
  if (!fs.existsSync(baselinePath)) {
    console.error(`缺少结构基线：${relativePath(baselinePath)}。首次落地请先运行 --update。`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(baselinePath, "utf8"));
}

function compare(current, frozen, kind, unit) {
  const failures = [];
  const improved = [];
  for (const [key, value] of current) {
    const frozenValue = frozen[key];
    if (frozenValue === undefined) {
      failures.push(`新增超限${kind}：${key} = ${value} ${unit}`);
      continue;
    }
    if (value > frozenValue) {
      failures.push(`超限${kind}继续增大：${key} = ${value} ${unit}（基线 ${frozenValue} ${unit}）`);
    }
  }
  for (const [key, frozenValue] of Object.entries(frozen)) {
    if (!current.has(key)) improved.push(`${key}（基线 ${frozenValue} ${unit}）`);
  }
  return { failures, improved };
}

function main() {
  const sourceFiles = collectSourceFiles(srcDir);
  const fileSizes = new Map();
  const functionSizes = new Map();
  const nestingDepths = new Map();
  for (const file of sourceFiles) {
    const lines = countLines(fs.readFileSync(file, "utf8"));
    if (lines > FILE_LINE_LIMIT) fileSizes.set(relativePath(file), lines);
    for (const [key, value] of collectFunctionSizes(file)) functionSizes.set(key, value);
    for (const [key, depth] of collectNestingDepths(file)) nestingDepths.set(key, depth);
  }

  if (shouldUpdate) {
    const payload = {
      note: "存量债务冻结基线（AGENTS.md §5）。只允许持平或下降，整改后可用 --update 收缩。",
      limits: {
        fileLines: FILE_LINE_LIMIT,
        functionLines: FUNCTION_LINE_LIMIT,
        nestingDepth: NESTING_DEPTH_LIMIT,
      },
      files: Object.fromEntries([...fileSizes].sort((a, b) => a[0].localeCompare(b[0]))),
      functions: Object.fromEntries([...functionSizes].sort((a, b) => a[0].localeCompare(b[0]))),
      nesting: Object.fromEntries([...nestingDepths].sort((a, b) => a[0].localeCompare(b[0]))),
    };
    fs.writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(
      `已更新结构基线：超限文件 ${fileSizes.size} 个，超限函数 ${functionSizes.size} 个，` +
        `超限嵌套 ${nestingDepths.size} 个 → ${relativePath(baselinePath)}`,
    );
    return;
  }

  const baseline = readBaseline();
  const files = compare(fileSizes, baseline.files ?? {}, "文件", "行");
  const functions = compare(functionSizes, baseline.functions ?? {}, "函数", "行");
  const nesting = compare(nestingDepths, baseline.nesting ?? {}, "嵌套", "层");
  const failures = [...files.failures, ...functions.failures, ...nesting.failures];

  console.log(`扫描源码文件：${sourceFiles.length} 个`);
  console.log(
    `超限文件（> ${FILE_LINE_LIMIT} 行）：${fileSizes.size} 个，冻结基线 ${Object.keys(baseline.files ?? {}).length} 个`,
  );
  console.log(
    `超限函数（> ${FUNCTION_LINE_LIMIT} 行）：${functionSizes.size} 个，冻结基线 ${Object.keys(baseline.functions ?? {}).length} 个`,
  );
  console.log(
    `超限嵌套（> ${NESTING_DEPTH_LIMIT} 层）：${nestingDepths.size} 个，冻结基线 ${Object.keys(baseline.nesting ?? {}).length} 个`,
  );
  const improved = [...files.improved, ...functions.improved, ...nesting.improved];
  if (improved.length > 0) {
    console.log(`已整改（建议用 --update 收缩基线）：${improved.length} 项`);
  }
  if (failures.length > 0) {
    console.error(`\n结构门禁失败 ${failures.length} 项：`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log("结构门禁通过：未新增超限文件、超限函数或超限嵌套。");
}

main();
