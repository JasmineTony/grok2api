package provider_test

import (
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const internalModulePrefix = "github.com/chenyme/grok2api/backend/internal/"

// layerBoundary 描述一条可验证的依赖方向规则：directory 下的 Go 文件不得
// import forbidden 前缀的包。
type layerBoundary struct {
	name         string
	directory    string
	forbidden    string
	includeTests bool
}

var layerBoundaries = []layerBoundary{
	{
		name:         "domain 不依赖 infra 实现",
		directory:    "domain",
		forbidden:    internalModulePrefix + "infra/",
		includeTests: true,
	},
	{
		name:         "repository 不依赖 infra 实现",
		directory:    "repository",
		forbidden:    internalModulePrefix + "infra/",
		includeTests: true,
	},
	{
		name:         "ports 不依赖 infra 实现",
		directory:    "ports",
		forbidden:    internalModulePrefix + "infra/",
		includeTests: true,
	},
	{
		// 仅约束生产代码：application 的测试仍可用真实 Registry 做装配级验证，
		// 但生产代码必须依赖 ports/provider 契约而不是 infra 实现包。
		name:         "application 生产代码不依赖 infra/provider 实现",
		directory:    "application",
		forbidden:    internalModulePrefix + "infra/provider",
		includeTests: false,
	},
}

func TestLayerImportBoundaries(t *testing.T) {
	moduleRoot := backendModuleRoot(t)
	internalDir := filepath.Join(moduleRoot, "internal")
	for _, boundary := range layerBoundaries {
		t.Run(boundary.name, func(t *testing.T) {
			violations, err := forbiddenImports(filepath.Join(internalDir, boundary.directory), boundary.forbidden, boundary.includeTests, moduleRoot)
			if err != nil {
				t.Fatalf("扫描 internal/%s 失败: %v", boundary.directory, err)
			}
			if len(violations) > 0 {
				t.Fatalf("internal/%s 违反分层边界（禁止 import %s）:\n%s", boundary.directory, boundary.forbidden, strings.Join(violations, "\n"))
			}
		})
	}
}

// backendModuleRoot 从测试工作目录向上查找含 go.mod 的 backend 模块根目录。
func backendModuleRoot(t *testing.T) string {
	t.Helper()
	directory, err := os.Getwd()
	if err != nil {
		t.Fatalf("读取测试工作目录失败: %v", err)
	}
	for {
		if _, statErr := os.Stat(filepath.Join(directory, "go.mod")); statErr == nil {
			return directory
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			t.Fatalf("未找到含 go.mod 的 backend 模块根目录")
		}
		directory = parent
	}
}

// forbiddenImports 返回目录树中 import 了 forbidden 前缀的文件与 import 路径。
func forbiddenImports(directory, forbidden string, includeTests bool, moduleRoot string) ([]string, error) {
	violations := make([]string, 0)
	err := filepath.WalkDir(directory, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") {
			return nil
		}
		if !includeTests && strings.HasSuffix(path, "_test.go") {
			return nil
		}
		return collectForbiddenImports(path, forbidden, moduleRoot, &violations)
	})
	if err != nil {
		return nil, err
	}
	return violations, nil
}

func collectForbiddenImports(path, forbidden, moduleRoot string, violations *[]string) error {
	file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
	if err != nil {
		return err
	}
	for _, spec := range file.Imports {
		imported := strings.Trim(spec.Path.Value, `"`)
		if !strings.HasPrefix(imported, forbidden) {
			continue
		}
		display := path
		if relative, relErr := filepath.Rel(moduleRoot, path); relErr == nil {
			display = filepath.ToSlash(relative)
		}
		*violations = append(*violations, display+" -> "+imported)
	}
	return nil
}
