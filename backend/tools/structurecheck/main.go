// structurecheck 是后端结构门禁（AGENTS.md REV-1 / REV-2 / REV-3）。
//
// 规则：
//   - REV-1：单个 .go 文件总行数 > 600 行 → kind file。
//   - REV-2：函数体行数（Rbrace.Line - Lbrace.Line + 1）> 50 → kind func。
//   - REV-3：函数体内控制流最大嵌套深度 > 3 → kind nest。
//     计入 if、for、range、switch、type switch、select 各一层；
//     case / comm 子句体不额外加层；函数字面量是独立作用域，单独上报为 <closure>。
//     else if 与所属 if 同层，不额外加层；而 else { if ... } 的显式块内 if 仍按嵌套计，
//     于是语义等价的两者深度不同（前者 N，后者 N+1）。该不对称是有意口径，与前端
//     frontend/scripts/check-structure.mjs 的 REV-3 实现一致：把显式块归一化为同层会整体
//     下调既有计数、放松门禁，而块内再嵌 if 也确实多一层可读性成本。
//
// 扫描范围：--root（应指向 backend/）下全部 .go，排除 *_test.go、docs/（swag 生成物）
// 与 testdata/（门禁自测夹具，Go 工具链同样忽略该目录）。
//
// 基线棘轮：structure-baseline.json 冻结存量越限项，只允许持平或下降。
//
// 用法（必须从 backend/ 目录运行）：
//
//	go run ./tools/structurecheck            # 与基线比较，新增或恶化即退出码 1
//	go run ./tools/structurecheck --list     # 按严重度降序列出当前全部越限项
//	go run ./tools/structurecheck --update   # 用当前实测状态重写基线
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// 门禁阈值与口径常量，与 AGENTS.md REV-1 / REV-2 / REV-3 一一对应。
const (
	fileLineLimit   = 600
	funcLineLimit   = 50
	nestingLimit    = 3
	defaultBaseline = "structure-baseline.json"
	fileKind        = "file"
	funcKind        = "func"
	nestKind        = "nest"
	closureName     = "<closure>"
	filePlaceholder = "-"
	docsDirName     = "docs"
	testdataDirName = "testdata"
	baselineNote    = "存量债务冻结基线（AGENTS.md §5）。只允许持平或下降，整改后可用 --update 收缩。"

	exitOK      = 0 // 通过、--list、--update
	exitFailure = 1 // 相对基线出现新增或恶化
	exitConfig  = 2 // 参数错误、基线缺失或不可解析、扫描失败

	usageText = `structurecheck 是后端结构门禁（AGENTS.md REV-1 / REV-2 / REV-3）：
  REV-1 文件总行数 > 600（kind file）
  REV-2 函数体行数 > 50（kind func）
  REV-3 控制流嵌套深度 > 3（kind nest）

必须从 backend/ 目录运行。基线是棘轮：新增键或度量值变大即失败，键消失或变小仅提示收缩。
--list 不比较基线，stdout 每行「kind<TAB>相对路径:行号<TAB>函数名<TAB>度量值」，按严重度降序。
参数：`
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// run 是 main 的可测试实现：返回退出码，全部输出写入传入的 writer。
func run(args []string, stdout, stderr io.Writer) int {
	opts, err := parseOptions(args, stderr)
	if err != nil {
		fmt.Fprintf(stderr, "参数错误：%v\n", err)
		return exitConfig
	}
	scanned, err := scan(opts.root)
	if err != nil {
		fmt.Fprintf(stderr, "扫描失败：%v\n", err)
		return exitConfig
	}
	if opts.list {
		return reportList(scanned, stdout, stderr)
	}
	if opts.update {
		return reportUpdate(scanned, opts.baseline, stdout, stderr)
	}
	return reportCheck(scanned, opts.baseline, stdout, stderr)
}

// options 是命令行参数。
type options struct {
	root     string
	baseline string
	update   bool
	list     bool
}

func parseOptions(args []string, stderr io.Writer) (options, error) {
	flags := flag.NewFlagSet("structurecheck", flag.ContinueOnError)
	flags.SetOutput(stderr)
	flags.Usage = func() {
		fmt.Fprintln(stderr, usageText)
		flags.PrintDefaults()
	}
	var opts options
	flags.StringVar(&opts.root, "root", ".", "扫描根目录（应指向 backend/）")
	flags.StringVar(&opts.baseline, "baseline", defaultBaseline, "结构基线文件路径")
	flags.BoolVar(&opts.update, "update", false, "用当前实测状态重写基线")
	flags.BoolVar(&opts.list, "list", false, "按严重度降序列出当前全部越限项")
	if err := flags.Parse(args); err != nil {
		return options{}, err
	}
	if opts.update && opts.list {
		return options{}, errors.New("--update 与 --list 不能同时使用")
	}
	if flags.NArg() > 0 {
		return options{}, fmt.Errorf("不支持位置参数：%v", flags.Args())
	}
	return opts, nil
}

// violation 是一条越限记录。
type violation struct {
	kind  string // file | func | nest
	path  string // 相对扫描根的正斜杠路径
	line  int    // 定位行号：file 固定为 1，func / nest 为函数体起始行
	name  string // 函数名（方法为 接收者类型.方法名）；file 记录为 "-"
	value int    // 实测度量值：文件行数 / 函数体行数 / 嵌套深度
}

// key 返回基线键：文件用相对路径，函数与嵌套用「相对路径#函数名」。
func (v violation) key() string {
	if v.kind == fileKind {
		return v.path
	}
	return v.path + "#" + v.name
}

// severity 是 --list 的严重度排序依据：度量值相对阈值的超出比例。
func (v violation) severity() float64 {
	return float64(v.value) / float64(limitOf(v.kind))
}

// limitOf 返回某一类越限的阈值。
func limitOf(kind string) int {
	switch kind {
	case funcKind:
		return funcLineLimit
	case nestKind:
		return nestingLimit
	default:
		return fileLineLimit
	}
}

// scanner 汇总一次扫描的越限记录。
type scanner struct {
	root       string
	fset       *token.FileSet
	fileCount  int
	scopeCount int
	violations []violation
}

// scan 遍历 root 下全部生产 Go 文件并收集越限记录。
func scan(root string) (*scanner, error) {
	scanned := &scanner{root: root, fset: token.NewFileSet()}
	if err := filepath.WalkDir(root, scanned.walk); err != nil {
		return nil, err
	}
	return scanned, nil
}

func (s *scanner) walk(path string, entry fs.DirEntry, err error) error {
	if err != nil {
		return err
	}
	if entry.IsDir() {
		return s.enterDir(path, entry)
	}
	if !isProductionGoFile(entry.Name()) {
		return nil
	}
	return s.scanFile(path)
}

// isProductionGoFile 只保留生产 Go 文件，排除测试文件。
func isProductionGoFile(name string) bool {
	return strings.HasSuffix(name, ".go") && !strings.HasSuffix(name, "_test.go")
}

// enterDir 跳过不参与门禁的目录：docs/ 是生成物，testdata/ 是自测夹具。
func (s *scanner) enterDir(path string, entry fs.DirEntry) error {
	if path == s.root {
		return nil
	}
	if name := entry.Name(); name == docsDirName || name == testdataDirName {
		return filepath.SkipDir
	}
	return nil
}

func (s *scanner) scanFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	rel, err := relativeSlashPath(s.root, path)
	if err != nil {
		return err
	}
	parsed, err := parser.ParseFile(s.fset, path, data, 0)
	if err != nil {
		return fmt.Errorf("解析 %s 失败：%w", rel, err)
	}
	s.fileCount++
	s.checkFileLines(rel, data)
	s.checkDecls(rel, parsed)
	return nil
}

