import { readdir, stat, mkdir, writeFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const frontendRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(frontendRoot, "..");
const distRoot = resolve(frontendRoot, "dist");
const outputRoot = resolve(repositoryRoot, ".cache", "performance-summary");

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(file)));
    else files.push(file);
  }
  return files;
}

function numericEnvironment(name) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function currentCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  } catch {
    return "unknown";
  }
}

const assets = [];
for (const file of await collectFiles(distRoot)) {
  const extension = extname(file);
  if (extension !== ".js" && extension !== ".css") continue;
  const metadata = await stat(file);
  assets.push({
    file: relative(distRoot, file).replaceAll("\\", "/"),
    bytes: metadata.size,
    type: extension.slice(1),
  });
}
assets.sort((left, right) => right.bytes - left.bytes || left.file.localeCompare(right.file));

const report = {
  schemaVersion: 1,
  commit: currentCommit(),
  generatedAt: new Date().toISOString(),
  viewports: [
    { width: 1440, height: 900 },
    { width: 768, height: 1024 },
    { width: 375, height: 812 },
  ],
  webVitals: {
    lcpMs: numericEnvironment("GROK2API_PERF_LCP_MS"),
    cls: numericEnvironment("GROK2API_PERF_CLS"),
    ttfbMs: numericEnvironment("GROK2API_PERF_TTFB_MS"),
  },
  runtime: {
    longTaskCount: numericEnvironment("GROK2API_PERF_LONG_TASK_COUNT"),
    heapUsedBytes: numericEnvironment("GROK2API_PERF_HEAP_USED_BYTES"),
  },
  bundle: {
    assetCount: assets.length,
    totalBytes: assets.reduce((total, asset) => total + asset.bytes, 0),
    largestAssets: assets.slice(0, 20),
  },
  privacy: {
    includesTrace: false,
    includesScreenshots: false,
    includesHeaders: false,
    includesRequestBodies: false,
    includesHeapSnapshot: false,
  },
};

const metric = (value, suffix = "") => (value === null ? "not sampled" : String(value) + suffix);
const markdown = [
  "# Frontend performance summary",
  "",
  "- Commit: `" + report.commit + "`",
  "- Generated: " + report.generatedAt,
  "- LCP: " + metric(report.webVitals.lcpMs, " ms"),
  "- CLS: " + metric(report.webVitals.cls),
  "- TTFB: " + metric(report.webVitals.ttfbMs, " ms"),
  "- Long tasks: " + metric(report.runtime.longTaskCount),
  "- Heap used: " + metric(report.runtime.heapUsedBytes, " bytes"),
  "- Bundle assets: " + report.bundle.assetCount,
  "- Bundle bytes: " + report.bundle.totalBytes,
  "",
  "Only aggregate values are recorded. Raw traces, screenshots, headers, request bodies, and heap snapshots are excluded.",
  "",
].join("\n");

await mkdir(outputRoot, { recursive: true });
await writeFile(
  resolve(outputRoot, "summary.json"),
  JSON.stringify(report, null, 2) + "\n",
  "utf8",
);
await writeFile(resolve(outputRoot, "summary.md"), markdown, "utf8");
console.log("Performance summary written to " + outputRoot);
