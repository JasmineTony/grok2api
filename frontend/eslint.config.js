import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // 仅排除生成物与基础原语；业务代码、测试和工具配置均参与各自环境的检查。
  { ignores: ["dist", "coverage", ".cache", ".artifacts", "src/components/ui"] },
  {
    // Node 工具脚本与配置：public/ 下是浏览器运行时脚本，必须排除，否则 window 会被误判为未定义。
    files: ["**/*.{js,cjs,mjs}", "!public/**"],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.node },
  },
  {
    // dist 随构建生成的运行时配置由浏览器加载（window.__GROK2API_RUNTIME_CONFIG__）。
    files: ["public/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022 },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    files: ["*.config.ts", "e2e/**/*.ts", "scripts/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
);
