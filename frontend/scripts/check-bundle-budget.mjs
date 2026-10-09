#!/usr/bin/env node
/**
 * 产物体积预算门禁（AGENTS.md REV-5）。
 *
 * 校验 dist 的四类硬阈值与冻结基线增长：
 *  - 首屏关键 JS 依赖闭包（index.html 的 module 入口 + modulepreload 的静态闭包）
 *  - 单个业务路由相对首屏闭包的新增闭包
 *  - 全部生产 JS / CSS（按文件去重）
 *  - 最大单个 JS chunk 原始体积
 *
 * 依赖关系通过 TypeScript AST 读取，不使用正则匹配，避免把普通字符串或注释误判为依赖。
 * 注意 Vite 8 的真实产物形态：
 *  - 懒加载入口是 `import(`./x.js`)`（NoSubstitutionTemplateLiteral，不是 StringLiteral）；
 *  - `__vite__mapDeps` 的预加载清单是 dist 根相对路径（`assets/x.js`，无前导 `./` 或 `/`）。
 * 因此解析必须同时覆盖「相对当前 chunk」与「相对 dist 根」两种写法，否则路由检查会静默失效。
 *
 * 用法：
 *   node scripts/check-bundle-budget.mjs            # 校验（需先 pnpm build）
 *   node scripts/check-bundle-budget.mjs --update   # 重新冻结基线
 */
import { createRequire } from "node:module";
import { brotliCompressSync, gzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 允许通过环境变量注入路径，仅供 scripts/self-test-gates.mjs 用固定装置验证门禁会失败。
const distDir = process.env.BUDGET_DIST_DIR ?? path.join(frontendDir, "dist");
const configPath = process.env.BUDGET_CONFIG_PATH ?? path.join(frontendDir, "bundle-budget.json");
const KiB = 1024;
const shouldUpdate = process.argv.includes("--update");

function listAssets(extension) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(extension)) files.push(full);
    }
  };
  walk(distDir);
  return files;
}

function measure(file) {
  const buffer = fs.readFileSync(file);
  return {
    file: path.relative(distDir, file).replaceAll("\\", "/"),
    rawBytes: buffer.length,
    gzipBytes: gzipSync(buffer, { level: 9 }).length,
    brotliBytes: brotliCompressSync(buffer).length,
  };
}

function sum(entries) {
  return entries.reduce(
    (total, entry) => ({
      rawBytes: total.rawBytes + entry.rawBytes,
      gzipBytes: total.gzipBytes + entry.gzipBytes,
      brotliBytes: total.brotliBytes + entry.brotliBytes,
    }),
    { rawBytes: 0, gzipBytes: 0, brotliBytes: 0 },
  );
}

