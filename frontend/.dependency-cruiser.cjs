/**
 * 依赖边界与循环检查（AGENTS.md DEV-3 / DEV-4）。
 *
 * 目标：把「分层方向」和「跨 feature 直接依赖」变成可执行门禁，而不是人工约定。
 * 已冻结的跨 feature 依赖属于阶段 3 的整改范围，列在 frozenCrossFeatureDebt 中：
 * 该清单只能收缩，不能扩张；修完一处就从清单里删掉。
 */
const fs = require("node:fs");
const path = require("node:path");

const featuresDir = path.join(__dirname, "src", "features");
const features = fs
  .readdirSync(featuresDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

// 阶段 3 待整改：source feature -> 允许的 target feature（存量债务，只允许删除条目）
const frozenCrossFeatureDebt = {
  accounts: ["settings"],
  audits: ["accounts", "client-keys"],
  "creative-console": ["client-keys", "media"],
  dashboard: ["system"],
  "quality-guard": ["accounts", "settings"],
  settings: ["system"],
};

const crossFeatureRules = features.map((name) => {
  const allowedTargets = frozenCrossFeatureDebt[name] ?? [];
  return {
    name: `no-cross-feature-${name}`,
    comment:
      `${name} 不得直接依赖其他 feature。多个 feature 共用的只读 DTO/查询应下沉到 entities/* 或 shared/*；` +
      `frozenCrossFeatureDebt 中的例外是待整改存量债务，不得新增。`,
    severity: "error",
    from: { path: `^src/features/${name}/` },
    to: {
      path: "^src/features/",
      pathNot: [`^src/features/${name}/`, ...allowedTargets.map((target) => `^src/features/${target}/`)],
    },
  };
});

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "禁止循环依赖：循环会让拆分与测试隔离失效。",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      comment: "禁止无法解析的导入：通常是路径或别名错误，构建期才发现成本更高。",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "lower-layers-must-not-import-upper",
      comment:
        "shared / entities / components 属于下层，不得反向依赖 app 或 features；" +
        "上层可以依赖下层，反向依赖会破坏分层与懒加载边界。",
      severity: "error",
      from: { path: "^src/(shared|entities|components)/" },
      to: { path: "^src/(app|features)/" },
    },
    ...crossFeatureRules,
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // 集成测试需要跨 feature 组装场景，不属于产品代码依赖；*.d.ts 只有类型引用（如 vite/client），
    // 不产生运行时耦合，故一并排除。
    exclude: { path: "\\.(test|spec)\\.(ts|tsx)$|\\.d\\.ts$" },
    tsConfig: { fileName: path.join(__dirname, "tsconfig.app.json") },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      // @shadcn/react 等包通过 exports 子路径导出（如 ./message-scroller），
      // 必须显式启用 exports 解析，否则会被误报为无法解析。
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".jsx"],
    },
    reporterOptions: {
      dot: { collapsePattern: "node_modules/(@[^/]+/[^/]+|[^/]+)" },
    },
  },
};
