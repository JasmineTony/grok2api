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

// transportInfraExceptions 冻结现有 transport → infra 直连，只能保留或删除，不能新增。
// 例外 internal/transport/http/middleware/request.go:11 -> infra/security 的理由：使用点 :24 的
// security.NewOpaqueToken(12) 只生成请求关联 ID 原语，属请求元数据而非业务逻辑；迁移到
// application/ports 属独立改动，本轮只登记例外、不改生产代码（BE-G1）。文件移除依赖时必须同步
// 删除例外，避免遗留授权被重新使用。
var transportInfraExceptions = map[string][]string{
	"internal/transport/http/middleware/request.go": {internalModulePrefix + "infra/security"},
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
	{
		// transport 只约束生产文件：handler 测试用真实 infra（relational、provider 等）做装配验证。
		// transport → app 会形成 import cycle，由编译器兜底；编译器看不到的可判定方向是 infra。
		name: "transport 生产文件不直连 infra", directory: "transport",
		forbidden: []string{"infra"}, exceptions: transportInfraExceptions,
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
	totalFiles, totalRules, totalExceptions := 0, 0, 0
	for _, boundary := range layerBoundaries {
		t.Run(boundary.name, func(t *testing.T) {
			result, err := forbiddenImports(moduleRoot, boundary)
			if err != nil {
				t.Fatalf("扫描 internal/%s 失败: %v", boundary.directory, err)
			}
			t.Logf("scope internal/%s: Go 文件=%d, AST imports=%d, 豁免测试文件=%d, 存量依赖=%d, 违规=%d", boundary.directory, result.files, result.imports, result.skippedTests, len(result.exceptions), len(result.violations))
			totalFiles += result.files
			totalRules++
			totalExceptions += len(result.exceptions)
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
	t.Logf("参与判定的边界规则=%d、Go 文件=%d、存量依赖=%d", totalRules, totalFiles, totalExceptions)
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

// internalDirectoryCoverage 登记 internal 下每个一级目录的判定归属（BE-G2）：有规则的目录必须写明
// 规则名并与 layerBoundaries 一致，无规则的目录必须写明豁免理由。新增或删除一级目录时必须同步本表，
// 否则 TestInternalDirectoryCoverageBoundary 失败。
type internalDirectoryCoverage struct {
	rule   string // 非空时必须与 layerBoundaries 中同 directory 规则的 name 一致
	reason string // rule 为空时必填：为什么该目录不需要规则
}

var internalDirectoryCoverageEntries = map[string]internalDirectoryCoverage{
	"app":         {reason: "唯一装配入口（assemble.go、application.go），装配职责本身就是跨层依赖，禁入规则无意义"},
	"application": {rule: "application 生产依赖边界及 infra 存量"},
	"buildinfo":   {reason: "只暴露版本常量，无任何 internal 依赖"},
	"cli":         {reason: "进程入口，装配序列按需调用 app 与 infra/config、infra/observability"},
	"domain":      {rule: "domain 不反向依赖上层或 infra"},
	"infra":       {reason: "BE-G1 未收口部分：infra/egress 8 个生产文件依赖 application/egress，加规则前需先冻结这 8 条存量"},
	"pkg":         {reason: "通用工具包；生产代码只依赖 repository 契约（reasoningreplay），其余 internal 引用在测试内"},
	"ports":       {rule: "ports 不反向依赖上层或 infra"},
	"repository":  {rule: "repository 不反向依赖上层或 infra"},
	"shared":      {reason: "纯值类型，无任何 internal 依赖"},
	"transport":   {rule: "transport 生产文件不直连 infra"},
}

// TestInternalDirectoryCoverageBoundary 守卫 BE-G2：internal 下每个一级目录都必须由 layerBoundaries
// 规则或 internalDirectoryCoverageEntries 的豁免登记覆盖；新目录未纳入判定时本测试失败。
func TestInternalDirectoryCoverageBoundary(t *testing.T) {
	moduleRoot := backendModuleRoot(t)
	entries, err := os.ReadDir(filepath.Join(moduleRoot, "internal"))
	if err != nil {
		t.Fatalf("读取 internal 目录失败: %v", err)
	}
	present := map[string]bool{}
	for _, entry := range entries {
		if entry.IsDir() {
			present[entry.Name()] = true
		}
	}
	if len(present) == 0 {
		t.Fatal("未扫描到 internal 一级目录，不能判定覆盖完整")
	}
	ruled := map[string]string{}
	for _, boundary := range layerBoundaries {
		ruled[boundary.directory] = boundary.name
	}
	for directory := range present {
		coverage, registered := internalDirectoryCoverageEntries[directory]
		if registered && coverage.rule == "" && strings.TrimSpace(coverage.reason) == "" {
			t.Errorf("internal/%s 的覆盖登记既不是规则也没有豁免理由", directory)
		}
		if name, ok := ruled[directory]; ok && coverage.rule != name {
			t.Errorf("internal/%s 覆盖登记 rule=%q，实际规则=%q", directory, coverage.rule, name)
		}
		if _, ok := ruled[directory]; !ok {
			if !registered {
				t.Errorf("internal/%s 未被任何规则或覆盖登记覆盖：请扩展 layerBoundaries 或登记豁免理由", directory)
			} else if coverage.rule != "" {
				t.Errorf("internal/%s 覆盖登记规则 %q，但 layerBoundaries 无该规则", directory, coverage.rule)
			}
		}
	}
	for directory, name := range ruled {
		if !present[directory] {
			t.Errorf("规则 %q 指向不存在的目录 internal/%s", name, directory)
		}
	}
	for directory := range internalDirectoryCoverageEntries {
		if !present[directory] {
			t.Errorf("覆盖登记 internal/%s 已消失：请删除该登记", directory)
		}
	}
	t.Logf("internal 一级目录覆盖（BE-G2）：规则=%d、豁免=%d、参与判定=%d", len(ruled), len(internalDirectoryCoverageEntries)-len(ruled), len(present))
}