// relativeSlashPath 统一输出正斜杠相对路径，保证基线键跨平台稳定。
func relativeSlashPath(root, path string) (string, error) {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(rel), nil
}

func (s *scanner) checkFileLines(rel string, data []byte) {
	if lines := countLines(data); lines > fileLineLimit {
		s.add(fileKind, rel, 1, filePlaceholder, lines)
	}
}

// countLines 与前端基线口径一致：结尾换行不额外计入一行。
func countLines(data []byte) int {
	if len(data) == 0 {
		return 0
	}
	lines := bytes.Count(data, []byte("\n"))
	if data[len(data)-1] != '\n' {
		lines++
	}
	return lines
}

// checkDecls 检查文件内每个具名函数，以及每个函数字面量（独立作用域，上报为 <closure>）。
func (s *scanner) checkDecls(rel string, parsed *ast.File) {
	for _, decl := range parsed.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Body == nil {
			continue
		}
		s.checkFunc(rel, funcDeclName(fn), fn.Body)
		ast.Inspect(fn.Body, func(node ast.Node) bool {
			if literal, isLiteral := node.(*ast.FuncLit); isLiteral {
				s.checkFunc(rel, closureName, literal.Body)
			}
			return true
		})
	}
}

// checkFunc 对单个函数体施加 REV-2 与 REV-3。
func (s *scanner) checkFunc(rel, name string, body *ast.BlockStmt) {
	start := s.fset.Position(body.Lbrace).Line
	end := s.fset.Position(body.Rbrace).Line
	s.scopeCount++
	if lines := end - start + 1; lines > funcLineLimit {
		s.add(funcKind, rel, start, name, lines)
	}
	if depth := nestingDepth(body); depth > nestingLimit {
		s.add(nestKind, rel, start, name, depth)
	}
}

