package main

import (
	"bytes"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

const fixtureRoot = "testdata"

// runTool 以进程内方式运行门禁，返回退出码与全部输出。
func runTool(t *testing.T, args ...string) (int, string, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	code := run(args, &stdout, &stderr)
	return code, stdout.String(), stderr.String()
}

// writeBaselineFile 把基线结构写入临时目录，返回路径。
func writeBaselineFile(t *testing.T, payload baseline) string {
	t.Helper()
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		t.Fatalf("序列化测试基线失败：%v", err)
	}
	path := filepath.Join(t.TempDir(), "structure-baseline.json")
	if err := os.WriteFile(path, append(data, '\n'), 0o644); err != nil {
		t.Fatalf("写入测试基线失败：%v", err)
	}
	return path
}

// readBaselineFile 读回基线结构，用于断言 --update 的产物。
func readBaselineFile(t *testing.T, path string) baseline {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取基线失败：%v", err)
	}
	var payload baseline
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatalf("解析基线失败：%v", err)
	}
	return payload
}

// listItem 是 --list 输出的一行。
type listItem struct {
	kind  string
	path  string
	line  int
	name  string
	value int
}

// parseListOutput 解析 --list 的机器可读清单，字段数或数字不合法即判失败。
func parseListOutput(t *testing.T, output string) []listItem {
	t.Helper()
	var items []listItem
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		if line == "" {
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) != 4 {
			t.Fatalf("清单行应为 4 个制表符字段，实际 %d：%q", len(fields), line)
		}
		location := strings.Split(fields[1], ":")
		if len(location) != 2 {
			t.Fatalf("定位字段应为 路径:行号，实际 %q", fields[1])
		}
		lineNumber, err := strconv.Atoi(location[1])
		if err != nil {
			t.Fatalf("行号不可解析：%q", fields[1])
		}
		value, err := strconv.Atoi(fields[3])
		if err != nil {
			t.Fatalf("度量值不可解析：%q", fields[3])
		}
		items = append(items, listItem{
			kind:  fields[0],
			path:  location[0],
			line:  lineNumber,
			name:  fields[2],
			value: value,
		})
	}
	return items
}

// findItem 按 kind + 路径 + 函数名定位清单项。
func findItem(items []listItem, kind, path, name string) *listItem {
	for index := range items {
		item := items[index]
		if item.kind == kind && item.path == path && item.name == name {
			return &items[index]
		}
	}
	return nil
}

// severityOf 复算清单项的严重度（度量值 / 阈值）。
func severityOf(item listItem) float64 {
	limits := map[string]int{fileKind: fileLineLimit, funcKind: funcLineLimit, nestKind: nestingLimit}
	return float64(item.value) / float64(limits[item.kind])
}

// lineAt 读取夹具文件的第 line 行，用于校验上报行号确实指向函数体起始行。
func lineAt(t *testing.T, path string, line int) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取夹具失败：%v", err)
	}
	lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	if line < 1 || line > len(lines) {
		t.Fatalf("行号 %d 超出 %s 的范围（共 %d 行）", line, path, len(lines))
	}
	return lines[line-1]
}

// TestListDetectsAllViolationKinds 证明 REV-1 / REV-2 / REV-3 三类越限都被检出，且没有假阳性。
func TestListDetectsAllViolationKinds(t *testing.T) {
	code, stdout, _ := runTool(t, "--root", fixtureRoot, "--list")
	if code != exitOK {
		t.Fatalf("--list 退出码应为 %d，实际 %d", exitOK, code)
	}
	items := parseListOutput(t, stdout)
	if len(items) != 5 {
		t.Fatalf("应检出 5 项越限，实际 %d 项：\n%s", len(items), stdout)
	}
	want := []listItem{
		{kind: nestKind, path: "deep_nesting.go", name: "deepNesting", value: 4},
		{kind: nestKind, path: "deep_nesting.go", name: "elseNesting", value: 4},
		{kind: nestKind, path: "deep_nesting.go", name: closureName, value: 4},
		{kind: funcKind, path: "oversized_func.go", name: "oversizedFunction", value: 51},
		{kind: fileKind, path: "oversized_file.go", name: filePlaceholder, value: 601},
	}
	for _, expected := range want {
		item := findItem(items, expected.kind, expected.path, expected.name)
		if item == nil {
			t.Fatalf("未检出 %s %s %s：\n%s", expected.kind, expected.path, expected.name, stdout)
		}
		if item.value != expected.value {
			t.Errorf("%s %s 度量值应为 %d，实际 %d", expected.kind, expected.name, expected.value, item.value)
		}
	}
	if strings.Contains(stdout, "clean.go") {
		t.Errorf("合规夹具 clean.go 不应出现在清单中：\n%s", stdout)
	}
}

