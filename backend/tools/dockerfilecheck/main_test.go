package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fixtureRepo 是最小正样本夹具：与真实仓库同构的 Dockerfile / .dockerignore / frontend / backend 骨架。
// 负样本由 copyFixture + mutateFile 在临时目录上构造，保证「失败」来自被变更的那条不变量。
const fixtureRepo = "testdata/repo"

// runCLI 执行工具并返回退出码与合并输出（合并是为了断言锚点，不影响退出码判定）。
func runCLI(t *testing.T, args ...string) (int, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	code := run(args, &stdout, &stderr)
	return code, stdout.String() + stderr.String()
}

// copyFixture 把最小夹具整树复制到临时目录，用于构造负样本变异。
func copyFixture(t *testing.T) string {
	t.Helper()
	target := filepath.Join(t.TempDir(), "repo")
	if err := copyTree(fixtureRepo, target); err != nil {
		t.Fatalf("复制夹具失败: %v", err)
	}
	return target
}

// copyTree 递归复制目录（含隐藏文件，例如 .dockerignore）。
func copyTree(source, target string) error {
	return filepath.WalkDir(source, func(current string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		relative, relErr := filepath.Rel(source, current)
		if relErr != nil {
			return relErr
		}
		destination := filepath.Join(target, relative)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0o755)
		}
		data, readErr := os.ReadFile(current)
		if readErr != nil {
			return readErr
		}
		return os.WriteFile(destination, data, 0o644)
	})
}

// mutateFile 在目标文件中替换唯一片段；锚点非唯一即视为夹具失效并直接失败。
func mutateFile(t *testing.T, root, rel, old, replacement string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(rel))
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取变异目标失败 %s: %v", rel, err)
	}
	if count := strings.Count(string(raw), old); count != 1 {
		t.Fatalf("变异锚点应在 %s 中恰好出现 1 次，实际 %d 次: %q", rel, count, old)
	}
	updated := strings.Replace(string(raw), old, replacement, 1)
	if err := os.WriteFile(path, []byte(updated), 0o644); err != nil {
		t.Fatalf("写回变异目标失败 %s: %v", rel, err)
	}
}

// writeFixtureFile 在夹具副本中新建文件（用于「新增未被 COPY 的相对 import」这类变异）。
func writeFixtureFile(t *testing.T, root, rel, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("创建目录失败 %s: %v", rel, err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("写入文件失败 %s: %v", rel, err)
	}
}

// TestRunAcceptsFixtureRepo 是正样本：完整夹具必须通过，且输出自证参与判定的文件数。
func TestRunAcceptsFixtureRepo(t *testing.T) {
	code, output := runCLI(t, "--root", fixtureRepo)
	if code != exitOK {
		t.Fatalf("正样本应退出码 0，实际 %d\n%s", code, output)
	}
	if !strings.Contains(output, "通过：全部必需输入都能进入构建上下文") {
		t.Errorf("缺少通过结论:\n%s", output)
	}
	if !strings.Contains(output, "参与判定：必需文件 ") {
		t.Errorf("缺少参与判定的文件数自证:\n%s", output)
	}
}

// TestFrontendClosureFollowsImportsAndExemptsTests 断言前端闭包口径：
// 相对 import 传递闭包纳入 build-manifest-plugin.ts，测试文件被豁免，tsconfig include 展开纳入 src。
func TestFrontendClosureFollowsImportsAndExemptsTests(t *testing.T) {
	closure, err := collectFrontendRequired(fixtureRepo)
	if err != nil {
		t.Fatalf("前端闭包分析失败: %v", err)
	}
	present := map[string]bool{}
	for _, item := range closure.required {
		present[item.path] = true
	}
	for _, want := range []string{
		"frontend/vite.config.ts",
		"frontend/vitest.config.ts",
		"frontend/scripts/build-manifest-plugin.ts",
		"frontend/scripts/build-inputs.ts",
		"frontend/src/main.ts",
		"frontend/package.json",
		"frontend/pnpm-lock.yaml",
	} {
		if !present[want] {
			t.Errorf("闭包缺少必需文件: %s（实际 %d 个）", want, len(closure.required))
		}
	}
	for _, unwanted := range []string{"frontend/scripts/build-inputs.test.ts", "frontend/src/main.test.ts"} {
		if present[unwanted] {
			t.Errorf("测试文件不应进入必需集合: %s", unwanted)
		}
	}
	// 口径：只有 tsconfig include 命中且未被 exclude 的测试文件计入豁免（夹具里的
	// frontend/scripts/build-inputs.test.ts）；被 exclude 的测试文件（src/main.test.ts）直接离开闭包。
	if closure.exempt != 1 {
		t.Errorf("应豁免 1 个测试文件，实际 %d", closure.exempt)
	}
	if len(closure.unresolved) != 0 {
		t.Errorf("夹具不应有未解析的相对 import: %v", closure.unresolved)
	}
}

