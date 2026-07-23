import { readFile, readdir, writeFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(root, "src");
const findings = [];
const baselinePath = resolve(import.meta.dirname, "code-audit-baseline.json");
const writeBaseline = process.argv.includes("--write-baseline");

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else if ([".ts", ".tsx"].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

function report(category, file, detail) {
  findings.push({
    category,
    file: relative(root, file).replaceAll("\\", "/"),
    detail,
  });
}

const files = await collectFiles(sourceRoot);
for (const file of files) {
  const content = await readFile(file, "utf8");
  const lines = content.split(/\r?\n/);
  const normalized = relative(root, file).replaceAll("\\", "/");
  const limit = normalized.includes("/i18n/locales/")
    ? 1200
    : normalized.endsWith("-page.tsx")
      ? 900
      : normalized.includes("/i18n/")
        ? 500
        : 800;
  if (lines.length > limit)
    report("maintainability", file, `${lines.length} lines exceeds ${limit}`);
  if (/\b(?:TODO|FIXME|HACK)\b/.test(content))
    report("quality", file, "contains unresolved TODO/FIXME/HACK marker");
  if (/@ts-(?:ignore|nocheck)|eslint-disable/.test(content))
    report("type-safety", file, "contains a disabled type or lint check");
  if (/(?::\s*any\b|<any>|as\s+any\b)/.test(content))
    report("type-safety", file, "contains an explicit any type");
  if (/console\.log\s*\(/.test(content) && !normalized.startsWith("src/features/docs/"))
    report("quality", file, "contains console.log");
  if (
    content.includes("dangerouslySetInnerHTML") &&
    !["src/components/ui/chart.tsx", "src/shared/security/safe-markdown.tsx"].includes(normalized)
  )
    report("security", file, "uses dangerouslySetInnerHTML outside the reviewed allowlist");
  if (/target=["']_blank["'](?![^>]*\brel=)/.test(content))
    report("security", file, "opens a new tab without rel protection");
}

const testFiles = files.filter((file) => /\.(?:test|spec)\.(?:ts|tsx)$/.test(file));
if (testFiles.length < 8)
  findings.push({
    category: "testing",
    file: "src",
    detail: `${testFiles.length} unit test files; at least 8 are required`,
  });

const normalized = findings.sort((left, right) =>
  `${left.category}:${left.file}:${left.detail}`.localeCompare(
    `${right.category}:${right.file}:${right.detail}`,
  ),
);
if (writeBaseline) {
  await writeFile(baselinePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  console.log(`Code audit baseline written with ${normalized.length} finding(s).`);
  process.exit(0);
}
const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const signature = (finding) => `${finding.category}:${finding.file}`;
const allowed = new Map(baseline.map((finding) => [signature(finding), finding.detail]));
const regressions = normalized.filter((finding) => {
  const previous = allowed.get(signature(finding));
  if (previous === undefined) return true;
  if (finding.category !== "maintainability") return finding.detail !== previous;
  return Number.parseInt(finding.detail, 10) > Number.parseInt(previous, 10);
});
const grouped = Object.groupBy(regressions, (finding) => finding.category);
if (regressions.length === 0) {
  console.log(
    `Code audit passed: ${files.length} source files, ${testFiles.length} unit test files, ${normalized.length} frozen finding(s).`,
  );
  process.exit(0);
}
for (const [category, values] of Object.entries(grouped)) {
  console.error(`\n[${category}]`);
  for (const finding of values ?? []) console.error(`- ${finding.file}: ${finding.detail}`);
}
console.error(`\nCode audit failed with ${regressions.length} regression(s).`);
process.exit(1);
