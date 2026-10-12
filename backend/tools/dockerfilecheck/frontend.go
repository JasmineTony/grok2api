// frontend.go 计算前端容器构建必需文件集合：
// 起点配置 → 相对 import 传递闭包 → tsconfig include/files 展开 → 非源码固定输入。
//
// 口径边界：
//   - 只跟随以 ./ 或 ../ 开头的静态 import / export ... from / 动态 import()；
//     别名（@/）、包名、import.meta.glob 的模式串一律忽略；
//   - 扩展名按 TS/JS/JSON 语义依次尝试 .ts/.tsx/.mts/.cts/.d.ts/.js/.jsx/.mjs/.cjs/.json
//     与 /index.*；查询串（?raw 等）在解析前剥离；
//   - 相对 import 无法解析为仓库内文件时记失败（TS2307 同类缺陷）；
//   - tsconfig 只读取 files/include/exclude/extends/references 字段，include 展开仅覆盖
//     TypeScript 支持的扩展名，跳过 node_modules 与 .git；
//   - 测试文件（*.test.ts/tsx、*.spec.ts/tsx）不参与闭包扩展，也不要求被 COPY 覆盖。
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

const frontendLabel = "frontend"

// frontendRootTsconfig 是 tsc -b 的工程入口（references 指向 app/node 两个子工程）。
const frontendRootTsconfig = "frontend/tsconfig.json"

// frontendSeeds 是闭包起点：容器内构建/测试真正加载的两个配置。
var frontendSeeds = []string{"frontend/vite.config.ts", "frontend/vitest.config.ts"}

// frontendFixedInputs 是非源码构建输入（包管理与 tsc 工程文件），缺失即容器构建失败。
var frontendFixedInputs = []string{
	"frontend/package.json",
	"frontend/pnpm-lock.yaml",
	"frontend/pnpm-workspace.yaml",
	"frontend/index.html",
	"frontend/tsconfig.json",
	"frontend/tsconfig.app.json",
	"frontend/tsconfig.node.json",
}

// tsSourceExtensions 是 tsconfig include 展开时纳入的扩展名（对齐 TypeScript 的 supported extensions）。
var tsSourceExtensions = []string{".ts", ".tsx", ".mts", ".cts", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".json"}

// tsModuleExtensions 是需要继续解析相对 import 的源码扩展名（JSON 只作为输入，不解析）。
var tsModuleExtensions = []string{".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"}

// tsExemptSuffixes 是容器构建不需要的测试文件后缀。
var tsExemptSuffixes = []string{".test.ts", ".test.tsx", ".test.js", ".test.mjs", ".spec.ts", ".spec.tsx"}

// tsSpecifierPattern 匹配相对路径的静态 import / export ... from / 动态 import()。
var tsSpecifierPattern = regexp.MustCompile(`(?:from\s*|import\s*\(?\s*)["'](\.{1,2}/[^"']*)["']`)

// tsconfigView 是 tsconfig.json 中与闭包相关的字段投影。
type tsconfigView struct {
	Files      []string `json:"files"`
	Include    []string `json:"include"`
	Exclude    []string `json:"exclude"`
	Extends    string   `json:"extends"`
	References []struct {
		Path string `json:"path"`
	} `json:"references"`
}

// tsTreeQuery 描述一次 include/files 展开的过滤条件。
type tsTreeQuery struct {
	sourceDir string
	treeRoot  string
	origin    string
	reason    string
	include   *regexp.Regexp
	exclude   []*regexp.Regexp
}

// collectFrontendRequired 计算前端构建必需文件集合。
func collectFrontendRequired(root string) (closureResult, error) {
	result := closureResult{label: frontendLabel}
	queue, err := frontendInitialQueue(root)
	if err != nil {
		return result, err
	}
	seen := map[string]bool{}
	for len(queue) > 0 {
		item := queue[0]
		queue = queue[1:]
		if seen[item.path] {
			continue
		}
		seen[item.path] = true
		if isExemptFrontend(item.path) {
			result.exempt++
			continue
		}
		result.required = append(result.required, item)
		if !hasTsModuleExtension(item.path) {
			continue
		}
		next, unresolved, err := followTsImports(root, item)
		if err != nil {
			return result, err
		}
		result.unresolved = append(result.unresolved, unresolved...)
		queue = append(queue, next...)
	}
	sortRequired(&result)
	return result, nil
}

