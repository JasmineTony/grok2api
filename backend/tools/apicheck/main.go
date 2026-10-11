// apicheck 校验后端导出 API 面是否与基线逐条一致。
//
// 用途：结构重构（拆分函数/文件、抽取辅助函数）必须保持公共契约不变。
// 编译通过只能证明包内自洽，无法发现「导出函数被删除或签名被改写」这类
// 只有仓外调用方才会感知的破坏。本工具把导出名 + 归一化签名/类型定义导出为
// 基线文本，逐条比对，任何差异都判定失败。
//
// 用法（必须从 backend/ 目录运行）：
//
//	go run ./tools/apicheck            # 校验，与基线不一致即非零退出
//	go run ./tools/apicheck --update   # 重新冻结基线（仅在有意变更公共契约后使用）
package main

import (
	"bufio"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const defaultBaseline = "api-baseline.txt"

func main() {
	root := flag.String("root", ".", "扫描根目录（应指向 backend/）")
	baselinePath := flag.String("baseline", defaultBaseline, "API 基线文件路径")
	update := flag.Bool("update", false, "用当前实测导出 API 面重写基线")
	flag.Parse()

	lines, err := collectExportedAPI(*root)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}

	if *update {
		if err := writeBaseline(*baselinePath, lines); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		fmt.Printf("已更新 API 基线：%d 条 → %s\n", len(lines), *baselinePath)
		return
	}

	old, err := readBaseline(*baselinePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "缺少 API 基线 %s：先运行 go run ./tools/apicheck --update\n", *baselinePath)
		os.Exit(2)
	}
	os.Exit(reportDiff(old, lines))
}

// collectExportedAPI 汇总扫描根下全部生产 Go 文件的导出声明，返回排序去重后的条目。
func collectExportedAPI(root string) ([]string, error) {
	seen := map[string]bool{}
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return nil
		}
		if !isProductionGoFile(root, path) {
			return nil
		}
		for _, line := range fileEntries(root, path) {
			seen[line] = true
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(seen))
	for line := range seen {
		lines = append(lines, line)
	}
	sort.Strings(lines)
	return lines, nil
}

func isProductionGoFile(root, path string) bool {
	if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
		return false
	}
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	rel = filepath.ToSlash(rel)
	return !underDirectory(rel, "docs") && !underDirectory(rel, "testdata")
}

// underDirectory 判断相对路径是否位于指定目录内（含该目录本身）。
func underDirectory(rel, name string) bool {
	return rel == name || strings.HasPrefix(rel, name+"/") || strings.Contains(rel, "/"+name+"/")
}

// fileEntries 解析单个文件并返回其导出声明条目。
func fileEntries(root, path string) []string {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, path, nil, 0)
	if err != nil {
		fmt.Fprintf(os.Stderr, "解析失败（已跳过）: %s: %v\n", path, err)
		return nil
	}
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return nil
	}
	scope := filepath.ToSlash(filepath.Dir(rel))
	pkg := file.Name.Name
	render := renderer(fset)

	var lines []string
	for _, decl := range file.Decls {
		switch node := decl.(type) {
		case *ast.FuncDecl:
			lines = append(lines, funcEntry(scope, pkg, node, render)...)
		case *ast.GenDecl:
			lines = append(lines, genEntries(scope, pkg, node, render)...)
		}
	}
	return lines
}

func funcEntry(scope, pkg string, node *ast.FuncDecl, render func(ast.Node) string) []string {
	name := node.Name.Name
	if !ast.IsExported(name) {
		return nil
	}
	if node.Recv != nil && len(node.Recv.List) > 0 {
		return []string{fmt.Sprintf("%s [%s] method (%s).%s %s", scope, pkg, render(node.Recv.List[0].Type), name, render(node.Type))}
	}
	return []string{fmt.Sprintf("%s [%s] func %s %s", scope, pkg, name, render(node.Type))}
}

func genEntries(scope, pkg string, node *ast.GenDecl, render func(ast.Node) string) []string {
	var lines []string
	for _, spec := range node.Specs {
		switch item := spec.(type) {
		case *ast.TypeSpec:
			if ast.IsExported(item.Name.Name) {
				lines = append(lines, fmt.Sprintf("%s [%s] type %s %s", scope, pkg, item.Name.Name, render(item.Type)))
			}
		case *ast.ValueSpec:
			lines = append(lines, valueEntries(scope, pkg, node.Tok.String(), item, render)...)
		}
	}
	return lines
}

func valueEntries(scope, pkg, kind string, spec *ast.ValueSpec, render func(ast.Node) string) []string {
	var lines []string
	for index, name := range spec.Names {
		if !ast.IsExported(name.Name) {
			continue
		}
		value := ""
		if len(spec.Values) == len(spec.Names) {
			value = " = " + render(spec.Values[index])
		}
		lines = append(lines, fmt.Sprintf("%s [%s] %s %s %s%s", scope, pkg, kind, name.Name, render(spec.Type), value))
	}
	return lines
}

// renderer 返回把 AST 节点渲染成单行、空白归一化文本的函数。
func renderer(fset *token.FileSet) func(ast.Node) string {
	return func(node ast.Node) string {
		if node == nil {
			return ""
		}
		var builder strings.Builder
		if err := printer.Fprint(&builder, fset, node); err != nil {
			return "<unrenderable>"
		}
		return strings.Join(strings.Fields(builder.String()), " ")
	}
}

func readBaseline(path string) ([]string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var lines []string
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64<<10), 8<<20)
	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r")
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		lines = append(lines, line)
	}
	return lines, scanner.Err()
}

func writeBaseline(path string, lines []string) error {
	var builder strings.Builder
	builder.WriteString("# 后端导出 API 面基线（由 go run ./tools/apicheck --update 生成）。\n")
	builder.WriteString("# 逐条比对：新增/删除/签名变化都判定失败；有意变更公共契约时才重跑 --update。\n")
	for _, line := range lines {
		builder.WriteString(line)
		builder.WriteString("\n")
	}
	return os.WriteFile(path, []byte(builder.String()), 0o644)
}

// reportDiff 打印基线差异并返回进程退出码。
func reportDiff(old, current []string) int {
	oldSet := indexLines(old)
	newSet := indexLines(current)

	var removed, added []string
	for _, line := range old {
		if !newSet[line] {
			removed = append(removed, line)
		}
	}
	for _, line := range current {
		if !oldSet[line] {
			added = append(added, line)
		}
	}

	fmt.Printf("基线条目 %d 条，当前 %d 条。\n", len(old), len(current))
	if len(removed) == 0 && len(added) == 0 {
		fmt.Println("导出 API 面与基线逐条一致。")
		return 0
	}
	printLines("公共契约被删除或签名被改写（必须恢复，或确认后 --update）", removed)
	printLines("公共契约新增（确认是本次需求的一部分后再 --update）", added)
	fmt.Fprintf(os.Stderr, "\nAPI 契约校验失败：删除/改写 %d 条，新增 %d 条。\n", len(removed), len(added))
	return 1
}

func indexLines(lines []string) map[string]bool {
	set := make(map[string]bool, len(lines))
	for _, line := range lines {
		set[line] = true
	}
	return set
}

func printLines(title string, lines []string) {
	if len(lines) == 0 {
		return
	}
	fmt.Printf("\n%s：%d 条\n", title, len(lines))
	for _, line := range lines {
		fmt.Printf("  - %s\n", line)
	}
}
