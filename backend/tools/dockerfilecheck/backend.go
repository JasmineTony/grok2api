// backend.go 计算后端容器构建必需文件集合：
// go.mod / go.sum / docs/docs.go + cmd、internal 下的全部生产 .go，
// 并沿 go.mod 模块路径的自引用 import 继续扩展目录闭包（新增自建包不在 COPY 范围时也能拦下）。
//
// 口径边界：
//   - 只解析 import 声明（go/parser 的 ImportsOnly），不解析 build tag、条件编译与文件级 embed；
//   - *_test.go 不参与闭包扩展，也不要求被 COPY 覆盖（容器构建不需要它们）；
//   - 自引用 import 追加的目录只要求其下生产 .go 被覆盖，不校验目录本身的 COPY 语义差异。
package main

import (
	"fmt"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	backendLabel        = "backend"
	backendModulePrefix = "github.com/chenyme/grok2api/backend/"
)

// backendFixedInputs 是后端构建固定输入：模块与校验文件、swag 生成物。
var backendFixedInputs = []string{"backend/go.mod", "backend/go.sum", "backend/docs/docs.go"}

// backendWalkRoots 是业务源码根目录（容器内以目录粒度 COPY）。
var backendWalkRoots = []string{"backend/cmd", "backend/internal"}

// stageFixedInputs 是最终镜像阶段固定需要的仓库根输入（文件不存在时跳过）。
var stageFixedInputs = []string{"VERSION", "docker/entrypoint.sh"}

// collectBackendRequired 计算后端构建必需文件集合。
func collectBackendRequired(root string) (closureResult, error) {
	result := closureResult{label: backendLabel}
	seenFiles := map[string]bool{}
	for _, rel := range backendFixedInputs {
		if !fileExists(filepath.Join(root, filepath.FromSlash(rel))) {
			return result, fmt.Errorf("缺少后端构建固定输入 %s", rel)
		}
		seenFiles[rel] = true
		result.required = append(result.required, requiredFile{path: rel, origin: rel + ":1", reason: "后端构建固定输入"})
	}
	seenDirs := map[string]bool{}
	pending := append([]string{}, backendWalkRoots...)
	for len(pending) > 0 {
		dir := pending[0]
		pending = pending[1:]
		if seenDirs[dir] {
			continue
		}
		seenDirs[dir] = true
		imports, err := collectGoDir(root, dir, seenFiles, &result)
		if err != nil {
			return result, err
		}
		pending = append(pending, imports...)
	}
	sortRequired(&result)
	return result, nil
}

// collectGoDir 递归收集目录下的生产 .go 并返回其自引用 import 的仓库目录。
func collectGoDir(root, dir string, seen map[string]bool, result *closureResult) ([]string, error) {
	imports := []string{}
	walkErr := filepath.WalkDir(filepath.Join(root, filepath.FromSlash(dir)), func(current string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") {
			return nil
		}
		rel, relErr := filepath.Rel(root, current)
		if relErr != nil {
			return relErr
		}
		rel = filepath.ToSlash(rel)
		if seen[rel] {
			return nil
		}
		seen[rel] = true
		if strings.HasSuffix(entry.Name(), "_test.go") {
			result.exempt++
			return nil
		}
		result.required = append(result.required, requiredFile{path: rel, origin: rel + ":1", reason: "后端源码目录枚举"})
		selfImports, parseErr := goSelfImportDirs(root, rel)
		if parseErr != nil {
			return parseErr
		}
		imports = append(imports, selfImports...)
		return nil
	})
	return imports, walkErr
}

// goSelfImportDirs 解析 .go 文件的 import，返回换算为仓库根相对的模块内目录。
func goSelfImportDirs(root, rel string) ([]string, error) {
	parsed, err := parser.ParseFile(token.NewFileSet(), filepath.Join(root, filepath.FromSlash(rel)), nil, parser.ImportsOnly)
	if err != nil {
		return nil, fmt.Errorf("解析 %s 的 import 失败：%w", rel, err)
	}
	dirs := []string{}
	for _, spec := range parsed.Imports {
		value, err := strconv.Unquote(spec.Path.Value)
		if err != nil || !strings.HasPrefix(value, backendModulePrefix) {
			continue
		}
		dir := "backend/" + strings.TrimSuffix(strings.TrimPrefix(value, backendModulePrefix), "/")
		dirs = append(dirs, dir)
	}
	return dirs, nil
}

// collectStageFixedInputs 收集最终镜像阶段需要、且在仓库中确实存在的固定输入。
func collectStageFixedInputs(root string) (closureResult, error) {
	result := closureResult{label: finalStageLabel}
	for _, rel := range stageFixedInputs {
		if !fileExists(filepath.Join(root, filepath.FromSlash(rel))) {
			continue
		}
		result.required = append(result.required, requiredFile{path: rel, origin: rel + ":1", reason: "镜像最终阶段固定输入"})
	}
	return result, nil
}