// frontendInitialQueue 组装闭包起点：种子配置、非源码输入与 tsconfig 展开结果。
func frontendInitialQueue(root string) ([]requiredFile, error) {
	queue := make([]requiredFile, 0, 32)
	for _, rel := range append(append([]string{}, frontendSeeds...), frontendFixedInputs...) {
		if !fileExists(filepath.Join(root, filepath.FromSlash(rel))) {
			return nil, fmt.Errorf("缺少前端构建输入 %s", rel)
		}
		queue = append(queue, requiredFile{path: rel, origin: rel + ":1", reason: "前端构建固定输入"})
	}
	if err := collectTsconfigProject(root, frontendRootTsconfig, map[string]bool{}, &queue); err != nil {
		return nil, err
	}
	return queue, nil
}

// collectTsconfigProject 展开一个 tsconfig（extends + references + include/files）。
func collectTsconfigProject(root, rel string, seen map[string]bool, queue *[]requiredFile) error {
	if seen[rel] {
		return nil
	}
	seen[rel] = true
	view, raw, err := readTsconfig(root, rel)
	if err != nil {
		return err
	}
	sourceDir := path.Dir(rel)
	for _, pattern := range append(append([]string{}, view.Files...), view.Include...) {
		entries, err := expandTsPattern(root, rel, sourceDir, pattern, view.Exclude, raw)
		if err != nil {
			return err
		}
		*queue = append(*queue, entries...)
	}
	for _, reference := range view.References {
		next, err := resolveTsconfigReference(root, sourceDir, reference.Path)
		if err != nil {
			return err
		}
		if err := collectTsconfigProject(root, next, seen, queue); err != nil {
			return err
		}
	}
	return resolveTsconfigExtends(root, sourceDir, view.Extends, seen, queue)
}

// expandTsPattern 展开一条 files/include 条目：目录、单文件或通配模式。
func expandTsPattern(root, tsconfigRel, sourceDir, pattern string, exclude []string, raw string) ([]requiredFile, error) {
	cleaned := normalizeIgnorePattern(pattern)
	if cleaned == "" {
		return nil, nil
	}
	origin := fmt.Sprintf("%s:%d", tsconfigRel, patternLine(raw, pattern))
	excluded, err := compileIgnorePatterns(exclude)
	if err != nil {
		return nil, err
	}
	if !strings.ContainsAny(cleaned, "*?") {
		return expandTsEntry(root, sourceDir, cleaned, origin, excluded)
	}
	compiled, err := compileIgnorePattern(cleaned)
	if err != nil {
		return nil, err
	}
	query := tsTreeQuery{
		sourceDir: sourceDir,
		treeRoot:  relJoin(sourceDir, staticPrefix(cleaned)),
		origin:    origin,
		reason:    "tsconfig include 通配展开",
		include:   compiled,
		exclude:   excluded,
	}
	return expandTsTree(root, query)
}

// expandTsEntry 展开 files/include 中的目录或单文件条目。
func expandTsEntry(root, sourceDir, entry, origin string, exclude []*regexp.Regexp) ([]requiredFile, error) {
	rel := relJoin(sourceDir, entry)
	info, err := os.Stat(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		return nil, fmt.Errorf("tsconfig files/include 条目不存在：%s", rel)
	}
	if !info.IsDir() {
		if !hasTsSourceExtension(rel) {
			return nil, nil
		}
		return []requiredFile{{path: rel, origin: origin, reason: "tsconfig files 显式列出"}}, nil
	}
	return expandTsTree(root, tsTreeQuery{
		sourceDir: sourceDir,
		treeRoot:  rel,
		origin:    origin,
		reason:    "tsconfig include 目录",
		exclude:   exclude,
	})
}

// expandTsTree 收集 treeRoot 下符合条件的 TS 源文件（应用 include 通配与 exclude）。
func expandTsTree(root string, query tsTreeQuery) ([]requiredFile, error) {
	files, err := walkTsFiles(root, query.treeRoot)
	if err != nil {
		return nil, err
	}
	out := make([]requiredFile, 0, len(files))
	for _, file := range files {
		relative := strings.TrimPrefix(strings.TrimPrefix(file, query.sourceDir), "/")
		if query.include != nil && !query.include.MatchString(relative) {
			continue
		}
		if matchesAnyPattern(query.exclude, relative) {
			continue
		}
		out = append(out, requiredFile{path: file, origin: query.origin, reason: query.reason})
	}
	return out, nil
}

