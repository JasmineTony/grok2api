import { readdirSync, statSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const assetsDir = fileURLToPath(new URL("../dist/assets/", import.meta.url));
const budgets = [
  { pattern: /^index-.*\.js$/, maxBytes: 470_000, label: "entry JavaScript" },
  { pattern: /^dashboard-page-.*\.js$/, maxBytes: 470_000, label: "dashboard route" },
  { pattern: /^createLucideIcon-.*\.js$/, maxBytes: 270_000, label: "Lucide shared chunk" },
  { pattern: /^index-.*\.css$/, maxBytes: 95_000, label: "application CSS" },
];

const files = readdirSync(assetsDir).map((name) => ({ name, bytes: statSync(`${assetsDir}/${name}`).size }));
const failures = [];
for (const budget of budgets) {
  const matching = files.filter((file) => budget.pattern.test(basename(file.name)));
  if (matching.length === 0) {
    failures.push(`${budget.label}: expected bundle was not produced`);
    continue;
  }
  for (const file of matching) {
    if (file.bytes > budget.maxBytes) failures.push(`${budget.label}: ${file.name} is ${file.bytes} bytes (budget ${budget.maxBytes})`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Bundle budgets passed.");