func (s *scanner) add(kind, path string, line int, name string, value int) {
	s.violations = append(s.violations, violation{kind: kind, path: path, line: line, name: name, value: value})
}

// funcDeclName 返回函数的稳定标识：方法为「接收者类型.方法名」，普通函数为函数名。
func funcDeclName(fn *ast.FuncDecl) string {
	if fn.Recv == nil || len(fn.Recv.List) == 0 {
		return fn.Name.Name
	}
	return receiverName(fn.Recv.List[0].Type) + "." + fn.Name.Name
}

// receiverName 剥离指针与类型参数，取出接收者类型名。
func receiverName(expr ast.Expr) string {
	switch typed := expr.(type) {
	case *ast.StarExpr:
		return receiverName(typed.X)
	case *ast.ParenExpr:
		return receiverName(typed.X)
	case *ast.IndexExpr:
		return receiverName(typed.X)
	case *ast.IndexListExpr:
		return receiverName(typed.X)
	case *ast.Ident:
		return typed.Name
	default:
		return "unknown"
	}
}

// nestingState 记录一次遍历中的当前深度与历史最大深度。
type nestingState struct {
	depth int
	max   int
}

// nestingDepth 返回函数体内控制流最大嵌套深度；函数字面量按独立作用域另行统计。
func nestingDepth(body *ast.BlockStmt) int {
	state := &nestingState{}
	state.walkList(0, body.List...)
	return state.max
}

// nest 记入一层控制流并刷新历史最大深度。
func (s *nestingState) nest(depth int) int {
	if depth+1 > s.max {
		s.max = depth + 1
	}
	return depth + 1
}

// walkList 以同一深度遍历语句列表：块本身不是控制流，块内控制流语句才加层。
func (s *nestingState) walkList(depth int, stmts ...ast.Stmt) {
	for _, stmt := range stmts {
		s.walkStmt(stmt, depth)
	}
}

// walkStmt 遍历单条语句。depth 是进入该语句前已累计的控制流层数；控制流语句只可能出现在
// 语句位置，故按语句显式下探；函数字面量是独立作用域，由 checkDecls 单独上报为 <closure>。
func (s *nestingState) walkStmt(stmt ast.Stmt, depth int) {
	switch typed := stmt.(type) {
	case nil:
		return
	case *ast.BlockStmt:
		s.walkList(depth, typed.List...)
	case *ast.IfStmt:
		s.walkIf(typed, depth)
	case *ast.ForStmt:
		s.walkList(s.nest(depth), typed.Init, typed.Body)
	case *ast.RangeStmt:
		s.walkList(s.nest(depth), typed.Body)
	case *ast.SwitchStmt:
		s.walkList(s.nest(depth), typed.Init, typed.Body)
	case *ast.TypeSwitchStmt:
		s.walkList(s.nest(depth), typed.Assign, typed.Body)
	case *ast.SelectStmt:
		s.walkList(s.nest(depth), typed.Body)
	case *ast.CaseClause:
		s.walkList(depth, typed.Body...)
	case *ast.CommClause:
		s.walkList(depth, typed.Body...)
	case *ast.LabeledStmt:
		s.walkStmt(typed.Stmt, depth)
	}
}

