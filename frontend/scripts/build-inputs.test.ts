import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";

import { build, type InlineConfig } from "vite";

import { createViteConfig } from "../vite.config.ts";
import { BUILD_MANIFEST_FILE, buildInputHash, isBuildFresh, writeBuildManifest } from "./build-inputs.ts";

const inputOptions = { environment: {} };
const fixtureFiles: Record<string, string> = {
  "package.json": '{"type":"module"}',
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  "pnpm-workspace.yaml": "minimumReleaseAge: 1440\n",
  "index.html": '<html><script type="module" src="/src/main.js"></script></html>',
  "vite.config.ts": "export default {};\n",
  "vitest.config.ts": "export default {};\n",
  "tsconfig.json": "{}\n",
  "tsconfig.app.json": "{}\n",
  "tsconfig.node.json": "{}\n",
  "scripts/build-inputs.ts": "export {};\n",
  "src/main.js": 'document.body.textContent = "fixture";\n',
  "src/main.test.ts": "// 测试文件也可能含 Tailwind 类名\n",
  "src/latest-price.ts": "export const price = 1;\n",
  "public/nested/icon.svg": "<svg/>\n",
  "dist/index.html": '<html><script src="/assets/app.js"></script></html>',
  "dist/assets/app.js": "console.log('fixture');\n",
  "dist/nested/icon.svg": "<svg/>\n",
};

function writeFixtureFile(root: string, name: string, contents: string): void {
  const file = path.join(root, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents, "utf8");
}

function fixture(t: TestContext, reverse = false): { root: string; outDir: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "grok2api-build-inputs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const entries = Object.entries(fixtureFiles);
  for (const [name, contents] of reverse ? entries.reverse() : entries) writeFixtureFile(root, name, contents);
  const outDir = path.join(root, "dist");
  writeBuildManifest(outDir, buildInputHash(root, inputOptions));
  assert.equal(isBuildFresh(root, outDir, inputOptions), true);
  return { root, outDir };
}

/** Windows 未开启开发者模式时无法创建符号链接；junction 无需特权且 lstat 同样判定为符号链接，POSIX 忽略该类型参数。 */
function linkDirectory(target: string, linkPath: string): void {
  mkdirSync(path.dirname(linkPath), { recursive: true });
  symlinkSync(target, linkPath, "junction");
}

/** 取回错误文案；调用没有抛错本身就是缺陷，必须让用例失败而不是静默通过。 */
function failureMessage(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("期望调用抛错，但它成功返回");
}

function fixtureViteConfig(root: string): InlineConfig {
  return {
    ...createViteConfig({ command: "build", mode: "production" }),
    root,
    configFile: false,
    logLevel: "silent",
  };
}