// TestListReportsFunctionBodyStartLine 证明 func / nest 上报的是函数体起始行，file 固定为第 1 行。
func TestListReportsFunctionBodyStartLine(t *testing.T) {
	_, stdout, _ := runTool(t, "--root", fixtureRoot, "--list")
	for _, item := range parseListOutput(t, stdout) {
		if item.kind == fileKind {
			if item.line != 1 {
				t.Errorf("文件类越限行号应为 1，实际 %d", item.line)
			}
			continue
		}
		text := lineAt(t, filepath.Join(fixtureRoot, item.path), item.line)
		if !strings.Contains(text, "func") {
			t.Errorf("%s %s 的行号 %d 不指向函数体起始行：%q", item.kind, item.name, item.line, text)
		}
	}
}

// TestListSortsBySeverityDescending 证明清单按严重度（度量值 / 阈值）降序排列。
func TestListSortsBySeverityDescending(t *testing.T) {
	_, stdout, _ := runTool(t, "--root", fixtureRoot, "--list")
	items := parseListOutput(t, stdout)
	for index := 1; index < len(items); index++ {
		previous, current := severityOf(items[index-1]), severityOf(items[index])
		if previous < current {
			t.Fatalf("第 %d 项严重度 %.4f 小于第 %d 项 %.4f，未按降序排列：\n%s", index, previous, index+1, current, stdout)
		}
	}
}

// TestCheckFailsOnNewViolations 证明空基线时三类越限都判失败并返回退出码 1。
func TestCheckFailsOnNewViolations(t *testing.T) {
	baselinePath := writeBaselineFile(t, baseline{Limits: baselineLimits{fileLineLimit, funcLineLimit, nestingLimit}})
	code, stdout, stderr := runTool(t, "--root", fixtureRoot, "--baseline", baselinePath)
	if code != exitFailure {
		t.Fatalf("越限未被基线冻结时退出码应为 %d，实际 %d\nstdout:\n%s\nstderr:\n%s", exitFailure, code, stdout, stderr)
	}
	for _, key := range []string{
		"新增超限文件：oversized_file.go = 601（阈值 600）",
		"新增超限函数：oversized_func.go#oversizedFunction = 51（阈值 50）",
		"新增超限嵌套：deep_nesting.go#deepNesting = 4（阈值 3）",
		"新增超限嵌套：deep_nesting.go#<closure> = 4（阈值 3）",
	} {
		if !strings.Contains(stderr, key) {
			t.Errorf("失败输出缺少 %q：\n%s", key, stderr)
		}
	}
}

// TestCheckFailsWhenMetricGrows 证明棘轮对「基线内继续恶化」同样失败。
func TestCheckFailsWhenMetricGrows(t *testing.T) {
	baselinePath := writeBaselineFile(t, baseline{
		Files:     map[string]int{"oversized_file.go": 700},
		Functions: map[string]int{"oversized_func.go#oversizedFunction": 40},
		Nesting:   map[string]int{"deep_nesting.go#deepNesting": 3},
	})
	code, _, stderr := runTool(t, "--root", fixtureRoot, "--baseline", baselinePath)
	if code != exitFailure {
		t.Fatalf("度量值变大时退出码应为 %d，实际 %d", exitFailure, code)
	}
	for _, key := range []string{
		"超限函数继续恶化：oversized_func.go#oversizedFunction = 51（基线 40）",
		"超限嵌套继续恶化：deep_nesting.go#deepNesting = 4（基线 3）",
	} {
		if !strings.Contains(stderr, key) {
			t.Errorf("失败输出缺少 %q：\n%s", key, stderr)
		}
	}
	if strings.Contains(stderr, "oversized_file.go 继续恶化") {
		t.Errorf("度量值小于基线时不应判为恶化：\n%s", stderr)
	}
}

// TestCheckRequiresBaseline 证明基线缺失时退出码 2 并提示先跑 --update。
func TestCheckRequiresBaseline(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "absent.json")
	code, _, stderr := runTool(t, "--root", fixtureRoot, "--baseline", missing)
	if code != exitConfig {
		t.Fatalf("基线缺失时退出码应为 %d，实际 %d", exitConfig, code)
	}
	if !strings.Contains(stderr, "--update") {
		t.Errorf("基线缺失提示应包含 --update：\n%s", stderr)
	}
}

