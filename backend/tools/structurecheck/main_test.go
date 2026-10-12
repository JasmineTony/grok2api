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
	if len(items) != 6 {
		t.Fatalf("应检出 6 项越限，实际 %d 项：\n%s", len(items), stdout)
	}
	want := []listItem{
		{kind: nestKind, path: "deep_nesting.go", name: "deepNesting", value: 4},
		{kind: nestKind, path: "deep_nesting.go", name: "elseNesting", value: 4},
		{kind: nestKind, path: "deep_nesting.go", name: closureName, value: 4},
		{kind: funcKind, path: "oversized_func.go", name: "oversizedFunction", value: 51},
		{kind: nestKind, path: "package_closure.go", name: closureName, value: 4},
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
		"新增超限嵌套：" + closureKey("deep_nesting.go", 40) + " = 4（阈值 3）",
		"新增超限嵌套：" + closureKey("package_closure.go", 6) + " = 4（阈值 3）",
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
	if !strings.Contains(stdout, "超限文件 1 个，超限函数 1 个，越限嵌套 4 个") {
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
	if len(frozen.Nesting) != 4 {
		t.Errorf("基线 nesting 应有 4 条，实际 %+v", frozen.Nesting)
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

// scopeCountSource 是 2 个具名函数，其中一个含 1 个函数字面量：按 REV-3 口径应计 3 个参与判定的作用域。
const scopeCountSource = `package fixture

func outer(value int) int {
	apply := func(input int) int {
		return input + 1
	}
	return apply(value)
}

func second(value int) int {
	return value
}
`

// TestCheckReportsScopeCount 证明「0 越限」附带参与判定的作用域总数，且闭包计入独立作用域（EVID-3：证明不是漏报）。
func TestCheckReportsScopeCount(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "scopes.go", scopeCountSource)
	code, stdout, stderr := runTool(t, "--root", root, "--baseline", emptyBaselinePath(t))
	if code != exitOK {
		t.Fatalf("合规夹具不应触发门禁失败，实际退出码 %d\nstderr:\n%s", code, stderr)
	}
	if !strings.Contains(stdout, "参与判定的作用域（REV-3）：3 个") {
		t.Errorf("应报告 3 个参与判定的作用域（2 个具名函数 + 1 个函数字面量）：\n%s", stdout)
	}
}

// packageClosureSource 是包级 var 初始化器里的函数字面量：体内 4 层嵌套，且不在任何具名函数体内。
const packageClosureSource = `package fixture

var handler = func() int {
	total := 0
	for i := 0; i < 3; i++ {
		if i > 0 {
			switch i {
			case 1:
				if i > 0 {
					total++
				}
			}
		}
	}
	return total
}
`

// twoPackageClosuresSource 是两个包级闭包：closureA 嵌套 4 层、closureB 嵌套 5 层，
// 用于证明同文件内不同闭包各有独立基线键。
const twoPackageClosuresSource = `package fixture

var closureA = func() int {
	total := 0
	for i := 0; i < 3; i++ {
		if i > 0 {
			switch i {
			case 1:
				if i > 0 {
					total++
				}
			}
		}
	}
	return total
}

var closureB = func() int {
	total := 0
	for i := 0; i < 3; i++ {
		if i > 0 {
			switch i {
			case 1:
				if i > 0 {
					for j := 0; j < 2; j++ {
						total++
					}
				}
			}
		}
	}
	return total
}
`

// scopeCountOf 解析 run 输出里的「参与判定的作用域（REV-3）：N 个」，返回 N。
func scopeCountOf(t *testing.T, stdout string) int {
	t.Helper()
	const marker = "参与判定的作用域（REV-3）："
	for _, line := range strings.Split(stdout, "\n") {
		index := strings.Index(line, marker)
		if index < 0 {
			continue
		}
		rest := line[index+len(marker):]
		end := 0
		for end < len(rest) && rest[end] >= '0' && rest[end] <= '9' {
			end++
		}
		if end == 0 {
			t.Fatalf("作用域计数不可解析：%q", line)
		}
		value, err := strconv.Atoi(rest[:end])
		if err != nil {
			t.Fatalf("作用域计数不可解析：%q", line)
		}
		return value
	}
	t.Fatalf("输出缺少参与判定的作用域计数：\n%s", stdout)
	return 0
}

// closureKey 复算闭包的基线键：相对路径#<closure>@函数体起始行。
func closureKey(path string, line int) string {
	return path + "#" + closureName + "@" + strconv.Itoa(line)
}

// TestListDetectsPackageLevelClosure 证明包级函数字面量进入 --list 清单（修复前是漏报通道）。
func TestListDetectsPackageLevelClosure(t *testing.T) {
	code, stdout, _ := runTool(t, "--root", fixtureRoot, "--list")
	if code != exitOK {
		t.Fatalf("--list 退出码应为 %d，实际 %d", exitOK, code)
	}
	item := findItem(parseListOutput(t, stdout), nestKind, "package_closure.go", closureName)
	if item == nil {
		t.Fatalf("包级函数字面量未被 --list 检出：\n%s", stdout)
	}
	if item.value != 4 {
		t.Errorf("包级闭包嵌套深度应为 4，实际 %d", item.value)
	}
	if text := lineAt(t, filepath.Join(fixtureRoot, "package_closure.go"), item.line); !strings.Contains(text, "func") {
		t.Errorf("包级闭包行号 %d 不指向函数体起始行：%q", item.line, text)
	}
}

// TestCheckFailsOnPackageLevelClosureNesting 证明包级闭包在 check 路径同样被检出并判失败。
func TestCheckFailsOnPackageLevelClosureNesting(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "package_closure.go", packageClosureSource)
	code, _, stderr := runTool(t, "--root", root, "--baseline", emptyBaselinePath(t))
	if code != exitFailure {
		t.Fatalf("包级闭包 4 层嵌套未被基线冻结时应退出码 %d，实际 %d\nstderr:\n%s", exitFailure, code, stderr)
	}
	if !strings.Contains(stderr, "新增超限嵌套："+closureKey("package_closure.go", 3)+" = 4（阈值 3）") {
		t.Errorf("失败输出缺少包级闭包键（含函数体起始行）：\n%s", stderr)
	}
}

// namedFunctionSource 是单个具名函数，用于与包级闭包对比参与判定的作用域总数。
const namedFunctionSource = `package fixture

func named() int {
	return 0
}
`

// TestScopeCountIncludesPackageLevelClosures 证明 scopeCount 随包级闭包增长，不是只统计具名函数。
func TestScopeCountIncludesPackageLevelClosures(t *testing.T) {
	withClosure := t.TempDir()
	writeFixture(t, withClosure, "named.go", namedFunctionSource)
	writeFixture(t, withClosure, "package_closure.go", packageClosureSource)
	code, stdout, stderr := runTool(t, "--root", withClosure, "--baseline", emptyBaselinePath(t))
	if code != exitFailure {
		t.Fatalf("含 4 层包级闭包的夹具应判失败，实际退出码 %d\nstderr:\n%s", code, stderr)
	}
	withCount := scopeCountOf(t, stdout)

	withoutClosure := t.TempDir()
	writeFixture(t, withoutClosure, "named.go", namedFunctionSource)
	code, stdout, stderr = runTool(t, "--root", withoutClosure, "--baseline", emptyBaselinePath(t))
	if code != exitOK {
		t.Fatalf("无闭包夹具应通过，实际退出码 %d\nstderr:\n%s", code, stderr)
	}
	withoutCount := scopeCountOf(t, stdout)
	if withoutCount != 1 {
		t.Errorf("无闭包夹具应只有 1 个作用域，实际 %d", withoutCount)
	}
	if withCount != withoutCount+1 {
		t.Errorf("包级闭包应使参与判定的作用域总数增加 1：%d → %d", withoutCount, withCount)
	}
}

// TestClosureBaselineKeysDoNotMaskEachOther 证明同文件内两个闭包的基线键互不覆盖：
// closureA 从 6 层降到 4 层、closureB 从 4 层升到 5 层时，B 的恶化必须判失败（共用键会让 A 掩盖 B）。
func TestClosureBaselineKeysDoNotMaskEachOther(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "two_closures.go", twoPackageClosuresSource)
	_, listed, _ := runTool(t, "--root", root, "--list")
	var closureLines []int
	for _, item := range parseListOutput(t, listed) {
		if item.kind == nestKind && item.name == closureName {
			closureLines = append(closureLines, item.line)
		}
	}
	if len(closureLines) != 2 {
		t.Fatalf("应检出 2 个包级闭包越限，实际 %d 个：\n%s", len(closureLines), listed)
	}
	// --list 按严重度降序：closureB（5 层）在前，closureA（4 层）在后。
	degraded, improved := closureLines[0], closureLines[1]
	baselinePath := writeBaselineFile(t, baseline{Nesting: map[string]int{
		closureKey("two_closures.go", improved): 6, // A：基线 6 层，当前 4 层（数值下降，棘轮不报失败）
		closureKey("two_closures.go", degraded): 4, // B：基线 4 层，当前 5 层 → 恶化
	}})
	code, stdout, stderr := runTool(t, "--root", root, "--baseline", baselinePath)
	if code != exitFailure {
		t.Fatalf("B 闭包恶化必须判失败，实际退出码 %d\nstdout:\n%s\nstderr:\n%s", code, stdout, stderr)
	}
	if !strings.Contains(stderr, "超限嵌套继续恶化："+closureKey("two_closures.go", degraded)+" = 5（基线 4）") {
		t.Errorf("失败输出未指出恶化的闭包键：\n%s", stderr)
	}
	if strings.Contains(stderr, "新增超限嵌套") {
		t.Errorf("两个闭包的键都应命中基线，不应出现新增项：\n%s", stderr)
	}
	if !strings.Contains(stdout, "越限嵌套（> 3 层）：当前 2 个，基线 2 个") {
		t.Errorf("两个闭包应各自命中基线键（当前 2 个 / 基线 2 个）：\n%s", stdout)
	}

	// 旧的合并键（<路径>#<closure>）不再吸收同文件闭包：冻结 6 层时两个闭包各自成为新增项并判失败。
	legacyPath := writeBaselineFile(t, baseline{Nesting: map[string]int{"two_closures.go#" + closureName: 6}})
	code, _, legacyStderr := runTool(t, "--root", root, "--baseline", legacyPath)
	if code != exitFailure {
		t.Fatalf("合并键基线不应掩盖两个闭包，实际退出码 %d\nstderr:\n%s", code, legacyStderr)
	}
	if strings.Count(legacyStderr, "新增超限嵌套") != 2 {
		t.Errorf("合并键基线下两个闭包都应报新增：\n%s", legacyStderr)
	}
}

// packageLiteralFormsSource 覆盖 var 组、切片字面量与 map 字面量里的包级函数字面量（共 4 个）。
const packageLiteralFormsSource = `package fixture

var (
	handler = func() int { return 1 }
	handlers = []func() int{
		func() int { return 2 },
		func() int { return 3 },
	}
	registry = map[string]func() int{
		"a": func() int { return 4 },
	}
)
`

// TestScopeCountCountsPackageLevelLiteralForms 证明 var 组 / 切片 / map 里的包级函数字面量各计一次。
func TestScopeCountCountsPackageLevelLiteralForms(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "forms.go", packageLiteralFormsSource)
	code, stdout, stderr := runTool(t, "--root", root, "--baseline", emptyBaselinePath(t))
	if code != exitOK {
		t.Fatalf("合规的包级字面量不应触发门禁失败，实际退出码 %d\nstderr:\n%s", code, stderr)
	}
	if count := scopeCountOf(t, stdout); count != 4 {
		t.Errorf("4 个包级函数字面量应各计一次作用域，实际 %d", count)
	}
}
