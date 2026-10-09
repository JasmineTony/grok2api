import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

/** 一个 worker 独占的后端进程句柄；stop() 只回收本进程与其临时目录。 */
export type BackendServer = {
  baseURL: string;
  username: string;
  password: string;
  tempDir: string;
  stop: () => Promise<void>;
};

/**
 * 启动期唯一外呼是 GitHub 版本查询。指向本机未监听端口后，未知外呼会立即连接失败，
 * 而不是在真实网络或挂起的代理上等待；该失败非致命，服务仍会提供管理 API。
 */
const unreachableProxy = "http://127.0.0.1:9";
/** 可能指向真实服务的继承变量前缀，必须从子进程环境中剔除。 */
const blockedEnvPrefixes = ["GROK2API_", "TEST_POSTGRES_", "TEST_REDIS_"];
/** 所有代理相关变量：先全部清除，再写入本测试固定值，避免继承真实代理配置。 */
const proxyEnvKeys = [
  "ALL_PROXY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "all_proxy",
  "http_proxy",
  "https_proxy",
  "no_proxy",
];
const startupTimeoutMs = 60_000;
const shutdownTimeoutMs = 10_000;
const probeIntervalMs = 200;
const logTailCharacters = 4_000;

type TestCredentials = {
  username: string;
  password: string;
};

/** 从操作系统动态分配一个仅 loopback 的空闲端口，避免并行 worker 冲突。 */
function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close(() => reject(new Error("无法从动态端口分配中解析端口")));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * 构造子进程环境：剔除可能指向真实服务的继承变量，并固定代理指向未监听端口。
 * 不继承真实 config.yaml 或数据库/Redis/Quality Guard 目标。
 */
function buildChildEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (proxyEnvKeys.includes(key)) continue;
    const normalized = key.toUpperCase();
    if (blockedEnvPrefixes.some((prefix) => normalized.startsWith(prefix))) continue;
    environment[key] = value;
  }
  environment.HTTP_PROXY = unreachableProxy;
  environment.HTTPS_PROXY = unreachableProxy;
  environment.NO_PROXY = "127.0.0.1,localhost";
  return environment;
}

/** 启动一个隔离后端所需的产物路径，由 worker fixture 从构建清单传入。 */
export type BackendServerOptions = {
  binaryPath: string;
  frontendDist: string;
};

/** YAML 双引号字符串中的反斜杠是转义符，统一改写为正斜杠路径。 */
function toYamlPath(value: string): string {
  return value.replaceAll("\\", "/");
}

/** 生成一次性测试配置：临时 SQLite、Memory 运行态、合成凭据、真实生产产物目录。 */
function renderTestConfig(options: {
  port: number;
  tempDir: string;
  frontendDist: string;
  jwtSecret: string;
  credentialEncryptionKey: string;
  credentials: TestCredentials;
}): string {
  return [
    "server:",
    `  listen: "127.0.0.1:${options.port}"`,
    "  swaggerEnabled: false",
    "secrets:",
    `  jwtSecret: "${options.jwtSecret}"`,
    `  credentialEncryptionKey: "${options.credentialEncryptionKey}"`,
    "bootstrapAdmin:",
    `  username: "${options.credentials.username}"`,
    `  password: "${options.credentials.password}"`,
    "frontend:",
    `  staticPath: "${toYamlPath(options.frontendDist)}"`,
    "database:",
    "  driver: sqlite",
    "  sqlite:",
    `    path: "${toYamlPath(path.join(options.tempDir, "backend.db"))}"`,
    "runtimeStore:",
    "  driver: memory",
    "media:",
    "  local:",
    `    path: "${toYamlPath(path.join(options.tempDir, "media"))}"`,
    "",
  ].join("\n");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/** 收集子进程输出尾部，启动失败时用于给出可诊断的错误文本。 */
function captureProcessLog(child: ChildProcess): { value: string } {
  const holder = { value: "" };
  const append = (chunk: Buffer): void => {
    holder.value = `${holder.value}${chunk.toString("utf8")}`.slice(-logTailCharacters);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  return holder;
}

/** 等待 /healthz 返回 200；进程提前退出或超时都抛出含子进程日志的显式错误。 */
async function waitForHealthz(baseURL: string, child: ChildProcess, readLog: () => string): Promise<void> {
  const deadline = Date.now() + startupTimeoutMs;
  let lastFailure = "尚未收到 /healthz 响应";
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const exit = `exitCode=${String(child.exitCode)} signal=${String(child.signalCode)}`;
      throw new Error(`后端进程在就绪前退出（${exit}）\n${readLog()}`);
    }
    try {
      const response = await fetch(`${baseURL}/healthz`);
      if (response.ok) {
        await response.text();
        return;
      }
      lastFailure = `/healthz 返回 HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await delay(probeIntervalMs);
  }
  throw new Error(`后端在 ${startupTimeoutMs}ms 内未就绪：${lastFailure}\n${readLog()}`);
}

/** 只终止本测试启动的进程树，不使用全局进程名匹配。 */
async function stopBackendProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  if (process.platform === "win32" && typeof child.pid === "number") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
  await Promise.race([exited, delay(shutdownTimeoutMs)]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

/** 删除本 worker 的临时目录；Windows 句柄释放有延迟，交给内置重试。 */
function removeTempDir(tempDir: string): void {
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** 写入一次性测试配置并准备媒体目录，返回配置路径与合成凭据。 */
function prepareTestEnvironment(options: { port: number; tempDir: string; frontendDist: string }): {
  configPath: string;
  credentials: TestCredentials;
} {
  const credentials: TestCredentials = {
    username: `e2e-admin-${randomBytes(4).toString("hex")}`,
    password: randomBytes(18).toString("base64url"),
  };
  const configPath = path.join(options.tempDir, "config.yaml");
  mkdirSync(path.join(options.tempDir, "media"), { recursive: true });
  writeFileSync(
    configPath,
    renderTestConfig({
      port: options.port,
      tempDir: options.tempDir,
      frontendDist: options.frontendDist,
      jwtSecret: randomBytes(48).toString("base64url"),
      credentialEncryptionKey: randomBytes(32).toString("base64"),
      credentials,
    }),
    "utf8",
  );
  return { configPath, credentials };
}

/** 启动一个隔离后端：独立端口、独立临时目录、独立进程、合成一次性凭据。 */
export async function startBackendServer(options: BackendServerOptions): Promise<BackendServer> {
  const port = await allocateLoopbackPort();
  const tempDir = mkdtempSync(path.join(tmpdir(), "grok2api-e2e-"));
  const { configPath, credentials } = prepareTestEnvironment({
    port,
    tempDir,
    frontendDist: options.frontendDist,
  });
  const baseURL = `http://127.0.0.1:${port}`;
  const child = spawn(options.binaryPath, ["--config", configPath, "--listen", `127.0.0.1:${port}`], {
    cwd: tempDir,
    env: buildChildEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const log = captureProcessLog(child);

  try {
    await waitForHealthz(baseURL, child, () => log.value);
  } catch (error) {
    await stopBackendProcess(child);
    removeTempDir(tempDir);
    throw error;
  }

  return {
    baseURL,
    username: credentials.username,
    password: credentials.password,
    tempDir,
    stop: async (): Promise<void> => {
      await stopBackendProcess(child);
      removeTempDir(tempDir);
    },
  };
}
