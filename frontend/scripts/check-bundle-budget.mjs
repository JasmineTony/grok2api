#!/usr/bin/env node
/**
 * 产物体积预算门禁（AGENTS.md REV-5）。
 *
 * 校验 dist 的四类硬阈值与冻结基线增长：
 *  - 首屏关键 JS 依赖闭包（index.html 的 module 入口 + modulepreload 的静态闭包）
 *  - 单个业务路由实际会加载的新增闭包 = 静态闭包 ∪ 该入口的 __vite__mapDeps 预加载子集
 *  - 全部生产 JS / CSS（按文件去重）
 *  - 最大单个 JS chunk 原始体积
 *
 * 依赖关系通过 TypeScript AST 读取，不使用正则匹配，避免把普通字符串或注释误判为依赖。
 * 注意 Vite 8 的真实产物形态：
 *  - 懒加载入口是 `import(`./x.js`)`（NoSubstitutionTemplateLiteral，不是 StringLiteral）；
 *  - 预加载清单是 `d=(m.f||(m.f=["assets/x.js", ...]))`，调用点写成 `__vitePreload(() => import(...),
 *    __vite__mapDeps([索引]))`；`__vite__mapDeps` 清单是同一 chunk 内所有动态入口的并集，
 *    因此只能取「该入口自己的索引子集」，否则会把其它路由的 chunk 误算进当前路由；
 *  - 清单里的路径是 dist 根相对路径（`assets/x.js`，无前导 `./` 或 `/`），且可能包含 CSS。
 * 因此解析必须同时覆盖「相对当前 chunk」与「相对 dist 根」两种写法，否则路由检查会静默失效。
 *
 * dist 新鲜度：读取 dist 之前先复用 scripts/build-inputs.ts 的 isBuildFresh（输入指纹 + 产物指纹），
 * 陈旧或缺失的 dist 一律退出 2——否则 `--update` 会把陈旧数字冻结进基线，校验也会在错误产物上通过。
 *
 * 用法：
 *   node scripts/check-bundle-budget.mjs            # 校验（需先 pnpm build）
 *   node scripts/check-bundle-budget.mjs --update   # 重新冻结基线（同样拒绝陈旧 dist）
 *
 * 退出码：0 = 通过；1 = 阈值或增长超限；2 = dist 缺失/陈旧、index.html 无 JS 入口、配置不可读。
 */
import { createRequire } from "node:module";
import { brotliCompressSync, gzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// dist 新鲜度复用 scripts/build-inputs.ts 的指纹实现（SSOT，不重写第二套指纹逻辑）：该模块是 TS，
// 靠 Node 类型剥离加载（≥22.18 默认开启；更早的 22.x 由 package.json 的 check:budget 传
// --experimental-strip-types），与 pnpm test 加载 scripts/**/*.test.ts 的方式一致。
import { isBuildFresh } from "./build-inputs.ts";

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

/** 预加载清单的载体：`m.f = ["assets/x.js", ...]`（Vite 固定写法，元素全为路径字面量）。 */
function isPreloadManifestArray(node) {
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(node.left) &&
    ts.isArrayLiteralExpression(node.right) &&
    node.right.elements.length > 0 &&
    node.right.elements.every(isPathLiteral)
  );
}