// walkIf 处理 if 链：if 本身加一层；Else 直接是 *ast.IfStmt（else if）时与所属 if 同层，不再加层；
// Else 是显式块（else { if ... }）时块内 if 仍按嵌套计，因此比 else if 多一层。
func (s *nestingState) walkIf(stmt *ast.IfStmt, depth int) {
	inner := s.nest(depth)
	s.walkList(inner, stmt.Init, stmt.Body)
	switch elseBranch := stmt.Else.(type) {
	case nil:
		return
	case *ast.IfStmt:
		s.walkIf(elseBranch, depth)
	default:
		s.walkStmt(elseBranch, inner)
	}
}

// baselineLimits 记录生成基线时的阈值，供人工核对口径漂移。
type baselineLimits struct {
	FileLines     int `json:"fileLines"`
	FunctionLines int `json:"functionLines"`
	NestingDepth  int `json:"nestingDepth"`
}

// baseline 是结构基线：键为相对路径或「相对路径#函数名」，值为实测度量值。
type baseline struct {
	Note      string         `json:"note"`
	Limits    baselineLimits `json:"limits"`
	Files     map[string]int `json:"files"`
	Functions map[string]int `json:"functions"`
	Nesting   map[string]int `json:"nesting"`
}

// currentBaseline 把当前越限记录折算成基线形态；同键取最大值，避免多个函数字面量互相掩盖。
func (s *scanner) currentBaseline() (map[string]int, map[string]int, map[string]int) {
	files := map[string]int{}
	functions := map[string]int{}
	nesting := map[string]int{}
	for _, item := range s.violations {
		switch item.kind {
		case fileKind:
			keepMax(files, item.key(), item.value)
		case funcKind:
			keepMax(functions, item.key(), item.value)
		case nestKind:
			keepMax(nesting, item.key(), item.value)
		}
	}
	return files, functions, nesting
}

func keepMax(target map[string]int, key string, value int) {
	if current, ok := target[key]; !ok || value > current {
		target[key] = value
	}
}

// reportList 输出机器可读工作清单，供「机械切分并行派发」直接消费。
func reportList(scanned *scanner, stdout, stderr io.Writer) int {
	items := scanned.sortedViolations()
	fmt.Fprintf(stderr, "扫描生产 Go 文件 %d 个，当前越限 %d 项\n", scanned.fileCount, len(items))
	for _, item := range items {
		fmt.Fprintf(stdout, "%s\t%s:%d\t%s\t%d\n", item.kind, item.path, item.line, item.name, item.value)
	}
	return exitOK
}

// sortedViolations 按严重度降序排列越限项，让最严重的先被派发。
func (s *scanner) sortedViolations() []violation {
	items := append([]violation(nil), s.violations...)
	sort.SliceStable(items, func(i, j int) bool {
		left, right := items[i], items[j]
		if left.severity() != right.severity() {
			return left.severity() > right.severity()
		}
		if left.path != right.path {
			return left.path < right.path
		}
		if left.line != right.line {
			return left.line < right.line
		}
		return left.kind < right.kind
	})
	return items
}

// reportUpdate 用当前实测状态重写基线。
func reportUpdate(scanned *scanner, baselinePath string, stdout, stderr io.Writer) int {
	files, functions, nesting := scanned.currentBaseline()
	payload := baseline{
		Note:      baselineNote,
		Limits:    baselineLimits{FileLines: fileLineLimit, FunctionLines: funcLineLimit, NestingDepth: nestingLimit},
		Files:     files,
		Functions: functions,
		Nesting:   nesting,
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		fmt.Fprintf(stderr, "序列化结构基线失败：%v\n", err)
		return exitConfig
	}
	if err := os.WriteFile(baselinePath, append(data, '\n'), 0o644); err != nil {
		fmt.Fprintf(stderr, "写入结构基线失败：%v\n", err)
		return exitConfig
	}
	fmt.Fprintf(stdout, "已更新结构基线：超限文件 %d 个，超限函数 %d 个，越限嵌套 %d 个 → %s\n",
		len(files), len(functions), len(nesting), baselinePath)
	return exitOK
}

