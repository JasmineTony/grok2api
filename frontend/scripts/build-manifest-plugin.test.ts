import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";

import { build, type InlineConfig, type Plugin } from "vite";

import { createViteConfig } from "../vite.config.ts";
import { BUILD_MANIFEST_FILE, buildInputHash, isBuildFresh, writeBuildManifest } from "./build-inputs.ts";
import { createBuildManifestGate, type BuildManifestGate } from "./build-manifest-plugin.ts";

/** 指纹口径与插件一致：mode=production + 当前进程环境；合成的 root 越简单越能定位差异。 */
const buildOptions = { mode: "production", environment: process.env };

type Fixture = { root: string; outDir: string; manifestPath: string };

function writeFixtureFile(root: string, name: string, contents: string): void {
  const file = path.join(root, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents, "utf8");
}

/** 最小合成构建现场：输入指纹只需可读的 root，产物只需非空普通入口文件与一个资源。 */
function fixture(t: TestContext): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "grok2api-build-manifest-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFixtureFile(root, "index.html", '<html><script type="module" src="/src/main.js"></script></html>');
  writeFixtureFile(root, "src/main.js", 'document.body.textContent = "fixture";\n');
  const outDir = path.join(root, "dist");
  writeFixtureFile(outDir, "index.html", '<html><script type="module" src="/assets/app.js"></script></html>');
  writeFixtureFile(outDir, "assets/app.js", 'console.log("fixture");\n');
  return { root, outDir, manifestPath: path.join(outDir, BUILD_MANIFEST_FILE) };
}

/** 与插件的 configResolved 等价：outDir 传入未解析值，由闸门按 root 解析。 */
function createGate(at: Fixture): BuildManifestGate {
  const gate = createBuildManifestGate();
  gate.configure({ root: at.root, outDir: "dist", mode: "production" });
  return gate;
}

/** 用「目标路径被目录占据」注入写入失败：Windows 与 POSIX 均返回 EISDIR。 */
function occupyManifestPath(manifestPath: string): void {
  rmSync(manifestPath, { force: true, recursive: true });
  mkdirSync(manifestPath);
}

function readManifest(manifestPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
}

describe("构建清单闸门：成功路径", () => {
  it("成功构建登记可复用清单，且清单不含绝对路径", (t) => {
    const at = fixture(t);
    const gate = createGate(at);
    gate.begin();
    gate.markWritten();
    gate.commit();

    assert.equal(isBuildFresh(at.root, at.outDir, buildOptions), true);
    const manifest = readManifest(at.manifestPath);
    assert.equal(manifest.version, 1);
    assert.equal(manifest.inputHash, buildInputHash(at.root, buildOptions));
    assert.match(String(manifest.outputHash), /^[a-f0-9]{64}$/);
    assert.equal(readFileSync(at.manifestPath, "utf8").includes(at.root), false);
  });

  it("rolldown 会二次调用 closeBundle，重复 commit 保持清单内容不变", (t) => {
    const at = fixture(t);
    const gate = createGate(at);
    gate.begin();
    gate.markWritten();
    gate.commit();
    const first = readFileSync(at.manifestPath, "utf8");

    gate.commit();

    assert.equal(readFileSync(at.manifestPath, "utf8"), first);
    assert.equal(isBuildFresh(at.root, at.outDir, buildOptions), true);
  });

  it("begin 清理上一轮清单，且未进入写出阶段时 commit 不登记清单", (t) => {
    const at = fixture(t);
    writeBuildManifest(at.outDir, buildInputHash(at.root, buildOptions));
    assert.equal(existsSync(at.manifestPath), true);

    const gate = createGate(at);
    gate.begin();

    assert.equal(existsSync(at.manifestPath), false);
    gate.commit();
    assert.equal(existsSync(at.manifestPath), false);
    assert.equal(isBuildFresh(at.root, at.outDir, buildOptions), false);
  });
});

