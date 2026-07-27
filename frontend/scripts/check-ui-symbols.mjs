import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(root, "src");
const findings = [];
const allowedRawSvg = new Set(["src/shared/security/safe-markdown.test.tsx"]);
const excludedSuffixes = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx", ".d.ts"];
const disallowedIconImports = [
  /from\s+["']react-icons(?:\/[^"']+)?["']/,
  /from\s+["']@heroicons\//,
  /from\s+["']@fortawesome\//,
  /from\s+["']@tabler\/icons/,
  /from\s+["']@iconify\//,
  /from\s+["']phosphor-react["']/,
];
const emojiPattern = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(path)));
    else if ([".ts", ".tsx", ".js", ".jsx"].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

for (const file of await collect(sourceRoot)) {
  const normalized = relative(root, file).replaceAll("\\", "/");
  const source = await readFile(file, "utf8");
  const runtimeSource = !excludedSuffixes.some((suffix) => normalized.endsWith(suffix));
  if (runtimeSource && !allowedRawSvg.has(normalized) && /<svg(?:\s|>)/i.test(source)) {
    findings.push(`${normalized}: raw runtime <svg> is forbidden; use lucide-react`);
  }
  if (runtimeSource && disallowedIconImports.some((pattern) => pattern.test(source))) {
    findings.push(`${normalized}: non-Lucide icon dependency is forbidden`);
  }
  if (runtimeSource) {
    const emojiCandidate = source.replaceAll("©", "").replaceAll("®", "").replaceAll("™", "");
    if (emojiPattern.test(emojiCandidate)) {
      findings.push(`${normalized}: emoji is forbidden in runtime UI text and constants`);
    }
  }
}

if (findings.length > 0) {
  console.error(`UI symbol audit failed:\n${findings.join("\n")}`);
  process.exit(1);
}
console.log("UI symbol audit passed: runtime icons use Lucide and UI text contains no emoji.");