// TestBackendClosureEnumeratesSourcesAndExemptsTests 断言后端闭包口径。
func TestBackendClosureEnumeratesSourcesAndExemptsTests(t *testing.T) {
	closure, err := collectBackendRequired(fixtureRepo)
	if err != nil {
		t.Fatalf("后端闭包分析失败: %v", err)
	}
	present := map[string]bool{}
	for _, item := range closure.required {
		present[item.path] = true
	}
	for _, want := range []string{
		"backend/go.mod",
		"backend/go.sum",
		"backend/docs/docs.go",
		"backend/cmd/app/main.go",
		"backend/internal/greeting/greeting.go",
	} {
		if !present[want] {
			t.Errorf("闭包缺少必需文件: %s", want)
		}
	}
	if present["backend/internal/greeting/greeting_test.go"] {
		t.Error("*_test.go 不应进入必需集合")
	}
	if closure.exempt != 1 {
		t.Errorf("应豁免 1 个测试文件，实际 %d", closure.exempt)
	}
}

// TestIgnoreRulesHandleDirectoryWhitelistAndTestExclusion 直接断言忽略规则引擎的两类关键规则：
// 整目录白名单（!frontend/scripts/**）放行全部脚本，测试文件排除规则再单独排除 *.test.ts。
func TestIgnoreRulesHandleDirectoryWhitelistAndTestExclusion(t *testing.T) {
	rules, err := loadIgnoreRules(filepath.Join(fixtureRepo, ".dockerignore"))
	if err != nil {
		t.Fatalf("加载 .dockerignore 失败: %v", err)
	}
	for _, path := range []string{
		"frontend/scripts/build-manifest-plugin.ts",
		"frontend/scripts/build-inputs.ts",
		"backend/internal/greeting/greeting.go",
		"VERSION",
	} {
		if ignored, rule := isIgnored(rules, path); ignored {
			t.Errorf("%s 不应被排除（命中规则 %s）", path, rule.raw)
		}
	}
	for _, path := range []string{
		"frontend/scripts/build-inputs.test.ts",
		"backend/internal/greeting/greeting_test.go",
	} {
		if ignored, _ := isIgnored(rules, path); !ignored {
			t.Errorf("%s 应被排除", path)
		}
	}
}

// TestRejectsScriptsCopyRegression 是必测负样本 1：
// 把 frontend/scripts 的 COPY 退回「只覆盖 build-inputs.ts」，被 vite.config.ts import 的
// build-manifest-plugin.ts 丢失 → 必须失败并给出 文件:行 锚点。
func TestRejectsScriptsCopyRegression(t *testing.T) {
	root := copyFixture(t)
	mutateFile(t, root, "Dockerfile",
		"COPY frontend/scripts ./scripts",
		"COPY frontend/scripts/build-inputs.ts ./scripts/build-inputs.ts")
	code, output := runCLI(t, "--root", root)
	if code != exitFailure {
		t.Fatalf("COPY 回退应退出码 1，实际 %d\n%s", code, output)
	}
	for _, want := range []string{
		"未被任何上下文 COPY 覆盖",
		"frontend/scripts/build-manifest-plugin.ts",
	} {
		if !strings.Contains(output, want) {
			t.Errorf("输出缺少 %q:\n%s", want, output)
		}
	}
	// 锚点允许两种等价依据：import 边（vite.config.ts:1）或 tsconfig include 展开（tsconfig.node.json:9）。
	// 两者都真实要求该文件存在，但输出必须落在某个 文件:行 上。
	if !strings.Contains(output, "frontend/vite.config.ts:1") && !strings.Contains(output, "frontend/tsconfig.node.json:9") {
		t.Errorf("输出缺少可定位的 文件:行 锚点:\n%s", output)
	}
}

// TestRejectsScriptsWhitelistRemoval 是必测负样本 2：
// 从 .dockerignore 移除 !frontend/scripts/** 后，目录内文件只剩 **: 的排除 → 必须失败。
func TestRejectsScriptsWhitelistRemoval(t *testing.T) {
	root := copyFixture(t)
	mutateFile(t, root, ".dockerignore", "!frontend/scripts/**\n", "")
	code, output := runCLI(t, "--root", root)
	if code != exitFailure {
		t.Fatalf("移除 scripts 白名单应退出码 1，实际 %d\n%s", code, output)
	}
	for _, want := range []string{
		"排除了必需文件 frontend/scripts/build-manifest-plugin.ts",
		".dockerignore:1",
	} {
		if !strings.Contains(output, want) {
			t.Errorf("输出缺少 %q:\n%s", want, output)
		}
	}
}