// TestUpdateWritesBaselineAndCheckPasses 证明 --update 冻结当前实测值，随后校验通过。
func TestUpdateWritesBaselineAndCheckPasses(t *testing.T) {
	baselinePath := filepath.Join(t.TempDir(), "structure-baseline.json")
	code, stdout, stderr := runTool(t, "--root", fixtureRoot, "--baseline", baselinePath, "--update")
	if code != exitOK {
		t.Fatalf("--update 退出码应为 %d，实际 %d\nstderr:\n%s", exitOK, code, stderr)
	}
	if !strings.Contains(stdout, "超限文件 1 个，超限函数 1 个，越限嵌套 3 个") {
		t.Errorf("--update 输出计数不符：%s", stdout)
	}
	frozen := readBaselineFile(t, baselinePath)
	if frozen.Limits != (baselineLimits{FileLines: fileLineLimit, FunctionLines: funcLineLimit, NestingDepth: nestingLimit}) {
		t.Errorf("基线 limits 不符：%+v", frozen.Limits)
	}
	if len(frozen.Files) != 1 || frozen.Files["oversized_file.go"] != 601 {
		t.Errorf("基线 files 不符：%+v", frozen.Files)
	}
	if len(frozen.Functions) != 1 || frozen.Functions["oversized_func.go#oversizedFunction"] != 51 {
		t.Errorf("基线 functions 不符：%+v", frozen.Functions)
	}
	if len(frozen.Nesting) != 3 {
		t.Errorf("基线 nesting 应有 3 条，实际 %+v", frozen.Nesting)
	}
	for key, depth := range frozen.Nesting {
		if depth != 4 {
			t.Errorf("基线 nesting %s 深度应为 4，实际 %d", key, depth)
		}
	}
	code, stdout, stderr = runTool(t, "--root", fixtureRoot, "--baseline", baselinePath)
	if code != exitOK {
		t.Fatalf("冻结后校验退出码应为 %d，实际 %d\nstderr:\n%s", exitOK, code, stderr)
	}
	if !strings.Contains(stdout, "结构门禁通过") {
		t.Errorf("冻结后应输出通过文案：%s", stdout)
	}
}

// TestCheckReportsImprovement 证明键消失只提示收缩基线，不判失败。
func TestCheckReportsImprovement(t *testing.T) {
	baselinePath := filepath.Join(t.TempDir(), "structure-baseline.json")
	if code, _, stderr := runTool(t, "--root", fixtureRoot, "--baseline", baselinePath, "--update"); code != exitOK {
		t.Fatalf("--update 失败：%d %s", code, stderr)
	}
	frozen := readBaselineFile(t, baselinePath)
	frozen.Files["已整改的旧文件.go"] = 900
	rewritten, err := json.Marshal(frozen)
	if err != nil {
		t.Fatalf("序列化失败：%v", err)
	}
	if err := os.WriteFile(baselinePath, rewritten, 0o644); err != nil {
		t.Fatalf("写入基线失败：%v", err)
	}
	code, stdout, stderr := runTool(t, "--root", fixtureRoot, "--baseline", baselinePath)
	if code != exitOK {
		t.Fatalf("仅存在已整改项时退出码应为 %d，实际 %d\nstderr:\n%s", exitOK, code, stderr)
	}
	if !strings.Contains(stdout, "已整改（建议 --update 收缩基线）：1 项") {
		t.Errorf("缺少已整改提示：%s", stdout)
	}
}

// TestRejectsConflictingFlags 证明 --update 与 --list 互斥。
func TestRejectsConflictingFlags(t *testing.T) {
	code, _, stderr := runTool(t, "--root", fixtureRoot, "--update", "--list")
	if code != exitConfig {
		t.Fatalf("互斥参数退出码应为 %d，实际 %d", exitConfig, code)
	}
	if !strings.Contains(stderr, "不能同时使用") {
		t.Errorf("缺少互斥提示：%s", stderr)
	}
}

// TestScanSkipsTestdataAndTestFiles 证明扫描自身不会把夹具与 _test.go 当成越限项。
func TestScanSkipsTestdataAndTestFiles(t *testing.T) {
	scanned, err := scan(".")
	if err != nil {
		t.Fatalf("扫描工具自身失败：%v", err)
	}
	for _, item := range scanned.violations {
		if strings.HasSuffix(item.path, "_test.go") || strings.Contains(item.path, "testdata/") {
			t.Errorf("越限记录不应来自测试文件或夹具：%s", item.path)
		}
	}
}

// elseIfChainSource 是 5 支 if / else if 链：扁平分派，按 REV-3 口径只算 1 层。
const elseIfChainSource = `package fixture

func chained(value int) int {
	if value == 0 {
		return 0
	} else if value == 1 {
		return 1
	} else if value == 2 {
		return 2
	} else if value == 3 {
		return 3
	} else if value == 4 {
		return 4
	}
	return -1
}
`

// elseBlockSource 用显式块写 else：块内 if 仍按嵌套计，因此比 else if 多一层。
const elseBlockSource = `package fixture

func chained(value int) int {
	if value == 0 {
		return 0
	} else {
		if value == 1 {
			return 1
		}
	}
	return -1
}
`