function isPathLiteral(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function parseSource(file) {
  return ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}

/** 静态依赖：`import ... from "x"` 与 `export ... from "x"`。 */
function staticSpecifiersOf(file) {
  const sourceFile = parseSource(file);
  const specifiers = [];
  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      isPathLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

/** 懒加载入口：`import("./x.js")` 或 `import(`./x.js`)` 的字面量参数（业务路由 chunk）。 */
function dynamicImportSpecifiersOf(file) {
  const sourceFile = parseSource(file);
  const specifiers = new Set();
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument && isPathLiteral(argument)) {
        const target = resolveSpecifier(file, argument.text);
        if (target !== null && target.endsWith(".js")) specifiers.add(target);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

/** 解析相对当前 chunk、dist 根或 `/assets/...` 三种写法。 */
function resolveSpecifier(fromFile, specifier) {
  let candidate;
  if (specifier.startsWith("/")) candidate = path.join(distDir, specifier.slice(1));
  else if (specifier.startsWith(".")) candidate = path.resolve(path.dirname(fromFile), specifier);
  else candidate = path.join(distDir, specifier);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return null;
  return candidate;
}

function collectClosure(entryFiles) {
  const seen = new Set();
  const queue = [...entryFiles];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of staticSpecifiersOf(file)) {
      const target = resolveSpecifier(file, specifier);
      if (target !== null && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

function indexEntryFiles() {
  const html = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
  const files = [];
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
    const candidate = path.join(distDir, match[1].replace(/^\//, ""));
    if (candidate.endsWith(".js") && fs.existsSync(candidate)) files.push(candidate);
  }
  if (files.length === 0) {
    console.error("dist/index.html 未引用任何 JS 入口，无法计算首屏闭包。");
    process.exit(2);
  }
  return files;
}

function collectRouteMetrics(initialClosure) {
  const routeEntries = new Set();
  for (const file of initialClosure) {
    for (const target of dynamicImportSpecifiersOf(file)) {
      if (!initialClosure.has(target)) routeEntries.add(target);
    }
  }
  const metrics = [];
  for (const entry of [...routeEntries].sort()) {
    const incremental = [...collectClosure([entry])].filter((file) => !initialClosure.has(file));
    metrics.push({
      entry: path.relative(distDir, entry).replaceAll("\\", "/"),
      closureGzipBytes: sum(incremental.map(measure)).gzipBytes,
    });
  }
  return metrics;
}

function collectMetrics() {
  const initialClosure = collectClosure(indexEntryFiles());
  const jsAssets = listAssets(".js").map(measure);
  const cssAssets = listAssets(".css").map(measure);
  const maxChunk = jsAssets.reduce((max, asset) => (asset.rawBytes > max.rawBytes ? asset : max), jsAssets[0]);
  return {
    allJs: { count: jsAssets.length, ...sum(jsAssets) },
    allCss: { count: cssAssets.length, ...sum(cssAssets) },
    initialClosure: {
      count: initialClosure.size,
      files: [...initialClosure].map((file) => path.relative(distDir, file).replaceAll("\\", "/")).sort(),
      ...sum([...initialClosure].map(measure)),
    },
    maxChunk,
    routes: collectRouteMetrics(initialClosure),
  };
}

function toKiB(bytes) {
  return Math.round((bytes / KiB) * 100) / 100;
}

function checkThresholds(metrics, thresholds) {
  const failures = [];
  const initialKiB = toKiB(metrics.initialClosure.gzipBytes);
  if (initialKiB > thresholds.initialJsGzipKiB) {
    failures.push(`首屏关键 JS 闭包 ${initialKiB} KiB > ${thresholds.initialJsGzipKiB} KiB`);
  }
  for (const route of metrics.routes) {
    const routeKiB = toKiB(route.closureGzipBytes);
    if (routeKiB > thresholds.routeIncrementGzipKiB) {
      failures.push(`路由 ${route.entry} 新增闭包 ${routeKiB} KiB > ${thresholds.routeIncrementGzipKiB} KiB`);
    }
  }
  const allJsKiB = toKiB(metrics.allJs.gzipBytes);
  if (allJsKiB > thresholds.allJsGzipKiB) {
    failures.push(`全部生产 JS ${allJsKiB} KiB > ${thresholds.allJsGzipKiB} KiB`);
  }
  const allCssKiB = toKiB(metrics.allCss.gzipBytes);
  if (allCssKiB > thresholds.allCssGzipKiB) {
    failures.push(`全部生产 CSS ${allCssKiB} KiB > ${thresholds.allCssGzipKiB} KiB`);
  }
  const maxChunkKiB = toKiB(metrics.maxChunk.rawBytes);
  if (maxChunkKiB > thresholds.maxChunkRawKiB) {
    failures.push(`最大 chunk ${metrics.maxChunk.file} ${maxChunkKiB} KiB > ${thresholds.maxChunkRawKiB} KiB`);
  }
  return failures;
}

function checkGrowth(metrics, baseline, tolerancePercent) {
  if (!baseline) return [];
  const failures = [];
  const entries = [
    ["首屏关键 JS 闭包", metrics.initialClosure.gzipBytes, baseline.initialClosure?.gzipBytes],
    ["全部生产 JS", metrics.allJs.gzipBytes, baseline.allJs?.gzipBytes],
    ["全部生产 CSS", metrics.allCss.gzipBytes, baseline.allCss?.gzipBytes],
  ];
  for (const [label, current, frozen] of entries) {
    if (typeof frozen !== "number" || frozen === 0) continue;
    const growthPercent = ((current - frozen) / frozen) * 100;
    if (growthPercent > tolerancePercent) {
      failures.push(`${label} 相对冻结基线增长 ${growthPercent.toFixed(2)}% > ${tolerancePercent}%`);
    }
  }
  return failures;
}

function report(metrics) {
  console.log(
    `首屏关键 JS 闭包：${metrics.initialClosure.count} 个文件，${toKiB(metrics.initialClosure.gzipBytes)} KiB gzip`,
  );
  console.log(`全部生产 JS：${metrics.allJs.count} 个文件，${toKiB(metrics.allJs.gzipBytes)} KiB gzip`);
  console.log(`全部生产 CSS：${metrics.allCss.count} 个文件，${toKiB(metrics.allCss.gzipBytes)} KiB gzip`);
  console.log(`最大 chunk：${metrics.maxChunk.file}，${toKiB(metrics.maxChunk.rawBytes)} KiB 原始`);
  console.log(`路由入口：${metrics.routes.length} 个`);
  for (const route of metrics.routes) {
    console.log(`  路由新增闭包 ${route.entry}：${toKiB(route.closureGzipBytes)} KiB gzip`);
  }
}

function main() {
  if (!fs.existsSync(distDir)) {
    console.error("缺少 frontend/dist，请先运行 pnpm build。");
    process.exit(2);
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const metrics = collectMetrics();
  report(metrics);

  if (shouldUpdate) {
    const next = { ...config, baseline: { generatedAt: new Date().toISOString(), ...metrics } };
    fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    console.log("已更新 bundle-budget.json 冻结基线。");
    return;
  }

  const failures = [
    ...checkThresholds(metrics, config.thresholds),
    ...checkGrowth(metrics, config.baseline, config.growthTolerancePercent),
  ];
  if (failures.length > 0) {
    console.error(`\n体积预算门禁失败 ${failures.length} 项：`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  if (metrics.routes.length === 0) {
    console.error("\n体积预算门禁失败：未识别到任何路由入口，路由预算检查不可信。");
    process.exit(1);
  }
  console.log("体积预算门禁通过。");
}

main();