// followTsImports 解析单个文件的相对 import，返回新必需文件与无法解析的引用。
func followTsImports(root string, item requiredFile) ([]requiredFile, []finding, error) {
	content, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(item.path)))
	if err != nil {
		return nil, nil, fmt.Errorf("读取 %s 失败：%w", item.path, err)
	}
	text := string(content)
	sourceDir := path.Dir(item.path)
	next := []requiredFile{}
	unresolved := []finding{}
	for _, match := range tsSpecifierPattern.FindAllStringSubmatchIndex(text, -1) {
		specifier := text[match[2]:match[3]]
		origin := fmt.Sprintf("%s:%d", item.path, lineNumberAt(text, match[2]))
		resolved, ok := resolveTsSpecifier(root, sourceDir, specifier)
		if !ok {
			unresolved = append(unresolved, finding{
				anchor:  origin,
				message: fmt.Sprintf("相对 import 无法解析为仓库内文件：%s（TS2307 同类缺陷）", specifier),
			})
			continue
		}
		next = append(next, requiredFile{path: resolved, origin: origin, reason: "相对 import 目标"})
	}
	return next, unresolved, nil
}

// resolveTsSpecifier 把相对 import 解析为仓库根相对路径。
func resolveTsSpecifier(root, sourceDir, specifier string) (string, bool) {
	cleaned := stripSpecifierQuery(specifier)
	if cleaned == "" {
		return "", false
	}
	base := relJoin(sourceDir, strings.TrimSuffix(cleaned, "/"))
	if strings.HasPrefix(base, "..") {
		return "", false
	}
	for _, candidate := range tsResolutionCandidates(base) {
		if fileExists(filepath.Join(root, filepath.FromSlash(candidate))) {
			return candidate, true
		}
	}
	return "", false
}

// tsResolutionCandidates 按 TypeScript/Bundler 解析顺序给出候选路径。
func tsResolutionCandidates(base string) []string {
	candidates := []string{base}
	for _, extension := range tsSourceExtensions {
		candidates = append(candidates, base+extension)
	}
	for _, extension := range tsSourceExtensions {
		candidates = append(candidates, base+"/index"+extension)
	}
	return candidates
}

// resolveTsconfigReference 解析 references[].path：可指向目录（目录下 tsconfig.json）或文件。
func resolveTsconfigReference(root, sourceDir, reference string) (string, error) {
	rel := relJoin(sourceDir, reference)
	if fileExists(filepath.Join(root, filepath.FromSlash(rel))) {
		return rel, nil
	}
	candidate := relJoin(rel, "tsconfig.json")
	if fileExists(filepath.Join(root, filepath.FromSlash(candidate))) {
		return candidate, nil
	}
	return "", fmt.Errorf("tsconfig references 指向的文件不存在：%s", rel)
}

// resolveTsconfigExtends 处理 extends：只支持相对路径，包名 extends 忽略（不参与闭包）。
func resolveTsconfigExtends(root, sourceDir, extends string, seen map[string]bool, queue *[]requiredFile) error {
	if extends == "" || !strings.HasPrefix(extends, ".") {
		return nil
	}
	next := relJoin(sourceDir, extends)
	if !strings.HasSuffix(next, ".json") {
		next += ".json"
	}
	if !fileExists(filepath.Join(root, filepath.FromSlash(next))) {
		return fmt.Errorf("tsconfig extends 指向的文件不存在：%s", next)
	}
	return collectTsconfigProject(root, next, seen, queue)
}

// readTsconfig 读取 tsconfig 原文并解析为字段投影。
func readTsconfig(root, rel string) (tsconfigView, string, error) {
	raw, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		return tsconfigView{}, "", fmt.Errorf("读取 %s 失败：%w", rel, err)
	}
	text := string(raw)
	view, err := decodeTsconfig(text)
	if err != nil {
		return tsconfigView{}, "", fmt.Errorf("解析 %s 失败：%w", rel, err)
	}
	return view, text, nil
}

// decodeTsconfig 解析 tsconfig；含整行 `//` 注释时先剔除注释再解析。
func decodeTsconfig(text string) (tsconfigView, error) {
	var view tsconfigView
	if err := json.Unmarshal([]byte(text), &view); err == nil {
		return view, nil
	}
	var retry tsconfigView
	if err := json.Unmarshal([]byte(stripCommentLines(text)), &retry); err != nil {
		return tsconfigView{}, err
	}
	return retry, nil
}

