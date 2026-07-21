import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const assetsDir = fileURLToPath(new URL("../dist/assets/", import.meta.url));
const budgets = [
  { pattern: /^index-.*\.js$/, maxRaw: 350_000, maxGzip: 115_000, label: "entry JavaScript" },
  { pattern: /^dashboard-page-.*\.js$/, maxRaw: 350_000, maxGzip: 100_000, label: "dashboard route" },
  { pattern: /^dashboard-charts-.*\.js$/, maxRaw: 350_000, maxGzip: 100_000, label: "dashboard charts" },
  { pattern: /^(vendor-(recharts|chart-runtime)|chart)-.*\.js$/, maxRaw: 350_000, maxGzip: 100_000, label: "chart vendor chunk" },
  { pattern: /^createLucideIcon-.*\.js$/, maxRaw: 100_000, maxGzip: 35_000, label: "Lucide shared chunk" },
  { pattern: /^index-.*\.css$/, maxRaw: 90_000, maxGzip: 20_000, label: "application CSS" },
];

const files = readdirSync(assetsDir).map((name) => {
  const filePath = `${assetsDir}/${name}`;
  const raw = statSync(filePath).size;
  const gzip = gzipSync(readFileSync(filePath)).length;
  return { name, raw, gzip };
});
const failures = [];
for (const budget of budgets) {
  const matching = files.filter((file) => budget.pattern.test(basename(file.name)));
  if (matching.length === 0) {
    failures.push(`${budget.label}: expected bundle was not produced`);
    continue;
  }
  for (const file of matching) {
    if (file.raw > budget.maxRaw) failures.push(`${budget.label}: ${file.name} is ${file.raw} raw bytes (budget ${budget.maxRaw})`);
    if (file.gzip > budget.maxGzip) failures.push(`${budget.label}: ${file.name} is ${file.gzip} gzip bytes (budget ${budget.maxGzip})`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Bundle budgets passed.");
