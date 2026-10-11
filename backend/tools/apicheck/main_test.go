package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestReportDiffDetectsRemoval 证明「导出声明消失」会让门禁失败。
func TestReportDiffDetectsRemoval(t *testing.T) {
	old := []string{
		"pkg [pkg] func Exported func() error",
		"pkg [pkg] func Kept func(int) string",
	}
	current := []string{"pkg [pkg] func Kept func(int) string"}
	if code := reportDiff(old, current); code != 1 {
		t.Fatalf("导出声明被删除时应返回 1，实际 %d", code)
	}
}

// TestReportDiffDetectsAddition 证明「新增导出声明」同样判定失败，避免契约被悄悄扩大。
func TestReportDiffDetectsAddition(t *testing.T) {
	old := []string{"pkg [pkg] func Kept func(int) string"}
	current := append(append([]string{}, old...), "pkg [pkg] func Added func()")
	if code := reportDiff(old, current); code != 1 {
		t.Fatalf("新增导出声明时应返回 1，实际 %d", code)
	}
}

// TestReportDiffDetectsSignatureChange 证明签名被改写会被检出（旧条目消失 + 新条目出现）。
func TestReportDiffDetectsSignatureChange(t *testing.T) {
	old := []string{"pkg [pkg] func Run func(int) error"}
	current := []string{"pkg [pkg] func Run func(string) error"}
	if code := reportDiff(old, current); code != 1 {
		t.Fatalf("签名变化时应返回 1，实际 %d", code)
	}
}

// TestReportDiffAcceptsIdentical 证明完全一致时门禁通过。
func TestReportDiffAcceptsIdentical(t *testing.T) {
	lines := []string{
		"pkg [pkg] func Run func(int) error",
		"pkg [pkg] type Config struct { Enabled bool }",
	}
	if code := reportDiff(lines, append([]string{}, lines...)); code != 0 {
		t.Fatalf("基线一致时应返回 0，实际 %d", code)
	}
}

// TestCollectExportedAPI 覆盖导出/未导出、方法接收者、类型与常量取值的收集口径。
func TestCollectExportedAPI(t *testing.T) {
	root := t.TempDir()
	source := `package sample

const ExportedLimit = 42

type ExportedStruct struct {
	Field int ` + "`json:\"field\"`" + `
}

type hiddenStruct struct{}

func ExportedFunc(value int) (string, error) { return "", nil }

func unexportedFunc() {}

func (e *ExportedStruct) ExportedMethod() error { return nil }

func (e *ExportedStruct) unexportedMethod() {}
`
	dir := filepath.Join(root, "sample")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("创建夹具目录失败: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "sample.go"), []byte(source), 0o644); err != nil {
		t.Fatalf("写入夹具失败: %v", err)
	}

	lines, err := collectExportedAPI(root)
	if err != nil {
		t.Fatalf("收集导出 API 失败: %v", err)
	}
	got := map[string]bool{}
	for _, line := range lines {
		got[line] = true
	}

	for _, want := range []string{
		"sample [sample] func ExportedFunc func(value int) (string, error)",
		"sample [sample] method (*ExportedStruct).ExportedMethod func() error",
		"sample [sample] const ExportedLimit  = 42",
	} {
		if !got[want] {
			t.Errorf("缺少条目: %s\n实际条目:\n%v", want, lines)
		}
	}
	for _, unwanted := range []string{
		"sample/sample [sample] func unexportedFunc func()",
		"sample/sample [sample] type hiddenStruct struct{}",
	} {
		if got[unwanted] {
			t.Errorf("未导出声明不应进入基线: %s", unwanted)
		}
	}
	if len(lines) != 4 {
		t.Errorf("应收集到 4 条导出声明，实际 %d 条: %v", len(lines), lines)
	}
}

// TestCollectExportedAPISkipsGeneratedAndTestdata 证明 docs/ 与 testdata/ 不参与契约校验。
func TestCollectExportedAPISkipsGeneratedAndTestdata(t *testing.T) {
	for _, rel := range []string{
		"docs/docs.go",
		"internal/foo/docs/bar.go",
		"tools/apicheck/testdata/sample/sample.go",
		"testdata/x.go",
	} {
		if !underDirectory(rel, "docs") && !underDirectory(rel, "testdata") {
			t.Errorf("应被排除但未排除: %s", rel)
		}
	}
	for _, rel := range []string{
		"internal/application/gateway/service_request.go",
		"tools/apicheck/main.go",
	} {
		if underDirectory(rel, "docs") || underDirectory(rel, "testdata") {
			t.Errorf("不应被排除但被排除: %s", rel)
		}
	}
}

// TestBaselineRoundTrip 证明写入后能逐条读回，且注释行被忽略。
func TestBaselineRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "api-baseline.txt")
	lines := []string{
		"pkg [pkg] func A func()",
		"pkg [pkg] func B func(int) error",
	}
	if err := writeBaseline(path, lines); err != nil {
		t.Fatalf("写入基线失败: %v", err)
	}
	back, err := readBaseline(path)
	if err != nil {
		t.Fatalf("读取基线失败: %v", err)
	}
	if len(back) != len(lines) {
		t.Fatalf("基线往返条数不一致：写入 %d 读取 %d（注释行应被忽略）", len(lines), len(back))
	}
	for index := range lines {
		if back[index] != lines[index] {
			t.Errorf("第 %d 条不一致：%q != %q", index, back[index], lines[index])
		}
	}
}

// TestCollectExportedAPISkipsUnexportedReceiverMethods 证明未导出类型上的大写方法
// （例如为满足 ast.Visitor 而写的 Visit）不算公共契约：包外无法命名该类型，也就无法调用。
func TestCollectExportedAPISkipsUnexportedReceiverMethods(t *testing.T) {
	root := t.TempDir()
	source := `package sample

type ExportedWidget struct{}

type hiddenWidget struct{}

func (e *ExportedWidget) ExportedMethod() error { return nil }

func (h *hiddenWidget) Visit() {}

func (h hiddenWidget) AlsoHidden() {}
`
	dir := filepath.Join(root, "sample")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("创建夹具目录失败: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "sample.go"), []byte(source), 0o644); err != nil {
		t.Fatalf("写入夹具失败: %v", err)
	}

	lines, err := collectExportedAPI(root)
	if err != nil {
		t.Fatalf("收集导出 API 失败: %v", err)
	}
	joined := strings.Join(lines, "\n")
	if !strings.Contains(joined, "(*ExportedWidget).ExportedMethod") {
		t.Errorf("导出类型上的导出方法必须进入基线，实际:\n%s", joined)
	}
	for _, unwanted := range []string{"hiddenWidget).Visit", "hiddenWidget).AlsoHidden"} {
		if strings.Contains(joined, unwanted) {
			t.Errorf("未导出类型上的方法不应进入基线: %s\n实际:\n%s", unwanted, joined)
		}
	}
}