// stripCommentLines 删除整行注释（只处理行首 `//`，避免破坏字符串中的 URL）。
func stripCommentLines(text string) string {
	kept := make([]string, 0, 32)
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "//") {
			continue
		}
		kept = append(kept, line)
	}
	return strings.Join(kept, "\n")
}

// walkTsFiles 递归收集目录下 TypeScript 支持扩展名的文件（仓库根相对、排序）。
func walkTsFiles(root, relDir string) ([]string, error) {
	files := make([]string, 0, 32)
	err := filepath.WalkDir(filepath.Join(root, filepath.FromSlash(relDir)), func(current string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if skippedWalkDir(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		rel, relErr := filepath.Rel(root, current)
		if relErr != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if hasTsSourceExtension(rel) {
			files = append(files, rel)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return files, nil
}

// skippedWalkDir 判断是否跳过该目录（依赖与版本库目录不会承载构建输入）。
func skippedWalkDir(name string) bool {
	return name == "node_modules" || name == ".git"
}

// compileIgnorePatterns 批量编译模式（沿用 .dockerignore 的通配语义）。
func compileIgnorePatterns(patterns []string) ([]*regexp.Regexp, error) {
	compiled := make([]*regexp.Regexp, 0, len(patterns))
	for _, pattern := range patterns {
		cleaned := normalizeIgnorePattern(pattern)
		if cleaned == "" {
			continue
		}
		expr, err := compileIgnorePattern(cleaned)
		if err != nil {
			return nil, err
		}
		compiled = append(compiled, expr)
	}
	return compiled, nil
}

// matchesAnyPattern 判断路径是否命中任一模式。
func matchesAnyPattern(patterns []*regexp.Regexp, relative string) bool {
	for _, pattern := range patterns {
		if pattern.MatchString(relative) {
			return true
		}
	}
	return false
}

// staticPrefix 返回通配模式中不含通配符的目录前缀。
func staticPrefix(pattern string) string {
	index := strings.IndexAny(pattern, "*?")
	if index < 0 {
		return pattern
	}
	prefix := pattern[:index]
	slash := strings.LastIndex(prefix, "/")
	if slash < 0 {
		return ""
	}
	return prefix[:slash]
}

// patternLine 在 tsconfig 原文中定位条目所在行（找不到时退回第 1 行）。
func patternLine(raw, pattern string) int {
	for index, line := range strings.Split(raw, "\n") {
		if strings.Contains(line, `"`+pattern+`"`) {
			return index + 1
		}
	}
	return 1
}

// isExemptFrontend 判断前端测试文件：不参与闭包扩展，也不要求被 COPY 覆盖。
func isExemptFrontend(rel string) bool {
	base := path.Base(rel)
	for _, suffix := range tsExemptSuffixes {
		if strings.HasSuffix(base, suffix) {
			return true
		}
	}
	return false
}

// hasTsSourceExtension 判断文件是否属于 tsconfig include 展开的扩展名范围。
func hasTsSourceExtension(rel string) bool {
	for _, extension := range tsSourceExtensions {
		if strings.HasSuffix(rel, extension) {
			return true
		}
	}
	return false
}

// hasTsModuleExtension 判断文件是否需要继续解析相对 import（JSON/HTML 只作为输入）。
func hasTsModuleExtension(rel string) bool {
	for _, extension := range tsModuleExtensions {
		if strings.HasSuffix(rel, extension) {
			return true
		}
	}
	return false
}

// stripSpecifierQuery 去掉 import 说明符上的查询串与片段（?raw、?url、#...）。
func stripSpecifierQuery(specifier string) string {
	if index := strings.IndexAny(specifier, "?#"); index >= 0 {
		return specifier[:index]
	}
	return specifier
}

// lineNumberAt 由字节偏移换算 1 起始行号。
func lineNumberAt(content string, offset int) int {
	if offset > len(content) {
		offset = len(content)
	}
	return strings.Count(content[:offset], "\n") + 1
}

// relJoin 以 '/' 分隔拼接仓库根相对路径（不引入平台分隔符）。
func relJoin(base, element string) string {
	return strings.TrimPrefix(path.Join(base, element), "./")
}
