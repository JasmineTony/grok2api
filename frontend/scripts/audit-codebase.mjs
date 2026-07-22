import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(root, "src");
const findings = [];

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
  if (
    /console\.log\s*\(/.test(content) &&
    normalized !== "src/features/docs/api-docs-page.tsx"
  )
    report("quality", file, "contains console.log");
  if (
    content.includes("dangerouslySetInnerHTML") &&
    ![
      "src/components/ui/chart.tsx",
      "src/shared/security/safe-markdown.tsx",
    ].includes(normalized)
  )
    report(
      "security",
      file,
      "uses dangerouslySetInnerHTML outside the reviewed allowlist",
    );
  if (/target=["']_blank["'](?![^>]*\brel=)/.test(content))
    report("security", file, "opens a new tab without rel protection");
}

const testFiles = files.filter((file) =>
  /\.(?:test|spec)\.(?:ts|tsx)$/.test(file),
);
if (testFiles.length < 8)
  findings.push({
    category: "testing",
    file: "src",
    detail: `${testFiles.length} unit test files; at least 8 are required`,
  });

const grouped = Object.groupBy(findings, (finding) => finding.category);
if (findings.length === 0) {
  console.log(
    `Code audit passed: ${files.length} source files and ${testFiles.length} unit test files checked.`,
  );
  process.exit(0);
}
for (const [category, values] of Object.entries(grouped)) {
  console.error(`\n[${category}]`);
  for (const finding of values ?? [])
    console.error(`- ${finding.file}: ${finding.detail}`);
}
console.error(`\nCode audit failed with ${findings.length} finding(s).`);
process.exit(1);
