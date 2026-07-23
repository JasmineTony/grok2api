import { readFile, readdir, writeFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(root, "src");
const baselinePath = resolve(import.meta.dirname, "architecture-baseline.json");
const writeBaseline = process.argv.includes("--write-baseline");

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(file)));
    else if ([".ts", ".tsx"].includes(extname(entry.name))) files.push(file);
  }
  return files;
}

function add(findings, rule, file, detail) {
  findings.push({ rule, file: relative(root, file).replaceAll("\\", "/"), detail });
}

function imports(content) {
  return Array.from(
    content.matchAll(/(?:from\s+|import\s*)["'](@\/[^"']+)["']/g),
    (match) => match[1],
  );
}

const findings = [];
for (const file of await collect(sourceRoot)) {
  const path = relative(root, file).replaceAll("\\", "/");
  const content = await readFile(file, "utf8");
  const lines = content.split(/\r?\n/);
  const test = /\.(?:test|spec)\.(?:ts|tsx)$/.test(path);
  if (!test && /^(?:export\s+)?(?:let|var)\s+/m.test(content))
    add(findings, "module-mutable-state", file, "module-level let/var is forbidden");
  if (
    !path.startsWith("src/shared/api/") &&
    !path.startsWith("src/features/docs/") &&
    /\bfetch\s*\(/.test(content)
  )
    add(findings, "direct-fetch", file, "use the scoped ApiClient");
  if (
    !test &&
    !path.startsWith("src/shared/storage/") &&
    /\b(?:localStorage|sessionStorage)\b/.test(content)
  )
    add(findings, "direct-storage", file, "use safe-storage");
  if (/\beval\s*\(|new\s+Function\s*\(|\b(?:exec|execSync|spawn|spawnSync)\s*\(/.test(content))
    add(
      findings,
      "dangerous-execution",
      file,
      "dynamic or subprocess execution is forbidden in browser source",
    );
  if (/(?:-page|-workspace|-container)\.tsx$/.test(path) && lines.length > 500)
    add(findings, "oversized-view", file, `${lines.length} lines exceeds 500`);
  if (/^(?:<<<<<<<|=======|>>>>>>>)/m.test(content))
    add(findings, "conflict-marker", file, "unresolved merge marker");

  const featureMatch = path.match(/^src\/features\/([^/]+)\//);
  for (const dependency of imports(content)) {
    if (path.startsWith("src/shared/") && /^@\/(?:features|entities)\//.test(dependency))
      add(findings, "shared-layer-import", file, dependency);
    if (path.startsWith("src/entities/") && dependency.startsWith("@/features/"))
      add(findings, "entity-layer-import", file, dependency);
    if (
      path.startsWith("src/components/ui/") &&
      /^@\/(?:features|entities|shared\/api)\//.test(dependency)
    )
      add(findings, "ui-business-import", file, dependency);
    if (featureMatch && dependency.startsWith("@/features/")) {
      const dependencyDomain = dependency.split("/")[2];
      const publicEntry = dependency.split("/").length === 3;
      if (dependencyDomain && dependencyDomain !== featureMatch[1] && !publicEntry)
        add(findings, "cross-feature-import", file, dependency);
    }
  }
}

const normalized = findings.sort((left, right) =>
  `${left.rule}:${left.file}:${left.detail}`.localeCompare(
    `${right.rule}:${right.file}:${right.detail}`,
  ),
);
if (writeBaseline) {
  await writeFile(baselinePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  console.log(`Architecture baseline written with ${normalized.length} finding(s).`);
  process.exit(0);
}
const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const signature = (item) =>
  `${item.rule}:${item.file}:${item.rule === "oversized-view" ? "" : item.detail}`;
const allowed = new Map(baseline.map((item) => [signature(item), item.detail]));
const regressions = normalized.filter(
  (item) =>
    !allowed.has(signature(item)) ||
    (item.rule === "oversized-view" &&
      Number.parseInt(item.detail, 10) > Number.parseInt(allowed.get(signature(item)), 10)),
);
if (regressions.length > 0) {
  for (const item of regressions) console.error(`[${item.rule}] ${item.file}: ${item.detail}`);
  process.exit(1);
}
console.log(`Architecture audit passed: ${normalized.length} frozen finding(s), no regressions.`);
