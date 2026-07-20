import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const violations = [];
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      const source = readFileSync(path, "utf8");
      if (/import\s+\*\s+as\s+\w+\s+from\s+["']lucide-react["']/.test(source)) violations.push(path);
      if (/from\s+["']lucide-react\/dynamic["']/.test(source)) violations.push(path);
    }
  }
}
visit(root);
if (violations.length) {
  console.error(`Disallowed aggregate/dynamic Lucide import(s):\n${violations.join("\n")}`);
  process.exit(1);
}
console.log("Lucide import checks passed.");
