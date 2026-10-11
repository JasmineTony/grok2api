import { rmSync } from "node:fs";
import path from "node:path";

import type { Plugin } from "vite";

import { BUILD_MANIFEST_FILE, buildInputHash, writeBuildManifest } from "./build-inputs.ts";

/** 指纹口径：mode 与公开环境变量参与摘要，必须取 Vite 解析后的真实值。 */
type ManifestInputOptions = { mode: string; environment: NodeJS.ProcessEnv };

/**
 * 构建清单闸门：把「成功写出产物」这一事实与 Vite 生命周期解耦，便于逐钩子单测。
 *
 * 登记成功清单需要同时满足两个条件（见 commit）：
 * - 构建未失败（finish 未收到 error）：失败构建的产物不能登记为可复用；
 * - 写出阶段确实执行过（markWritten 被调用）：未写出产物时不得凭空登记。
 */
export type BuildManifestGate = {
  /** 对应 configResolved：固定构建根、产物目录与指纹口径。`outDir` 为 Vite 未解析的相对路径。 */
  configure(config: { root: string; outDir: string; mode: string }): void;
  /** 对应 buildStart：清理上一轮清单并记录本轮输入指纹。 */
  begin(): void;
  /** 对应 buildEnd：记录构建阶段是否失败。 */
  finish(error: unknown): void;
  /** 对应 writeBundle：标记产物写出阶段已执行。 */
  markWritten(): void;
  /** 对应 closeBundle：满足闸门时登记清单；输入变化或写入失败都必须显式抛错。 */
  commit(): void;
};

/** 创建一个构建清单闸门；实例状态与单次构建绑定。 */
export function createBuildManifestGate(): BuildManifestGate {
  const options: ManifestInputOptions = { mode: "production", environment: { ...process.env } };
  let root = "";
  let outDir = "";
  let inputHash = "";
  let written = false;
  let failed = false;
  return {
    configure(config) {
      root = config.root;
      outDir = path.resolve(root, config.outDir);
      options.mode = config.mode;
    },
    begin() {
      written = false;
      failed = false;
      rmSync(path.join(outDir, BUILD_MANIFEST_FILE), { force: true, recursive: true });
      inputHash = buildInputHash(root, options);
    },
    finish(error) {
      failed = Boolean(error);
    },
    markWritten() {
      written = true;
    },
    commit() {
      if (failed || !written) return;
      if (inputHash !== buildInputHash(root, options)) throw new Error("前端构建期间输入发生变化，请重新构建");
      writeBuildManifest(outDir, inputHash);
    },
  };
}

/** 生产构建插件：把 Vite 生命周期钩子接到闸门上，仅为成功写出的构建留下新鲜产物签名。 */
export function buildManifestPlugin(): Plugin {
  const gate = createBuildManifestGate();
  return {
    name: "grok2api-build-manifest",
    apply: "build",
    configResolved(config) {
      gate.configure({ root: config.root, outDir: config.build.outDir, mode: config.mode });
    },
    buildStart() {
      gate.begin();
    },
    buildEnd(error) {
      gate.finish(error);
    },
    writeBundle: {
      order: "post",
      sequential: true,
      handler() {
        gate.markWritten();
      },
    },
    closeBundle: {
      order: "post",
      sequential: true,
      handler() {
        gate.commit();
      },
    },
  };
}