// TestRejectsUncopiedNewImport 是必测负样本 3：
// vite.config.ts 新增一个未被 COPY 的相对 import（文件存在但目录既不在 COPY 也不在白名单）→ 必须失败。
func TestRejectsUncopiedNewImport(t *testing.T) {
	root := copyFixture(t)
	writeFixtureFile(t, root, "frontend/config/extra.ts", "export const extra = \"fixture\";\n")
	mutateFile(t, root, "frontend/vite.config.ts",
		"import { buildManifestPlugin } from \"./scripts/build-manifest-plugin.ts\";",
		"import { extra } from \"./config/extra.ts\";\nimport { buildManifestPlugin } from \"./scripts/build-manifest-plugin.ts\";\n\nvoid extra;")
	code, output := runCLI(t, "--root", root)
	if code != exitFailure {
		t.Fatalf("新增未 COPY 的 import 应退出码 1，实际 %d\n%s", code, output)
	}
	for _, want := range []string{
		"frontend/config/extra.ts",
		"frontend/vite.config.ts:1",
	} {
		if !strings.Contains(output, want) {
			t.Errorf("输出缺少 %q:\n%s", want, output)
		}
	}
}

// TestRejectsIgnoredFixedInput 负样本：后端固定输入被忽略规则排除（移除 !backend/go.mod）。
func TestRejectsIgnoredFixedInput(t *testing.T) {
	root := copyFixture(t)
	mutateFile(t, root, ".dockerignore", "!backend/go.mod\n", "")
	code, output := runCLI(t, "--root", root)
	if code != exitFailure {
		t.Fatalf("固定输入被排除应退出码 1，实际 %d\n%s", code, output)
	}
	if !strings.Contains(output, "排除了必需文件 backend/go.mod") {
		t.Errorf("输出未定位到被排除的 backend/go.mod:\n%s", output)
	}
}

// TestRejectsEmptyCopiedDirectory 负样本：COPY 的目录在忽略规则下没有可用内容（移除 !frontend/public/**）。
func TestRejectsEmptyCopiedDirectory(t *testing.T) {
	root := copyFixture(t)
	mutateFile(t, root, ".dockerignore", "!frontend/public/**\n", "")
	code, output := runCLI(t, "--root", root)
	if code != exitFailure {
		t.Fatalf("COPY 目录无内容应退出码 1，实际 %d\n%s", code, output)
	}
	if !strings.Contains(output, "COPY 的目录 frontend/public 在 .dockerignore 下没有任何可用内容") {
		t.Errorf("输出未定位到空的 COPY 目录:\n%s", output)
	}
}

// TestRejectsMissingCopySource 负样本：COPY 源路径拼写错误（VERSIONS）。
func TestRejectsMissingCopySource(t *testing.T) {
	root := copyFixture(t)
	mutateFile(t, root, "Dockerfile", "COPY VERSION /app/VERSION", "COPY VERSIONS /app/VERSION")
	code, output := runCLI(t, "--root", root)
	if code != exitFailure {
		t.Fatalf("COPY 源不存在应退出码 1，实际 %d\n%s", code, output)
	}
	if !strings.Contains(output, "COPY 源路径在仓库中不存在：VERSIONS") {
		t.Errorf("输出未定位到不存在的 COPY 源:\n%s", output)
	}
}

// TestHelpDocumentsBoundaries 证明 --help 给出完整口径边界（含两条关键忽略规则语义）。
func TestHelpDocumentsBoundaries(t *testing.T) {
	code, output := runCLI(t, "--help")
	if code != exitOK {
		t.Fatalf("--help 应退出码 0，实际 %d", code)
	}
	for _, want := range []string{
		"口径边界",
		"!frontend/scripts/**",
		"*.test.ts",
		"TS2307",
		"frontend/tsconfig.json",
	} {
		if !strings.Contains(output, want) {
			t.Errorf("--help 缺少口径说明 %q", want)
		}
	}
}

// TestMissingRootIsConfigError 证明输入缺失属于配置错误（退出码 2），不会与违反不变量（1）混淆。
func TestMissingRootIsConfigError(t *testing.T) {
	code, output := runCLI(t, "--root", filepath.Join(t.TempDir(), "absent"))
	if code != exitConfig {
		t.Fatalf("缺少 Dockerfile 应退出码 2，实际 %d\n%s", code, output)
	}
	if !strings.Contains(output, "读取 Dockerfile 失败") {
		t.Errorf("输出未说明配置错误原因:\n%s", output)
	}
}
