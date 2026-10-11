package provider_test

import (
	"fmt"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

const internalModulePrefix = "github.com/chenyme/grok2api/backend/internal/"

// layerBoundary 按包路径段约束依赖，exceptions 只匹配模块相对文件名与完整包路径。
type layerBoundary struct {
	name         string
	directory    string
	forbidden    []string
	includeTests bool
	exceptions   map[string][]string
}

// applicationInfraExceptions 冻结现有生产依赖，只能保留或删除，不能新增文件或包。
// 文件移除依赖时必须同步删除例外，避免遗留授权被重新使用。
var applicationInfraExceptions = map[string][]string{
	"internal/application/account/service.go":                  {internalModulePrefix + "infra/security"},
	"internal/application/account/service_import.go":           {internalModulePrefix + "infra/security"},
	"internal/application/adminauth/service.go":                {internalModulePrefix + "infra/security"},
	"internal/application/clientkey/service.go":                {internalModulePrefix + "infra/security"},
	"internal/application/clientkey/service_authentication.go": {internalModulePrefix + "infra/security"},
	"internal/application/clientkey/service_key_crud.go":       {internalModulePrefix + "infra/security"},
	"internal/application/clientkey/service_quality_guard.go":  {internalModulePrefix + "infra/security"},
	"internal/application/egress/proxy_profiles.go":            {internalModulePrefix + "infra/security"},
	"internal/application/egress/quality_lease.go":             {internalModulePrefix + "infra/security"},
	"internal/application/egress/service.go":                   {internalModulePrefix + "infra/security"},
	"internal/application/gateway/egress_audit.go":             {internalModulePrefix + "infra/egress"},
	"internal/application/gateway/image_execution.go":          {internalModulePrefix + "infra/egress"},
	"internal/application/gateway/media_execution.go":          {internalModulePrefix + "infra/egress"},
	"internal/application/gateway/quality_probe.go":            {internalModulePrefix + "infra/egress", internalModulePrefix + "infra/security"},
	"internal/application/gateway/quality_retry.go":            {internalModulePrefix + "infra/egress"},
	"internal/application/gateway/service_credentials.go":      {internalModulePrefix + "infra/security"},
	"internal/application/gateway/service_ratelimit.go":        {internalModulePrefix + "infra/security"},
	"internal/application/gateway/service_request.go":          {internalModulePrefix + "infra/egress", internalModulePrefix + "infra/security"},
	"internal/application/gateway/service_resources.go":        {internalModulePrefix + "infra/egress"},
	"internal/application/gateway/video_job_run.go":            {internalModulePrefix + "infra/egress"},
	"internal/application/gateway/video_plan.go":               {internalModulePrefix + "infra/security"},
	"internal/application/gateway/video_tasks.go":              {internalModulePrefix + "infra/security"},
	"internal/application/gateway/voice_execution.go":          {internalModulePrefix + "infra/egress"},
	"internal/application/gateway/voice_ws.go":                 {internalModulePrefix + "infra/egress"},
	"internal/application/settings/config_apply.go":            {internalModulePrefix + "infra/config"},
	"internal/application/settings/editable_config.go":         {internalModulePrefix + "infra/config"},
	"internal/application/settings/service.go":                 {internalModulePrefix + "infra/config"},
}

var layerBoundaries = []layerBoundary{
	{
		name: "domain 不反向依赖上层或 infra", directory: "domain",
		forbidden: []string{"app", "application", "transport", "infra"}, includeTests: true,
	},
	{
		name: "repository 不反向依赖上层或 infra", directory: "repository",
		forbidden: []string{"app", "application", "transport", "infra"}, includeTests: true,
	},
	{
		name: "ports 不反向依赖上层或 infra", directory: "ports",
		forbidden: []string{"app", "application", "transport", "infra"}, includeTests: true,
	},
	{
		// application 只约束生产文件；_test.go 可用真实 infra 做装配验证。
		// domain/repository/ports 的测试不享有此豁免。
		name: "application 生产依赖边界及 infra 存量", directory: "application",
		forbidden: []string{"app", "transport", "infra"}, exceptions: applicationInfraExceptions,
	},
}

type importBoundaryScan struct {
	files        int
	imports      int
	skippedTests int
	violations   []string
	exceptions   []string
}

func TestLayerImportBoundaries(t *testing.T) {
	moduleRoot := backendModuleRoot(t)
	for _, boundary := range layerBoundaries {
		t.Run(boundary.name, func(t *testing.T) {
			result, err := forbiddenImports(moduleRoot, boundary)
			if err != nil {
				t.Fatalf("扫描 internal/%s 失败: %v", boundary.directory, err)
			}
			t.Logf("scope internal/%s: Go 文件=%d, AST imports=%d, 豁免测试文件=%d, 存量依赖=%d, 违规=%d", boundary.directory, result.files, result.imports, result.skippedTests, len(result.exceptions), len(result.violations))
			if result.files == 0 {
				t.Fatal("未扫描到 Go 文件，不能判定边界通过")
			}
			for _, dependency := range result.exceptions {
				t.Logf("保留存量: %s", dependency)
			}
			if len(result.violations) > 0 {
				t.Errorf("违反分层边界:\n%s", strings.Join(result.violations, "\n"))
			}
			if unused := unusedImportExceptions(boundary, result); len(unused) > 0 {
				t.Errorf("必须删除已消失的依赖例外:\n%s", strings.Join(unused, "\n"))
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

// forbiddenImports 扫描所有后缀为 .go 的文件（含生成文件、非当前平台和 build tag 文件）。
// 只有 includeTests=false 时的 _test.go 不参与解析；目录或解析错误立即返回，不返回部分结果。
func forbiddenImports(moduleRoot string, boundary layerBoundary) (importBoundaryScan, error) {
	var result importBoundaryScan
	directory := filepath.Join(moduleRoot, "internal", boundary.directory)
	err := filepath.WalkDir(directory, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") {
			return nil
		}
		if !boundary.includeTests && strings.HasSuffix(path, "_test.go") {
			result.skippedTests++
			return nil
		}
		if err := collectForbiddenImports(path, moduleRoot, boundary, &result); err != nil {
			return err
		}
		result.files++
		return nil
	})
	if err != nil {
		return importBoundaryScan{}, err
	}
	return result, nil
}

func collectForbiddenImports(path, moduleRoot string, boundary layerBoundary, result *importBoundaryScan) error {
	positions := token.NewFileSet()
	// 完整解析，避免 ImportsOnly 吞掉 import 声明之后的语法错误。
	file, err := parser.ParseFile(positions, path, nil, parser.SkipObjectResolution)
	if err != nil {
		return err
	}
	relative, err := filepath.Rel(moduleRoot, path)
	if err != nil {
		return err
	}
	display := filepath.ToSlash(relative)
	for _, spec := range file.Imports {
		imported, err := strconv.Unquote(spec.Path.Value)
		if err != nil {
			return fmt.Errorf("%s: 解析 import: %w", display, err)
		}
		result.imports++
		if !boundary.forbids(imported) {
			continue
		}
		if slices.Contains(boundary.exceptions[display], imported) {
			result.exceptions = append(result.exceptions, display+" -> "+imported)
			continue
		}
		result.violations = append(result.violations, fmt.Sprintf("%s:%d -> %s", display, positions.Position(spec.Pos()).Line, imported))
	}
	return nil
}

func (boundary layerBoundary) forbids(imported string) bool {
	for _, layer := range boundary.forbidden {
		prefix := internalModulePrefix + layer
		if imported == prefix || strings.HasPrefix(imported, prefix+"/") {
			return true
		}
	}
	return false
}

func unusedImportExceptions(boundary layerBoundary, result importBoundaryScan) []string {
	var unused []string
	for file, imports := range boundary.exceptions {
		for _, imported := range imports {
			dependency := file + " -> " + imported
			if !slices.Contains(result.exceptions, dependency) {
				unused = append(unused, dependency)
			}
		}
	}
	slices.Sort(unused)
	return unused
}