describe("构建内容指纹", () => {
  it("相同内容不受根路径、文件创建顺序与 mtime 影响，清单无自引用", (t) => {
    const first = fixture(t);
    const second = fixture(t, true);
    utimesSync(path.join(second.root, "src/main.js"), 1, 1);
    assert.equal(buildInputHash(first.root, inputOptions), buildInputHash(second.root, inputOptions));
    assert.equal(isBuildFresh(second.root, second.outDir, inputOptions), true);
    const manifestPath = path.join(first.outDir, BUILD_MANIFEST_FILE);
    const initial = readFileSync(manifestPath, "utf8");
    writeBuildManifest(first.outDir, buildInputHash(first.root, inputOptions));
    assert.equal(readFileSync(manifestPath, "utf8"), initial);
    assert.equal(initial.includes(first.root), false);
    assert.equal(readFileSync(path.join(second.outDir, BUILD_MANIFEST_FILE), "utf8"), initial);
  });

  for (const name of [
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "package.json",
    "index.html",
    "vite.config.ts",
    "vitest.config.ts",
    "tsconfig.json",
    "tsconfig.app.json",
    "tsconfig.node.json",
    "scripts/build-inputs.ts",
    "public/nested/icon.svg",
    "src/main.js",
    "src/latest-price.ts",
    "src/main.test.ts",
  ]) {
    it(`${name} 内容变化必须失效`, (t) => {
      const { root, outDir } = fixture(t);
      writeFixtureFile(root, name, `${fixtureFiles[name]}\n// changed`);
      assert.equal(isBuildFresh(root, outDir, inputOptions), false);
      writeFixtureFile(root, name, fixtureFiles[name]);
      assert.equal(isBuildFresh(root, outDir, inputOptions), true);
    });
  }

  it("新增或修改 scripts 下的非测试文件必须失效", (t) => {
    const { root, outDir } = fixture(t);
    writeFixtureFile(root, "scripts/vite-plugins.ts", "export const plugin = () => ({});\n");
    assert.equal(isBuildFresh(root, outDir, inputOptions), false);
    writeBuildManifest(outDir, buildInputHash(root, inputOptions));
    assert.equal(isBuildFresh(root, outDir, inputOptions), true);
    writeFixtureFile(root, "scripts/vite-plugins.ts", 'export const plugin = () => ({ name: "changed" });\n');
    assert.equal(isBuildFresh(root, outDir, inputOptions), false);
  });

  it("仅新增或修改 scripts 下的测试文件不改变指纹", (t) => {
    const { root, outDir } = fixture(t);
    const inputHash = buildInputHash(root, inputOptions);
    for (const name of ["scripts/vite-plugins.test.ts", "scripts/build-inputs.spec.ts"]) {
      writeFixtureFile(root, name, "// 脚本测试不参与构建指纹\n");
      assert.equal(buildInputHash(root, inputOptions), inputHash);
    }
    writeFixtureFile(root, "scripts/vite-plugins.test.ts", "// 修改脚本测试内容\n");
    assert.equal(buildInputHash(root, inputOptions), inputHash);
    assert.equal(isBuildFresh(root, outDir, inputOptions), true);
  });

  for (const name of ["pnpm-lock.yaml", "public/nested/icon.svg", "src/latest-price.ts"]) {
    it(`删除 ${name} 必须失效`, (t) => {
      const { root, outDir } = fixture(t);
      rmSync(path.join(root, name));
      assert.equal(isBuildFresh(root, outDir, inputOptions), false);
    });
  }

  it("新增与同内容重命名业务文件必须失效", (t) => {
    const { root, outDir } = fixture(t);
    renameSync(path.join(root, "src/latest-price.ts"), path.join(root, "src/current-price.ts"));
    assert.equal(isBuildFresh(root, outDir, inputOptions), false);
    renameSync(path.join(root, "src/current-price.ts"), path.join(root, "src/latest-price.ts"));
    writeFixtureFile(root, "public/added.svg", "<svg/>");
    assert.equal(isBuildFresh(root, outDir, inputOptions), false);
  });

  it("保留或回退 mtime 的等长源码变更不能沿用旧产物", (t) => {
    const { root, outDir } = fixture(t);
    const source = path.join(root, "src/latest-price.ts");
    const index = path.join(outDir, "index.html");
    utimesSync(source, 1000, 1000);
    utimesSync(index, 2000, 2000);
    writeFixtureFile(root, "src/latest-price.ts", "export const price = 2;\n");
    for (const mtime of [1000, 1]) {
      utimesSync(source, mtime, mtime);
      assert.ok(statSync(index).mtimeMs >= statSync(source).mtimeMs, "旧 mtime 比较会错误放行");
      assert.equal(isBuildFresh(root, outDir, inputOptions), false);
    }
  });

  for (const name of [
    ".env.production",
    ".env.local",
    ".npmrc",
    "postcss.config.js",
    "tailwind.config.ts",
    "node_modules/.pnpm/lock.yaml",
    "node_modules/vite/package.json",
  ]) {
    it(`新增构建/工具链输入 ${name} 必须失效`, (t) => {
      const { root, outDir } = fixture(t);
      writeFixtureFile(root, name, "synthetic-build-input");
      assert.equal(isBuildFresh(root, outDir, inputOptions), false);
    });
  }

  it("环境只影响摘要，不将秘密原文写入清单；无关环境不影响指纹", (t) => {
    const { root, outDir } = fixture(t);
    const secret = "synthetic-secret-not-for-output";
    writeFixtureFile(root, ".env.production", `PRIVATE_TOKEN=${secret}`);
    const environment = { VITE_PUBLIC_LABEL: secret, NODE_ENV: "production" };
    const inputHash = buildInputHash(root, { environment });
    assert.equal(inputHash, buildInputHash(root, { environment: { ...environment, PRIVATE_TOKEN: "unrelated" } }));
    assert.notEqual(inputHash, buildInputHash(root, { environment: { ...environment, VITE_PUBLIC_LABEL: "changed" } }));
    assert.notEqual(inputHash, buildInputHash(root, { environment, mode: "staging" }));
    writeBuildManifest(outDir, inputHash);
    assert.equal(readFileSync(path.join(outDir, BUILD_MANIFEST_FILE), "utf8").includes(secret), false);
    assert.equal(isBuildFresh(root, outDir, { environment }), true);
  });

  for (const name of ["index.html", "assets/app.js", "nested/icon.svg", BUILD_MANIFEST_FILE]) {
    it(`缺失产物 ${name} 必须失效`, (t) => {
      const { root, outDir } = fixture(t);
      rmSync(path.join(outDir, name));
      assert.equal(isBuildFresh(root, outDir, inputOptions), false);
    });
    it(`损坏产物 ${name} 必须失效`, (t) => {
      const { root, outDir } = fixture(t);
      writeFixtureFile(outDir, name, "corrupt");
      assert.equal(isBuildFresh(root, outDir, inputOptions), false);
    });
  }

  it("空入口、错误清单结构、额外产物和整个 dist 缺失必须失效", (t) => {
    const { root, outDir } = fixture(t);
    writeFixtureFile(outDir, "index.html", "");
    assert.equal(isBuildFresh(root, outDir, inputOptions), false);
    assert.throws(() => writeBuildManifest(outDir, buildInputHash(root, inputOptions)), /入口/);
    writeFixtureFile(outDir, "index.html", fixtureFiles["dist/index.html"]);
    for (const value of [null, {}, { version: 1, inputHash: 1, outputHash: [] }, { version: 99 }]) {
      writeFixtureFile(outDir, BUILD_MANIFEST_FILE, JSON.stringify(value));
      assert.equal(isBuildFresh(root, outDir, inputOptions), false);
    }
    writeBuildManifest(outDir, buildInputHash(root, inputOptions));
    writeFixtureFile(outDir, "extra.js", "unexpected");
    assert.equal(isBuildFresh(root, outDir, inputOptions), false);
    rmSync(outDir, { recursive: true });
    assert.equal(isBuildFresh(root, outDir, inputOptions), false);
  });

  it("清单或入口被目录替换也判定为产物缺损", (t) => {
    for (const name of [BUILD_MANIFEST_FILE, "index.html"]) {
      const { root, outDir } = fixture(t);
      rmSync(path.join(outDir, name));
      mkdirSync(path.join(outDir, name));
      assert.equal(isBuildFresh(root, outDir, inputOptions), false);
    }
  });

  it("读取失败不静默降级成空输入", (t) => {
    const { root } = fixture(t);
    rmSync(path.join(root, "pnpm-lock.yaml"));
    mkdirSync(path.join(root, "pnpm-lock.yaml"));
    assert.throws(() => buildInputHash(root, inputOptions));
  });

  it("具名输入被替换为符号链接必须显式失败并含相对路径，不得静默跟随目标内容", (t) => {
    const { root, outDir } = fixture(t);
    writeFixtureFile(root, "synthetic-link-target/payload.ts", "export const payload = 1;\n");
    rmSync(path.join(root, "pnpm-lock.yaml"));
    linkDirectory(path.join(root, "synthetic-link-target"), path.join(root, "pnpm-lock.yaml"));
    const message = failureMessage(() => buildInputHash(root, inputOptions));
    assert.match(message, /^构建指纹不支持符号链接：pnpm-lock\.yaml$/);
    assert.equal(message.includes(root), false, "错误文案不得泄漏本机绝对路径");
    assert.equal(
      failureMessage(() => isBuildFresh(root, outDir, inputOptions)),
      message,
    );
  });

  it("目录树内的符号链接与具名输入共用同一软链判定与相对路径格式", (t) => {
    const { root, outDir } = fixture(t);
    writeFixtureFile(root, "synthetic-link-target/payload.ts", "export const payload = 1;\n");
    linkDirectory(path.join(root, "synthetic-link-target"), path.join(root, "src/vendor"));
    const message = failureMessage(() => buildInputHash(root, inputOptions));
    assert.match(message, /^构建指纹不支持符号链接：src\/vendor$/);
    assert.equal(message.includes(root), false, "错误文案不得泄漏本机绝对路径");
    assert.equal(
      failureMessage(() => isBuildFresh(root, outDir, inputOptions)),
      message,
    );
  });

  it("isBuildFresh 必须向上抛出输入读取错误，而不是把错误当成陈旧产物", (t) => {
    const { root, outDir } = fixture(t);
    rmSync(path.join(root, "pnpm-lock.yaml"));
    mkdirSync(path.join(root, "pnpm-lock.yaml"));
    const isDirectoryReadError = (error: unknown): boolean =>
      error instanceof Error && "code" in error && error.code === "EISDIR";
    assert.throws(() => buildInputHash(root, inputOptions), isDirectoryReadError);
    assert.throws(() => isBuildFresh(root, outDir, inputOptions), isDirectoryReadError);
  });

  it("包管理器建立的中间目录软链不误报，其目标仍按内容参与指纹", (t) => {
    const { root, outDir } = fixture(t);
    const baseline = buildInputHash(root, inputOptions);
    writeFixtureFile(root, "synthetic-store/vite/package.json", '{"name":"vite","version":"0.0.0"}\n');
    linkDirectory(path.join(root, "synthetic-store/vite"), path.join(root, "node_modules/vite"));
    const linked = buildInputHash(root, inputOptions);
    assert.notEqual(linked, baseline, "经中间目录软链解析的工具链输入必须参与指纹");
    writeBuildManifest(outDir, linked);
    assert.equal(isBuildFresh(root, outDir, inputOptions), true);
    writeFixtureFile(root, "synthetic-store/vite/package.json", '{"name":"vite","version":"0.0.1"}\n');
    assert.equal(isBuildFresh(root, outDir, inputOptions), false, "软链目标的修改必须使构建失效");
  });
});