describe("构建清单闸门：失败路径", () => {
  it("构建阶段失败后即便写出阶段曾执行过也不得登记清单（`failed ||` 的判据）", (t) => {
    // 驱动顺序取自实测（vite 8 / rolldown 1.2.13 探针）：buildEnd 先收到 error，writeBundle 随后
    // 才可能执行。真实构建里「失败后仍写出」不可达，因此该子条件只能由本用例直接驱动闸门来定判据——
    // 这正是它此前没有判别力用例的原因。判据：删除 commit 的 `failed ||` 后本用例失败，
    // commit 会写出清单，existsSync(manifestPath) 变成 true。
    const at = fixture(t);
    const gate = createGate(at);
    gate.begin();
    gate.finish(new Error("合成的构建阶段失败"));
    gate.markWritten();

    gate.commit();

    assert.equal(existsSync(at.manifestPath), false);
    assert.equal(isBuildFresh(at.root, at.outDir, buildOptions), false);
  });

  it("清单写入失败（路径被目录占据）时 commit 抛出，且不留下成功清单", (t) => {
    const at = fixture(t);
    const gate = createGate(at);
    gate.begin();
    gate.markWritten();
    occupyManifestPath(at.manifestPath);

    assert.throws(
      () => gate.commit(),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "EISDIR",
    );

    assert.equal(lstatSync(at.manifestPath).isDirectory(), true);
    assert.equal(isBuildFresh(at.root, at.outDir, buildOptions), false);

    // 反向控制：撤销注入后同一路径立刻可写出，证明抛错来自注入条件而不是路径本身不可用。
    rmSync(at.manifestPath, { recursive: true, force: true });
    gate.commit();
    assert.equal(isBuildFresh(at.root, at.outDir, buildOptions), true);
  });

  it("产物目录缺失时 commit 显式抛错，不登记未知产物", (t) => {
    const at = fixture(t);
    const gate = createGate(at);
    gate.begin();
    gate.markWritten();
    rmSync(at.outDir, { recursive: true, force: true });

    assert.throws(
      () => gate.commit(),
      (error: unknown) => error instanceof Error && /ENOENT/.test(error.message),
    );

    assert.equal(existsSync(at.manifestPath), false);
  });

  it("构建期间输入变化时 commit 显式失败，不登记混合产物", (t) => {
    const at = fixture(t);
    const gate = createGate(at);
    gate.begin();
    gate.markWritten();
    writeFixtureFile(at.root, "public/changed.txt", "changed");

    assert.throws(() => gate.commit(), /构建期间输入发生变化/);
    assert.equal(existsSync(at.manifestPath), false);
  });
});

describe("写入函数的失败路径（抽取逻辑直调）", () => {
  it("清单路径被目录占据时 writeBuildManifest 抛出且不产出可读成功清单", (t) => {
    const at = fixture(t);
    writeBuildManifest(at.outDir, buildInputHash(at.root, buildOptions));
    assert.equal(isBuildFresh(at.root, at.outDir, buildOptions), true);

    occupyManifestPath(at.manifestPath);

    assert.throws(() => writeBuildManifest(at.outDir, buildInputHash(at.root, buildOptions)), /EISDIR/);
    assert.equal(lstatSync(at.manifestPath).isDirectory(), true);
    assert.equal(isBuildFresh(at.root, at.outDir, buildOptions), false);
  });
});

describe("Vite 真实构建接线（合成 fixture）", () => {
  /** 与 vite.config.ts 同源配置，只替换 root 并关闭配置加载与日志。 */
  function fixtureViteConfig(root: string, plugins: Plugin[]): InlineConfig {
    const base = createViteConfig({ command: "build", mode: "production" });
    return { ...base, root, configFile: false, logLevel: "silent", plugins: [...(base.plugins ?? []), ...plugins] };
  }

  it("清单写入失败时真实构建显式失败，且不留下成功清单", async (t) => {
    const at = fixture(t);
    // 在闸门登记之前（writeBundle 阶段）占据清单路径，模拟磁盘层写入失败。
    const occupy: Plugin = {
      name: "fixture-occupy-manifest",
      writeBundle: {
        order: "post",
        sequential: true,
        handler() {
          occupyManifestPath(at.manifestPath);
        },
      },
    };

    await assert.rejects(build(fixtureViteConfig(at.root, [occupy])), /EISDIR/);

    assert.equal(lstatSync(at.manifestPath).isDirectory(), true);
    assert.equal(isBuildFresh(at.root, at.outDir, buildOptions), false);
  });
});
