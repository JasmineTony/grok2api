import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const result = spawnSync(
  process.execPath,
  ["--max-old-space-size=4096", resolve("node_modules", "knip", "bin", "knip.js")],
  {
    cwd: process.cwd(),
    env: { ...process.env, KNIP_DISABLE_RAW_TRANSFER: "1" },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