describe("Vite 构建接线（只使用隔离合成 fixture）", () => {
  it("仅开发 serve 注入代理目标，build/test/preview 均为空且不配置开发代理", (t) => {
    const previous = process.env.VITE_DEV_API_TARGET;
    process.env.VITE_DEV_API_TARGET = "https://synthetic-secret.invalid";
    t.after(() => {
      if (previous === undefined) delete process.env.VITE_DEV_API_TARGET;
      else process.env.VITE_DEV_API_TARGET = previous;
    });
    const dev = createViteConfig({ command: "serve", mode: "development" });
    assert.equal(dev.define?.__GROK2API_DEV_API_TARGET__, JSON.stringify(process.env.VITE_DEV_API_TARGET));
    assert.equal(dev.server?.proxy?.["/api"], process.env.VITE_DEV_API_TARGET);
    for (const config of [
      createViteConfig({ command: "build", mode: "production" }),
      createViteConfig({ command: "serve", mode: "test" }),
      createViteConfig({ command: "build", mode: "test" }),
      createViteConfig({ command: "serve", mode: "production", isPreview: true }),
    ]) {
      assert.equal(config.define?.__GROK2API_DEV_API_TARGET__, '""');
      assert.equal(config.server?.proxy, undefined);
    }
  });

  it("实际 Vite 写出可复用清单；失败构建不留下成功清单", async (t) => {
    const { root, outDir } = fixture(t);
    await build(fixtureViteConfig(root));
    assert.equal(isBuildFresh(root, outDir), true);
    writeFixtureFile(root, "src/main.js", 'import "./does-not-exist.js";');
    await assert.rejects(build(fixtureViteConfig(root)));
    assert.equal(existsSync(path.join(outDir, BUILD_MANIFEST_FILE)), false);
    assert.equal(isBuildFresh(root, outDir), false);
  });

  it("产物写入阶段失败不能留下成功清单", async (t) => {
    const { root, outDir } = fixture(t);
    const config = fixtureViteConfig(root);
    config.plugins = [
      ...(config.plugins ?? []),
      {
        name: "fixture-write-failure",
        writeBundle() {
          throw new Error("合成写入失败");
        },
      },
    ];
    await assert.rejects(build(config), /合成写入失败/);
    assert.equal(existsSync(path.join(outDir, BUILD_MANIFEST_FILE)), false);
  });

  it("构建期间输入变化应显式失败，而不是给混合产物登记新鲜指纹", async (t) => {
    const { root, outDir } = fixture(t);
    const config = fixtureViteConfig(root);
    config.plugins = [
      ...(config.plugins ?? []),
      { name: "fixture-change-input", writeBundle: () => writeFixtureFile(root, "public/changed.txt", "changed") },
    ];
    await assert.rejects(build(config), /构建期间输入发生变化/);
    assert.equal(existsSync(path.join(outDir, BUILD_MANIFEST_FILE)), false);
  });
});