// nestedIfForSwitchSource 是 4 层真实嵌套：if(1) → for(2) → switch(3) → case 体内的 if(4)。
const nestedIfForSwitchSource = `package fixture

func nested(values []int) int {
	total := 0
	if len(values) > 0 {
		for _, value := range values {
			switch value {
			case 1:
				if value > 0 {
					total++
				}
			}
		}
	}
	return total
}
`

// nestingDepthOf 解析单函数源码片段，返回其函数体的最大嵌套深度。
func nestingDepthOf(t *testing.T, source string) int {
	t.Helper()
	fset := token.NewFileSet()
	parsed, err := parser.ParseFile(fset, "snippet.go", source, 0)
	if err != nil {
		t.Fatalf("解析片段失败：%v\n%s", err, source)
	}
	for _, decl := range parsed.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Body == nil {
			continue
		}
		return nestingDepth(fn.Body)
	}
	t.Fatalf("片段中没有可统计的具名函数：\n%s", source)
	return 0
}

// writeFixture 把夹具写入临时扫描根，避免新增 testdata 影响既有清单断言。
func writeFixture(t *testing.T, root, name, source string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, name), []byte(source), 0o644); err != nil {
		t.Fatalf("写入夹具 %s 失败：%v", name, err)
	}
}

// emptyBaselinePath 写出不含任何冻结项的空基线，用于断言「当前实测即全部为新增越限」。
func emptyBaselinePath(t *testing.T) string {
	t.Helper()
	return writeBaselineFile(t, baseline{
		Limits: baselineLimits{FileLines: fileLineLimit, FunctionLines: funcLineLimit, NestingDepth: nestingLimit},
	})
}

// TestNestingDepthCountsElseIfChainAsSingleLevel 钉死 REV-3 口径：else if 与所属 if 同层。
func TestNestingDepthCountsElseIfChainAsSingleLevel(t *testing.T) {
	if depth := nestingDepthOf(t, elseIfChainSource); depth != 1 {
		t.Errorf("5 支 if / else if 链是扁平分派，应为 1 层，实际 %d 层", depth)
	}
}

// TestNestingDepthTreatsElseBlockDeeperThanElseIf 钉死不对称口径：else { if } 比 else if 多一层。
func TestNestingDepthTreatsElseBlockDeeperThanElseIf(t *testing.T) {
	elseIfDepth := nestingDepthOf(t, elseIfChainSource)
	elseBlockDepth := nestingDepthOf(t, elseBlockSource)
	if elseIfDepth != 1 {
		t.Errorf("else if 链应为 1 层，实际 %d 层", elseIfDepth)
	}
	if elseBlockDepth != 2 {
		t.Errorf("else { if ... } 应为 2 层，实际 %d 层", elseBlockDepth)
	}
	if elseBlockDepth != elseIfDepth+1 {
		t.Errorf("else { if ... } 应比 else if 多一层：%d vs %d", elseBlockDepth, elseIfDepth)
	}
}

// TestNestingDepthCountsRealNesting 证明真实嵌套仍逐层累加：if → for → switch → case 体内 if = 4 层。
func TestNestingDepthCountsRealNesting(t *testing.T) {
	if depth := nestingDepthOf(t, nestedIfForSwitchSource); depth != 4 {
		t.Errorf("if → for → switch → case 体内 if 应为 4 层，实际 %d 层", depth)
	}
}

// TestCheckPassesOnElseIfChain 证明扁平分派不再被误报为越限嵌套（改口径前的假阳性）。
func TestCheckPassesOnElseIfChain(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "chain.go", elseIfChainSource)
	code, stdout, stderr := runTool(t, "--root", root, "--baseline", emptyBaselinePath(t))
	if code != exitOK {
		t.Fatalf("扁平分派不应触发门禁失败，实际退出码 %d\nstderr:\n%s", code, stderr)
	}
	if !strings.Contains(stdout, "结构门禁通过") {
		t.Errorf("缺少通过文案：%s", stdout)
	}
}

// TestCheckFailsOnRealDeepNesting 证明 4 层真实嵌套仍被检出为 4 并判失败。
func TestCheckFailsOnRealDeepNesting(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "nested.go", nestedIfForSwitchSource)
	code, _, stderr := runTool(t, "--root", root, "--baseline", emptyBaselinePath(t))
	if code != exitFailure {
		t.Fatalf("4 层真实嵌套未被基线冻结时应退出码 %d，实际 %d\nstderr:\n%s", exitFailure, code, stderr)
	}
	if !strings.Contains(stderr, "新增超限嵌套：nested.go#nested = 4（阈值 3）") {
		t.Errorf("失败输出缺少嵌套越限明细：\n%s", stderr)
	}
}