// reportCheck 与基线比较：新增或恶化即失败，键消失或变小仅提示收缩基线。
func reportCheck(scanned *scanner, baselinePath string, stdout, stderr io.Writer) int {
	frozen, err := readBaseline(baselinePath)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return exitConfig
	}
	files, functions, nesting := scanned.currentBaseline()
	failures, improved := compareGroups([]kindGroup{
		{kind: fileKind, current: files, frozen: frozen.Files},
		{kind: funcKind, current: functions, frozen: frozen.Functions},
		{kind: nestKind, current: nesting, frozen: frozen.Nesting},
	})
	reportCounts(stdout, scanned, files, functions, nesting, frozen)
	reportImproved(stdout, improved)
	if len(failures) > 0 {
		fmt.Fprintf(stderr, "\n结构门禁失败 %d 项：\n", len(failures))
		for _, item := range failures {
			fmt.Fprintf(stderr, "  - %s\n", item)
		}
		return exitFailure
	}
	fmt.Fprintln(stdout, "结构门禁通过：未新增超限文件、超限函数或越限嵌套。")
	return exitOK
}

func readBaseline(path string) (baseline, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return baseline{}, fmt.Errorf("缺少结构基线 %s：请先运行 go run ./tools/structurecheck --update", path)
	}
	var payload baseline
	if err := json.Unmarshal(data, &payload); err != nil {
		return baseline{}, fmt.Errorf("解析结构基线 %s 失败：%w", path, err)
	}
	return payload, nil
}

// kindGroup 把同类越限的当前实测与冻结基线配成一组。
type kindGroup struct {
	kind    string
	current map[string]int
	frozen  map[string]int
}

func compareGroups(groups []kindGroup) (failures, improved []string) {
	for _, group := range groups {
		newFailures, newImproved := compareKind(group.kind, group.current, group.frozen)
		failures = append(failures, newFailures...)
		improved = append(improved, newImproved...)
	}
	return failures, improved
}

// compareKind 实现棘轮语义：出现新键或度量值变大 → 失败；键消失 → 已整改。
func compareKind(kind string, current, frozen map[string]int) (failures, improved []string) {
	label := kindLabel(kind)
	for _, key := range sortedKeys(current) {
		value := current[key]
		frozenValue, ok := frozen[key]
		switch {
		case !ok:
			failures = append(failures, fmt.Sprintf("新增超限%s：%s = %d（阈值 %d）", label, key, value, limitOf(kind)))
		case value > frozenValue:
			failures = append(failures, fmt.Sprintf("超限%s继续恶化：%s = %d（基线 %d）", label, key, value, frozenValue))
		}
	}
	for _, key := range sortedKeys(frozen) {
		if _, ok := current[key]; !ok {
			improved = append(improved, fmt.Sprintf("%s %s（基线 %d）", label, key, frozen[key]))
		}
	}
	return failures, improved
}

func kindLabel(kind string) string {
	switch kind {
	case fileKind:
		return "文件"
	case funcKind:
		return "函数"
	default:
		return "嵌套"
	}
}

func sortedKeys(source map[string]int) []string {
	keys := make([]string, 0, len(source))
	for key := range source {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func reportCounts(stdout io.Writer, scanned *scanner, files, functions, nesting map[string]int, frozen baseline) {
	fmt.Fprintf(stdout, "扫描生产 Go 文件：%d 个\n", scanned.fileCount)
	fmt.Fprintf(stdout, "超限文件（> %d 行）：当前 %d 个，基线 %d 个\n", fileLineLimit, len(files), len(frozen.Files))
	fmt.Fprintf(stdout, "超限函数（> %d 行）：当前 %d 个，基线 %d 个\n", funcLineLimit, len(functions), len(frozen.Functions))
	fmt.Fprintf(stdout, "越限嵌套（> %d 层）：当前 %d 个，基线 %d 个\n", nestingLimit, len(nesting), len(frozen.Nesting))
	fmt.Fprintf(stdout, "参与判定的作用域（REV-3）：%d 个（0 越限时据此判断不是漏报）\n", scanned.scopeCount)
}

func reportImproved(stdout io.Writer, improved []string) {
	if len(improved) == 0 {
		return
	}
	fmt.Fprintf(stdout, "已整改（建议 --update 收缩基线）：%d 项\n", len(improved))
	for _, item := range improved {
		fmt.Fprintf(stdout, "  - %s\n", item)
	}
}
