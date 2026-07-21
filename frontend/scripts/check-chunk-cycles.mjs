import { readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const assetsDir = fileURLToPath(new URL("../dist/assets/", import.meta.url));
const files = readdirSync(assetsDir).filter((name) => name.endsWith(".js"));
const fileSet = new Set(files);
const graph = new Map();
const staticImportPattern = /(?:from\s*|import\s*)["']\.\/([^"']+\.js)["']/g;

for (const file of files) {
  const source = readFileSync(resolve(assetsDir, file), "utf8");
  const dependencies = new Set();
  for (const match of source.matchAll(staticImportPattern)) {
    if (fileSet.has(match[1])) dependencies.add(match[1]);
  }
  graph.set(file, [...dependencies]);
}

const visiting = new Set();
const visited = new Set();
const stack = [];
const cycles = [];
const signatures = new Set();

function visit(file) {
  if (visiting.has(file)) {
    const start = stack.indexOf(file);
    const cycle = [...stack.slice(start), file];
    const signature = [...new Set(cycle.slice(0, -1))].sort().join("|");
    if (!signatures.has(signature)) {
      signatures.add(signature);
      cycles.push(cycle);
    }
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file);
  stack.push(file);
  for (const dependency of graph.get(file) ?? []) visit(dependency);
  stack.pop();
  visiting.delete(file);
  visited.add(file);
}

for (const file of files) visit(file);

if (cycles.length > 0) {
  console.error("Circular production chunks detected:");
  for (const cycle of cycles) console.error(`- ${cycle.map((file) => basename(file)).join(" -> ")}`);
  process.exit(1);
}

console.log(`Production chunk graph is acyclic (${files.length} JavaScript chunks).`);
