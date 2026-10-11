package main

import (
	"bytes"
	"io"
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
	if code := reportDiff(old, current, io.Discard, io.Discard); code != 1 {
		t.Fatalf("导出声明被删除时应返回 1，实际 %d", code)
	}
}

// TestReportDiffDetectsAddition 证明「新增导出声明」同样判定失败，避免契约被悄悄扩大。
func TestReportDiffDetectsAddition(t *testing.T) {
	old := []string{"pkg [pkg] func Kept func(int) string"}
	current := append(append([]string{}, old...), "pkg [pkg] func Added func()")
	if code := reportDiff(old, current, io.Discard, io.Discard); code != 1 {
		t.Fatalf("新增导出声明时应返回 1，实际 %d", code)
	}
}

// TestReportDiffDetectsSignatureChange 证明签名被改写会被检出（旧条目消失 + 新条目出现）。
func TestReportDiffDetectsSignatureChange(t *testing.T) {
	old := []string{"pkg [pkg] func Run func(int) error"}
	current := []string{"pkg [pkg] func Run func(string) error"}
	if code := reportDiff(old, current, io.Discard, io.Discard); code != 1 {
		t.Fatalf("签名变化时应返回 1，实际 %d", code)
	}
}

// TestReportDiffAcceptsIdentical 证明完全一致时门禁通过。
func TestReportDiffAcceptsIdentical(t *testing.T) {
	lines := []string{
		"pkg [pkg] func Run func(int) error",
		"pkg [pkg] type Config struct { Enabled bool }",
	}
	if code := reportDiff(lines, append([]string{}, lines...), io.Discard, io.Discard); code != 0 {
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

	lines, err := collectExportedAPI(root, io.Discard)
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

	lines, err := collectExportedAPI(root, io.Discard)
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

// 文件级端到端夹具（testdata/fixture）用到的常量：夹具路径、负样本改写目标与期望条目文本。
const (
	fixtureSourcePath = "testdata/fixture/fixture.go"
	fixtureDirName    = "fixture"

	describeSignature = "func Describe(value int) (string, error)"
	describeRenamed   = "func describe(value int) (string, error)"
	describeRetyped   = "func Describe(value string) (string, error)"

	addedExportDecl = "\n// AddedByTest 是负样本注入的导出函数。\nfunc AddedByTest(value string) int { return 0 }\n"

	describeEntry        = "fixture [fixture] func Describe func(value int) (string, error)"
	retypedDescribeEntry = "fixture [fixture] func Describe func(value string) (string, error)"
	addedEntry           = "fixture [fixture] func AddedByTest func(value string) int"
)

// fixtureSource 读取夹具源码原文。
func fixtureSource(t *testing.T) string {
	t.Helper()
	source, err := os.ReadFile(fixtureSourcePath)
	if err != nil {
		t.Fatalf("读取夹具 %s 失败: %v", fixtureSourcePath, err)
	}
	return string(source)
}

// replaceOnce 在夹具源码里替换恰好一次 old；未命中即失败，避免夹具漂移导致负样本空转。
func replaceOnce(t *testing.T, source, old, new string) string {
	t.Helper()
	if !strings.Contains(source, old) {
		t.Fatalf("夹具已漂移：%s 中找不到 %q，负样本会退化为空转", fixtureSourcePath, old)
	}
	return strings.Replace(source, old, new, 1)
}

// writeFixturePackage 把给定夹具源码写到 dir/fixture/fixture.go。
func writeFixturePackage(t *testing.T, dir, source string) {
	t.Helper()
	target := filepath.Join(dir, fixtureDirName, "fixture.go")
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatalf("创建夹具目录失败: %v", err)
	}
	if err := os.WriteFile(target, []byte(source), 0o644); err != nil {
		t.Fatalf("写入夹具失败: %v", err)
	}
}

// frozenFixtureBaseline 在临时目录生成「未改动夹具」的基线并返回其路径（不触碰仓库真实基线）。
func frozenFixtureBaseline(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	writeFixturePackage(t, root, fixtureSource(t))
	lines, err := collectExportedAPI(root, io.Discard)
	if err != nil {
		t.Fatalf("收集夹具导出 API 失败: %v", err)
	}
	if len(lines) != 3 {
		t.Fatalf("夹具应收集到 3 条导出条目，实际 %d 条: %v", len(lines), lines)
	}
	baseline := filepath.Join(t.TempDir(), "api-baseline.txt")
	if err := writeBaseline(baseline, lines); err != nil {
		t.Fatalf("写入临时基线失败: %v", err)
	}
	return baseline
}

// runFixtureDiff 用给定夹具源码跑一次真实文件级校验，返回退出码与 stdout/stderr 文本。
func runFixtureDiff(t *testing.T, baseline, source string) (int, string, string) {
	t.Helper()
	root := t.TempDir()
	writeFixturePackage(t, root, source)
	var stdout, stderr bytes.Buffer
	code := run([]string{"-root", root, "-baseline", baseline}, &stdout, &stderr)
	return code, stdout.String(), stderr.String()
}

// TestRunAcceptsFixtureBaseline 正样本：文件级夹具「收集 → 写基线 → 再比对」退出码 0。
func TestRunAcceptsFixtureBaseline(t *testing.T) {
	baseline := frozenFixtureBaseline(t)
	code, stdout, stderr := runFixtureDiff(t, baseline, fixtureSource(t))
	if code != 0 {
		t.Fatalf("夹具与自身基线一致时应返回 0，实际 %d\nstdout:\n%s\nstderr:\n%s", code, stdout, stderr)
	}
	if !strings.Contains(stdout, "导出 API 面与基线逐条一致。") {
		t.Errorf("stdout 应含一致性提示，实际:\n%s", stdout)
	}
	if !strings.Contains(stdout, "基线条目 3 条，当前 3 条。") {
		t.Errorf("stdout 应含条数统计，实际:\n%s", stdout)
	}
}

// TestRunDetectsAddedExportInFixture 负样本：夹具新增导出函数 → 退出码 1 且提示「新增」。
func TestRunDetectsAddedExportInFixture(t *testing.T) {
	baseline := frozenFixtureBaseline(t)
	code, stdout, stderr := runFixtureDiff(t, baseline, fixtureSource(t)+addedExportDecl)
	if code != 1 {
		t.Fatalf("新增导出符号时应返回 1，实际 %d\nstdout:\n%s\nstderr:\n%s", code, stdout, stderr)
	}
	if !strings.Contains(stdout, "公共契约新增") {
		t.Errorf("stdout 应含「新增」提示，实际:\n%s", stdout)
	}
	if !strings.Contains(stdout, addedEntry) {
		t.Errorf("stdout 应逐条列出新增条目 %q，实际:\n%s", addedEntry, stdout)
	}
	if !strings.Contains(stderr, "API 契约校验失败：删除/改写 0 条，新增 1 条。") {
		t.Errorf("stderr 应含失败汇总，实际:\n%s", stderr)
	}
}

// TestRunDetectsRemovedExportInFixture 负样本：夹具导出函数被改名去掉导出性 → 退出码 1 且提示「删除」。
func TestRunDetectsRemovedExportInFixture(t *testing.T) {
	baseline := frozenFixtureBaseline(t)
	code, stdout, stderr := runFixtureDiff(t, baseline, replaceOnce(t, fixtureSource(t), describeSignature, describeRenamed))
	if code != 1 {
		t.Fatalf("导出符号消失时应返回 1，实际 %d\nstdout:\n%s\nstderr:\n%s", code, stdout, stderr)
	}
	if !strings.Contains(stdout, "公共契约被删除") {
		t.Errorf("stdout 应含「删除」提示，实际:\n%s", stdout)
	}
	if !strings.Contains(stdout, describeEntry) {
		t.Errorf("stdout 应逐条列出缺失条目 %q，实际:\n%s", describeEntry, stdout)
	}
	if !strings.Contains(stderr, "API 契约校验失败：删除/改写 1 条，新增 0 条。") {
		t.Errorf("stderr 应含失败汇总，实际:\n%s", stderr)
	}
}

// TestRunDetectsSignatureChangeInFixture 负样本：夹具导出函数签名被改写 → 退出码 1 且提示签名变化。
func TestRunDetectsSignatureChangeInFixture(t *testing.T) {
	baseline := frozenFixtureBaseline(t)
	code, stdout, stderr := runFixtureDiff(t, baseline, replaceOnce(t, fixtureSource(t), describeSignature, describeRetyped))
	if code != 1 {
		t.Fatalf("签名被改写时应返回 1，实际 %d\nstdout:\n%s\nstderr:\n%s", code, stdout, stderr)
	}
	if !strings.Contains(stdout, "签名被改写") {
		t.Errorf("stdout 应含签名变化提示，实际:\n%s", stdout)
	}
	if !strings.Contains(stdout, describeEntry) || !strings.Contains(stdout, retypedDescribeEntry) {
		t.Errorf("stdout 应同时列出旧签名 %q 与新签名 %q，实际:\n%s", describeEntry, retypedDescribeEntry, stdout)
	}
	if !strings.Contains(stderr, "API 契约校验失败：删除/改写 1 条，新增 1 条。") {
		t.Errorf("stderr 应含失败汇总，实际:\n%s", stderr)
	}
}

// TestRunUpdateWritesBaselineFile 覆盖 --update 路径：退出码 0、基线被写出（LF 结尾）、随后比对一致。
func TestRunUpdateWritesBaselineFile(t *testing.T) {
	root := t.TempDir()
	writeFixturePackage(t, root, fixtureSource(t))
	baseline := filepath.Join(t.TempDir(), "api-baseline.txt")

	var updateOut, updateErr bytes.Buffer
	if code := run([]string{"--update", "-root", root, "-baseline", baseline}, &updateOut, &updateErr); code != 0 {
		t.Fatalf("--update 应返回 0，实际 %d\nstderr:\n%s", code, updateErr.String())
	}
	if !strings.Contains(updateOut.String(), "已更新 API 基线：3 条") {
		t.Errorf("--update 应报告写入条数与路径，实际 stdout:\n%s", updateOut.String())
	}

	raw, err := os.ReadFile(baseline)
	if err != nil {
		t.Fatalf("--update 未写出基线文件: %v", err)
	}
	if bytes.Contains(raw, []byte("\r")) {
		t.Errorf("基线应为 LF 换行，实际含 CR")
	}
	if !bytes.HasSuffix(raw, []byte("\n")) {
		t.Errorf("基线应以换行结尾，实际末尾: %q", raw[len(raw)-1:])
	}
	for _, want := range []string{
		describeEntry,
		"fixture [fixture] type Config struct { Enabled bool }",
		"fixture [fixture] const DefaultLimit  = 42",
	} {
		if !strings.Contains(string(raw), want) {
			t.Errorf("写出的基线缺少条目 %q，实际:\n%s", want, raw)
		}
	}

	var checkOut, checkErr bytes.Buffer
	if code := run([]string{"-root", root, "-baseline", baseline}, &checkOut, &checkErr); code != 0 {
		t.Fatalf("--update 后再次比对应返回 0，实际 %d\nstderr:\n%s", code, checkErr.String())
	}
	if !strings.Contains(checkOut.String(), "导出 API 面与基线逐条一致。") {
		t.Errorf("--update 后比对应一致，实际 stdout:\n%s", checkOut.String())
	}
}

// TestRunReportsMissingBaseline 覆盖基线缺失路径：退出码 2，stderr 指向 --update，且不输出比对结果。
func TestRunReportsMissingBaseline(t *testing.T) {
	root := t.TempDir()
	writeFixturePackage(t, root, fixtureSource(t))
	missing := filepath.Join(t.TempDir(), "absent-api-baseline.txt")

	var stdout, stderr bytes.Buffer
	if code := run([]string{"-root", root, "-baseline", missing}, &stdout, &stderr); code != 2 {
		t.Fatalf("基线缺失应返回 2，实际 %d\nstderr:\n%s", code, stderr.String())
	}
	if !strings.Contains(stderr.String(), "--update") {
		t.Errorf("stderr 应提示先运行 --update，实际:\n%s", stderr.String())
	}
	if !strings.Contains(stderr.String(), missing) {
		t.Errorf("stderr 应包含缺失的基线路径 %s，实际:\n%s", missing, stderr.String())
	}
	if stdout.Len() != 0 {
		t.Errorf("基线缺失时不应输出比对结果，实际 stdout:\n%s", stdout.String())
	}
}
