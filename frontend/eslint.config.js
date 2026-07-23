import js from "@eslint/js";
import jestDom from "eslint-plugin-jest-dom";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "@eslint-react/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import testingLibrary from "eslint-plugin-testing-library";
import globals from "globals";
import tseslint from "typescript-eslint";

const restrictedSyntax = [
  { selector: "CallExpression[callee.name='eval']", message: "eval is forbidden." },
  {
    selector: "NewExpression[callee.name='Function']",
    message: "Function constructors are forbidden.",
  },
  {
    selector: "Program > VariableDeclaration[kind='let']",
    message: "Module-level mutable state is forbidden; use a Provider, hook, or scoped instance.",
  },
  {
    selector: "Program > VariableDeclaration[kind='var']",
    message: "Module-level mutable state is forbidden; use a Provider, hook, or scoped instance.",
  },
];

export default tseslint.config(
  { ignores: ["coverage", "dist", "playwright-report", "test-results"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  { ...tseslint.configs.disableTypeChecked, files: ["**/*.{js,mjs,cjs}"] },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: {
      ...react.configs.recommended.plugins,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "jsx-a11y": jsxA11y,
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "error",
      "react-refresh/only-export-components": ["error", { allowConstantExport: true }],
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          disallowTypeAnnotations: false,
          fixStyle: "separate-type-imports",
          prefer: "type-imports",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-type-arguments": "off",
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "no-alert": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-restricted-syntax": ["error", ...restrictedSyntax],
      "@eslint-react/dom-no-dangerously-set-innerhtml": "off",
      "@eslint-react/naming-convention-ref-name": "off",
      "@eslint-react/no-array-index-key": "off",
      "@eslint-react/no-context-provider": "off",
      "@eslint-react/no-forward-ref": "off",
      "@eslint-react/no-use-context": "off",
      "@eslint-react/purity": "off",
      "@eslint-react/set-state-in-effect": "off",
      "@eslint-react/no-nested-component-definitions": "off",
      "jsx-a11y/media-has-caption": "off",
      "jsx-a11y/no-noninteractive-tabindex": "off",
      complexity: ["error", 100],
      "max-depth": ["error", 7],
      "max-lines-per-function": ["error", { max: 850, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/**", "@/entities/**"],
              message: "shared cannot depend on feature or entity code.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/entities/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/features/**"], message: "entities cannot depend on feature code." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{test,spec}.{ts,tsx}"],
    plugins: { "testing-library": testingLibrary, "jest-dom": jestDom },
    rules: {
      ...testingLibrary.configs["flat/react"].rules,
      ...jestDom.configs["flat/recommended"].rules,
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax.filter((entry) => !entry.selector.includes("VariableDeclaration")),
      ],
      "max-lines-per-function": "off",
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["scripts/**/*.mjs", "vite.config.ts", "playwright.config.ts"],
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "no-console": "off",
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax.filter((entry) => !entry.selector.includes("VariableDeclaration")),
      ],
    },
  },
  {
    files: ["src/components/ui/chart.tsx"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
    },
  },
  {
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
      "max-lines-per-function": "off",
    },
  },
);
