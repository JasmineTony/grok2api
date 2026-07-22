import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(frontendRoot, "..");
const outputDir = resolve(repositoryRoot, ".cache", "chrome-devtools-profile");
const targetURL = process.env.GROK2API_PERF_URL ?? "http://127.0.0.1:8000/login";
const tracePath = resolve(outputDir, "page-load.json.gz");
const heapPath = resolve(outputDir, "page-load.heapsnapshot");
mkdirSync(outputDir, { recursive: true });

const mcpArguments = [
  "-y", "chrome-devtools-mcp@1.6.0",
  "--headless=true", "--isolated=true", "--viewport=1440x900",
  "--memory-debugging=true", "--no-performance-crux", "--no-usage-statistics", "--redact-network-headers=true",
];
const command = process.platform === "win32" ? "cmd.exe" : "npx";
const args = process.platform === "win32" ? ["/d", "/s", "/c", "npx", ...mcpArguments] : mcpArguments;
const server = spawn(command, args, { cwd: repositoryRoot, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
const pending = new Map();
const errors = [];
let nextId = 1;

createInterface({ input: server.stdout }).on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === "roots/list" && message.id != null) {
    send({ jsonrpc: "2.0", id: message.id, result: { roots: [{ uri: pathToFileURL(repositoryRoot).href, name: "grok2api" }] } });
    return;
  }
  if (message.id != null && pending.has(message.id)) {
    const request = pending.get(message.id);
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) {
      request.reject(new Error(JSON.stringify(message.error)));
    } else {
      request.resolve(message.result);
    }
  }
});
createInterface({ input: server.stderr }).on("line", (line) => errors.push(line));

function send(message) {
  server.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(method, params = {}, timeout = 120_000) {
  const id = nextId++;
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Chrome DevTools MCP timed out during ${method}\n${errors.join("\n")}`));
    }, timeout);
    pending.set(id, { resolve: resolvePromise, reject, timer });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

function text(result) {
  return result?.content?.map((item) => item.text ?? "").join("\n") ?? "";
}

async function call(name, argumentsValue = {}, timeout = 300_000) {
  const result = await request("tools/call", { name, arguments: argumentsValue }, timeout);
  if (result?.isError) throw new Error(`${name}: ${text(result)}`);
  return result;
}

try {
  const initialized = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: { roots: { listChanged: false } },
    clientInfo: { name: "grok2api-performance-smoke", version: "1.0.0" },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  await call("new_page", { url: targetURL, isolatedContext: "grok2api-performance-smoke", timeout: 30_000 }, 60_000);
  const trace = await call("performance_start_trace", { reload: true, autoStop: true, filePath: tracePath }, 300_000);
  const runtime = await call("evaluate_script", {
    function: `() => ({
      url: location.href,
      navigation: performance.getEntriesByType("navigation").map((entry) => ({
        duration: entry.duration,
        domContentLoaded: entry.domContentLoadedEventEnd,
        load: entry.loadEventEnd,
        transferSize: entry.transferSize,
      })),
      paints: performance.getEntriesByType("paint").map((entry) => ({ name: entry.name, startTime: entry.startTime })),
      resourceCount: performance.getEntriesByType("resource").length,
    })`,
  }, 60_000);
  const network = await call("list_network_requests", { pageSize: 300 }, 60_000);
  const consoleMessages = await call("list_console_messages", { pageSize: 200 }, 60_000);
  await call("take_heapsnapshot", { filePath: heapPath }, 300_000);
  const heapSummary = await call("get_heapsnapshot_summary", { filePath: heapPath }, 120_000);
  await call("close_heapsnapshot", { filePath: heapPath }, 60_000);
  const report = {
    server: initialized.serverInfo,
    targetURL,
    trace: text(trace),
    runtime: text(runtime),
    network: text(network),
    console: text(consoleMessages),
    heap: text(heapSummary),
  };
  await writeFile(resolve(outputDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Chrome DevTools MCP profile saved to ${outputDir}`);
} finally {
  server.kill();
}