/** 子树里第一个动态 import 字面量；用于把预加载调用绑回它服务的入口。 */
function firstDynamicImportSpecifier(node) {
  let specifier = null;
  const visit = (current) => {
    if (specifier !== null) return;
    if (ts.isCallExpression(current) && current.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = current.arguments[0];
      if (argument && isPathLiteral(argument)) specifier = argument.text;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return specifier;
}

/**
 * 读取 `__vite__mapDeps` 清单与调用点：`d=(m.f||(m.f=[...]))` 是清单，
 * `__vite__mapDeps([索引])` 是某个动态入口自己的子集（清单本身含同一 chunk 内其它路由的条目）。
 */
function preloadManifestOf(sourceFile) {
  const manifest = [];
  const usages = [];
  const dynamicImports = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        if (argument && isPathLiteral(argument)) {
          dynamicImports.push({ pos: node.getStart(sourceFile), text: argument.text });
        }
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "__vite__mapDeps") {
        const argument = node.arguments[0];
        if (
          argument &&
          ts.isArrayLiteralExpression(argument) &&
          argument.elements.every((e) => ts.isNumericLiteral(e))
        ) {
          usages.push({ node, indexes: argument.elements.map((element) => Number(element.text)) });
        }
      }
    } else if (isPreloadManifestArray(node)) {
      manifest.push(...node.right.elements.filter(isPathLiteral).map((element) => element.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { manifest, usages, dynamicImports };
}

/** 预加载调用的归属入口：优先取包裹调用的动态 import，退化时取源码位置最近的同文件动态 import。 */
function preloadOwnerOf(usage, dynamicImports, sourceFile) {
  let node = usage.node.parent;
  while (node !== undefined) {
    const isSelf =
      ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "__vite__mapDeps";
    if (ts.isCallExpression(node) && !isSelf) {
      for (const argument of node.arguments) {
        const specifier = firstDynamicImportSpecifier(argument);
        if (specifier !== null) return specifier;
      }
    }
    node = node.parent;
  }
  const usagePos = usage.node.getStart(sourceFile);
  const nearest = dynamicImports.filter((item) => item.pos < usagePos).sort((a, b) => b.pos - a.pos)[0];
  return nearest === undefined ? null : nearest.text;
}

/** 该 chunk 声明的「动态入口 → 该入口会预加载的文件」映射（只取该入口自己的索引子集）。 */
function preloadTargetsOf(file) {
  const sourceFile = parseSource(file);
  const { manifest, usages, dynamicImports } = preloadManifestOf(sourceFile);
  const targets = new Map();
  if (manifest.length === 0) return targets;
  for (const usage of usages) {
    const specifier = preloadOwnerOf(usage, dynamicImports, sourceFile);
    if (specifier === null) continue;
    const target = resolveSpecifier(file, specifier);
    if (target === null || !target.endsWith(".js")) continue;
    const files = targets.get(target) ?? new Set();
    for (const index of usage.indexes) {
      const listed = manifest[index];
      const resolved = listed === undefined ? null : resolveSpecifier(file, listed);
      if (resolved !== null) files.add(resolved);
    }
    targets.set(target, files);
  }
  return targets;
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

/** 先剥离 HTML 注释（含未闭合注释），避免注释里的引用被当成真实入口。 */
function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
}

/** 单标签自身的属性表：兼容双引号、单引号与无引号写法，引号内的 `>` 不会截断标签。 */
function attributesOf(tag) {
  const attributes = new Map();
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of tag.matchAll(pattern)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

/**
 * 把 HTML 引用解析为 dist 内真实存在的 `.js` 文件；站外协议（`http:`/`data:`/`//`）、查询串、
 * 越出 dist 的相对路径（`../x.js`）与非 `.js` 引用一律不参与首屏闭包。
 */
function resolveEntryReference(reference) {
  if (reference === undefined || reference === "") return null;
  const clean = reference.split(/[?#]/)[0];
  if (clean === "" || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(clean)) return null;
  const candidate = clean.startsWith("/") ? path.join(distDir, clean.slice(1)) : path.resolve(distDir, clean);
  const relative = path.relative(distDir, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  if (!candidate.endsWith(".js") || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return null;
  return candidate;
}

/**
 * 首屏入口 = dist/index.html 里静态声明的脚本/样式引用，**不限 `/assets/` 前缀**：
 * Vite 之外还有 `public/` 原样拷贝的脚本（如 `/runtime-config.js`），只认 `/assets/` 会静默漏算
 * 首屏真实字节。defer/async 标记的静态引用仍计入——浏览器解析 index.html 时即会请求它们；
 * 动态注入的引用不在 HTML 里，注释里的字符串已先剥离。
 */
function indexEntryFiles() {
  const html = stripHtmlComments(fs.readFileSync(path.join(distDir, "index.html"), "utf8"));
  const files = [];
  for (const match of html.matchAll(/<(?:script|link)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const attributes = attributesOf(match[0]);
    for (const reference of [attributes.get("src"), attributes.get("href")]) {
      const candidate = resolveEntryReference(reference);
      if (candidate !== null) files.push(candidate);
    }
  }
  if (files.length === 0) {
    console.error("dist/index.html 未引用任何 JS 入口，无法计算首屏闭包。");
    process.exit(2);
  }
  return files;
}

/**
 * 路由入口来自首屏闭包里的动态 import；预加载子集来自发起方 chunk 的 `__vite__mapDeps([索引])`，
 * 只取该入口自己的索引项，避免把同一清单里其它路由的 chunk 算进当前路由。
 */
function collectRouteEntries(initialClosure) {
  const routeEntries = new Set();
  const preloadedByEntry = new Map();
  for (const file of initialClosure) {
    for (const target of dynamicImportSpecifiersOf(file)) {
      if (!initialClosure.has(target)) routeEntries.add(target);
    }
    for (const [target, files] of preloadTargetsOf(file)) {
      if (initialClosure.has(target)) continue;
      routeEntries.add(target);
      preloadedByEntry.set(target, mergePreloadFiles(initialClosure, files, preloadedByEntry.get(target)));
    }
  }
  return { routeEntries, preloadedByEntry };
}

/** 合并同一入口在多处声明的预加载文件，并剔除首屏闭包已计入的部分。 */
function mergePreloadFiles(initialClosure, files, existing) {
  const merged = existing ?? new Set();
  for (const preloaded of files) {
    if (!initialClosure.has(preloaded)) merged.add(preloaded);
  }
  return merged;
}

function collectRouteMetrics(initialClosure) {
  const { routeEntries, preloadedByEntry } = collectRouteEntries(initialClosure);
  const metrics = [];
  for (const entry of [...routeEntries].sort()) {
    const reachable = collectClosure([entry, ...(preloadedByEntry.get(entry) ?? [])]);
    const incremental = [...reachable].filter((file) => !initialClosure.has(file));
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

/**
 * dist 必须由当前构建输入生成：脚本直接读 dist，产物陈旧时 `--update` 会把陈旧数字冻结进基线，
 * 校验也会在错误产物上通过（EVID-1：旧产物不能证明当前代码的体积）。
 * 复用 scripts/build-inputs.ts 的 isBuildFresh：清单缺失/损坏、输入变化、任一产物变化都判陈旧。
 */
function assertBuildFresh() {
  if (!fs.existsSync(distDir)) {
    console.error("缺少 frontend/dist，请先运行 pnpm build。");
    process.exit(2);
  }
  if (isBuildFresh(frontendDir, distDir)) return;
  console.error(
    `dist 早于当前构建输入（isBuildFresh=false）：${distDir}\n` +
      "请先运行 pnpm build；如需更新冻结基线，另需 CHG-5 授权（工作区静止并记录 HEAD）。",
  );
  process.exit(2);
}

function main() {
  assertBuildFresh();
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
