import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const markdownFiles = execFileSync("git", ["ls-files", "*.md"], { encoding: "utf8" })
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);
const errors = [];
const categories = { valid: [], update: [], compatibility: [], removable: [] };
const indexPath = "docs/plans/README.md";
const planIndex = readFileSync(indexPath, "utf8");

for (const file of markdownFiles) {
  const text = readFileSync(file, "utf8");
  if (text.includes("\uFFFD")) errors.push(`${file}: contains Unicode replacement characters`);
  if (file === "README.zh-CN.md") categories.compatibility.push(file);
  else if (file.startsWith("docs/plans/") && !file.includes("/templates/")) categories.compatibility.push(file);
  else categories.valid.push(file);

  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, "");
    if (!raw || raw.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) continue;
    let target = raw.split("#", 1)[0].split("?", 1)[0];
    try { target = decodeURIComponent(target); } catch { /* report the original path below */ }
    if (!existsSync(resolve(dirname(file), target))) errors.push(`${file}: missing relative link ${raw}`);
  }
}

const trackedPlanFiles = new Set(markdownFiles.filter((file) => file.startsWith("docs/plans/")));
for (const plan of trackedPlanFiles) {
  const match = plan.match(/^docs\/plans\/(\d{4}-\d{2}-\d{2}-\d{2}-[^/]+)\/(PLAN|RESULT)\.md$/);
  if (!match) continue;
  const directory = match[1];
  for (const name of ["PLAN.md", "RESULT.md"]) {
    const expected = `docs/plans/${directory}/${name}`;
    if (!trackedPlanFiles.has(expected)) errors.push(`${directory}: missing ${name}`);
  }
  if (!planIndex.includes(`./${directory}/PLAN.md`) || !planIndex.includes(`./${directory}/RESULT.md`)) {
    errors.push(`${directory}: missing plan index links`);
  }
}

for (const row of planIndex.split(/\r?\n/)) {
  if (!row.startsWith("|") || !/\|\s*Complete\s*\|\s*$/.test(row)) continue;
  const resultMatch = row.match(/\[Result\]\(\.\/(.+?)\/RESULT\.md\)/);
  if (!resultMatch) continue;
  const resultPath = `docs/plans/${resultMatch[1]}/RESULT.md`;
  const result = readFileSync(resultPath, "utf8");
  if (!/(?:Status:\s*Complete|状态：完成|当前状态：完成)/i.test(result)) {
    errors.push(`${resultPath}: index says Complete but result status is not complete`);
    categories.update.push(resultPath);
  }
}

const rootPlanFiles = markdownFiles.filter((file) => !file.includes("/") && /(?:plan|计划)/i.test(file) && file !== "AGENTS.md");
for (const file of rootPlanFiles) errors.push(`${file}: root-level plan files are not allowed`);

console.log(JSON.stringify({ total: markdownFiles.length, categories }, null, 2));
if (errors.length > 0) {
  console.error(`Markdown audit failed with ${errors.length} finding(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Markdown audit passed: ${markdownFiles.length} tracked Markdown files, no removable files.`);
