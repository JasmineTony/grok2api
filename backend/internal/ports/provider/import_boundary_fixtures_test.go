package provider_test

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"
)

func TestImportBoundaryLowerLayersRejectReverseDependencies(t *testing.T) {
	for _, directory := range []string{"domain", "repository", "ports"} {
		boundary := importBoundaryFor(t, directory)
		for _, target := range []string{"app", "app/bootstrap", "application", "application/account", "transport", "transport/http", "infra", "infra/security"} {
			for _, suffix := range []string{".go", "_test.go"} {
				t.Run(directory+"/"+target+suffix, func(t *testing.T) {
					file := "internal/" + directory + "/nested/fixture" + suffix
					imported := internalModulePrefix + target
					checkImportBoundaryFixture(t, boundary, map[string]string{file: importFixtureSource(imported)}, importBoundaryScan{
						files: 1, imports: 1, violations: []string{file + ":3 -> " + imported},
					})
				})
			}
		}
	}
}

func TestImportBoundaryApplicationRejectsUnregisteredDependencies(t *testing.T) {
	boundary := importBoundaryFor(t, "application")
	for _, target := range []string{"app", "app/bootstrap", "transport", "transport/http", "infra", "infra/provider", "infra/provider/console", "infra/security", "infra/config", "infra/egress"} {
		t.Run(target, func(t *testing.T) {
			file := "internal/application/fixture.go"
			imported := internalModulePrefix + target
			checkImportBoundaryFixture(t, boundary, map[string]string{file: importFixtureSource(imported)}, importBoundaryScan{
				files: 1, imports: 1, violations: []string{file + ":3 -> " + imported},
			})
		})
	}
}

func TestImportBoundaryAllowsDomainAndPorts(t *testing.T) {
	for _, boundary := range layerBoundaries {
		t.Run(boundary.directory, func(t *testing.T) {
			file := "internal/" + boundary.directory + "/fixture.go"
			source := "package fixture\nimport (\n" + strconv.Quote(internalModulePrefix+"domain/account") + "\n" + strconv.Quote(internalModulePrefix+"ports/provider") + "\n)\n"
			checkImportBoundaryFixture(t, boundary, map[string]string{file: source}, importBoundaryScan{files: 1, imports: 2})
		})
	}
}

func TestImportBoundaryExceptionsAreExactFilePackagePairs(t *testing.T) {
	boundary := importBoundaryFor(t, "application")
	cases := []struct {
		name, file, imported string
		allowed              bool
	}{
		{"registered", "account/service.go", "infra/security", true},
		{"new_file_same_package", "account/additional.go", "infra/security", false},
		{"same_basename_other_directory", "other/service.go", "infra/security", false},
		{"registered_file_other_package", "account/service.go", "infra/config", false},
		{"registered_file_subpackage", "account/service.go", "infra/security/nested", false},
		{"registered_file_similar_package", "account/service.go", "infra/securityextra", false},
		{"registered_file_upper_layer", "account/service.go", "app", false},
		{"registered_egress", "gateway/quality_probe.go", "infra/egress", true},
		{"registered_security", "gateway/quality_probe.go", "infra/security", true},
	}
	for _, fixture := range cases {
		t.Run(fixture.name, func(t *testing.T) {
			file := "internal/application/" + fixture.file
			imported := internalModulePrefix + fixture.imported
			want := importBoundaryScan{files: 1, imports: 1}
			if fixture.allowed {
				want.exceptions = []string{file + " -> " + imported}
			} else {
				want.violations = []string{file + ":3 -> " + imported}
			}
			checkImportBoundaryFixture(t, boundary, map[string]string{file: importFixtureSource(imported)}, want)
		})
	}
}

func TestImportBoundaryMixedImports(t *testing.T) {
	boundary := importBoundaryFor(t, "application")
	file := "internal/application/account/service.go"
	allowed := internalModulePrefix + "infra/security"
	forbidden := internalModulePrefix + "transport/http"
	cases := []struct {
		name      string
		imports   []string
		violation string
	}{
		{"after_whitelisted_import", []string{internalModulePrefix + "ports/provider", allowed, forbidden}, file + ":5 -> " + forbidden},
		{"before_whitelisted_import", []string{forbidden, allowed, internalModulePrefix + "ports/provider"}, file + ":3 -> " + forbidden},
	}
	for _, fixture := range cases {
		t.Run(fixture.name, func(t *testing.T) {
			declarations := make([]string, 0, len(fixture.imports))
			for _, imported := range fixture.imports {
				declarations = append(declarations, strconv.Quote(imported))
			}
			source := "package fixture\nimport (\n" + strings.Join(declarations, "\n") + "\n)\n"
			checkImportBoundaryFixture(t, boundary, map[string]string{file: source}, importBoundaryScan{
				files: 1, imports: 3, exceptions: []string{file + " -> " + allowed}, violations: []string{fixture.violation},
			})
		})
	}
}

func TestImportBoundaryApplicationTestExemption(t *testing.T) {
	boundary := importBoundaryFor(t, "application")
	for _, file := range []string{"assembly_test.go", "test_helpers.go", "fixture_test/assembly.go", "assembly.go"} {
		t.Run(file, func(t *testing.T) {
			relative := "internal/application/" + file
			imported := internalModulePrefix + "infra/provider"
			// 包名不是豁免依据，只有 application 下精确的 _test.go 后缀才豁免。
			source := strings.Replace(importFixtureSource(imported), "package fixture", "package fixture_test", 1)
			want := importBoundaryScan{files: 1, imports: 1, violations: []string{relative + ":3 -> " + imported}}
			if file == "assembly_test.go" {
				want = importBoundaryScan{skippedTests: 1}
			}
			checkImportBoundaryFixture(t, boundary, map[string]string{relative: source}, want)
		})
	}
	t.Run("test_files_outside_production_scope", func(t *testing.T) {
		checkImportBoundaryFixture(t, boundary, map[string]string{
			"internal/application/assembly_test.go": "package fixture\nimport (\"" + internalModulePrefix + "app\"; \"" + internalModulePrefix + "transport/http\")\n",
			"internal/application/broken_test.go":   "package fixture\nfunc broken( {",
		}, importBoundaryScan{skippedTests: 2})
	})
}

func TestImportBoundarySyntaxAndScope(t *testing.T) {
	boundary := importBoundaryFor(t, "domain")
	imported := internalModulePrefix + "infra/security"
	cases := []struct{ name, declaration string }{
		{"quoted", strconv.Quote(imported)},
		{"alias", "alias " + strconv.Quote(imported)},
		{"blank", "_ " + strconv.Quote(imported)},
		{"dot", ". " + strconv.Quote(imported)},
		{"raw_string", "`" + imported + "`"},
		{"escaped_separator", `"` + internalModulePrefix + `infra\x2fsecurity"`},
	}
	for _, fixture := range cases {
		t.Run(fixture.name, func(t *testing.T) {
			file := "internal/domain/fixture.go"
			checkImportBoundaryFixture(t, boundary, map[string]string{file: "package fixture\n\nimport " + fixture.declaration + "\n"}, importBoundaryScan{
				files: 1, imports: 1, violations: []string{file + ":3 -> " + imported},
			})
		})
	}
	t.Run("build_tags_and_generated_platform_files_still_scanned", func(t *testing.T) {
		file := "internal/domain/generated_linux.go"
		source := "//go:build boundary_fixture\n\n// Code generated by fixture; DO NOT EDIT.\npackage fixture\nimport " + strconv.Quote(imported) + "\n"
		checkImportBoundaryFixture(t, boundary, map[string]string{file: source}, importBoundaryScan{files: 1, imports: 1, violations: []string{file + ":5 -> " + imported}})
	})
	t.Run("comments_strings_non_go_and_similar_prefixes_are_not_dependencies", func(t *testing.T) {
		source := "package fixture\nimport (\n" + strconv.Quote(internalModulePrefix+"appsupport") + "\n" + strconv.Quote(internalModulePrefix+"infraextra/security") + "\n)\n// import " + strconv.Quote(imported) + "\nconst example = " + strconv.Quote(imported) + "\n"
		checkImportBoundaryFixture(t, boundary, map[string]string{"internal/domain/fixture.go": source, "internal/domain/ignored.txt": "not Go syntax"}, importBoundaryScan{files: 1, imports: 2})
	})
}

func TestImportBoundaryParseErrorsFailFast(t *testing.T) {
	boundary := importBoundaryFor(t, "domain")
	cases := []struct{ name, file, source string }{
		{"broken_import", "10_broken.go", "package fixture\nimport ("},
		{"broken_body_after_imports", "10_broken.go", "package fixture\nimport \"fmt\"\nfunc broken( {"},
		{"lower_layer_test_not_exempt", "10_broken_test.go", "package fixture\nfunc broken( {"},
	}
	for _, fixture := range cases {
		t.Run(fixture.name, func(t *testing.T) {
			root := writeImportBoundaryFixture(t, map[string]string{
				"internal/domain/00_valid.go":     importFixtureSource(internalModulePrefix + "ports/provider"),
				"internal/domain/" + fixture.file: fixture.source,
				"internal/domain/20_broken.go":    "package fixture\nimport (",
			})
			result, err := forbiddenImports(root, boundary)
			if err == nil || !strings.Contains(err.Error(), fixture.file) {
				t.Fatalf("必须在首个解析错误处失败，实际: %v", err)
			}
			if !reflect.DeepEqual(result, importBoundaryScan{}) {
				t.Fatalf("解析失败不能返回部分成功结果: %+v", result)
			}
			t.Logf("期望的 FailFast: %v", err)
		})
	}
	t.Run("missing_directory", func(t *testing.T) {
		result, err := forbiddenImports(t.TempDir(), boundary)
		if !errors.Is(err, fs.ErrNotExist) || !reflect.DeepEqual(result, importBoundaryScan{}) {
			t.Fatalf("缺失目录必须失败且不返回部分结果: result=%+v, err=%v", result, err)
		}
	})
}

func TestImportBoundaryExceptionRatchet(t *testing.T) {
	file := "internal/application/account/service.go"
	imported := internalModulePrefix + "infra/security"
	cases := []struct {
		name, file, imported string
		keepException        bool
		wantUnused           []string
	}{
		{"keep_dependency", file, imported, true, nil},
		{"remove_dependency_requires_removing_exception", file, internalModulePrefix + "domain/account", true, []string{file + " -> " + imported}},
		{"remove_file_requires_removing_exception", "internal/application/account/remaining.go", internalModulePrefix + "domain/account", true, []string{file + " -> " + imported}},
		{"remove_dependency_and_exception", file, internalModulePrefix + "domain/account", false, nil},
	}
	for _, fixture := range cases {
		t.Run(fixture.name, func(t *testing.T) {
			boundary := importBoundaryFor(t, "application")
			boundary.exceptions = nil
			if fixture.keepException {
				boundary.exceptions = map[string][]string{file: {imported}}
			}
			root := writeImportBoundaryFixture(t, map[string]string{fixture.file: importFixtureSource(fixture.imported)})
			result, err := forbiddenImports(root, boundary)
			if err != nil || len(result.violations) != 0 || result.files != 1 || result.imports != 1 {
				t.Fatalf("存量夹具扫描异常: result=%+v, err=%v", result, err)
			}
			if unused := unusedImportExceptions(boundary, result); !slices.Equal(unused, fixture.wantUnused) {
				t.Fatalf("未使用例外=%v, 期望=%v", unused, fixture.wantUnused)
			}
			t.Logf("未使用例外=%v", fixture.wantUnused)
		})
	}
}

func TestImportBoundaryTransportRule(t *testing.T) {
	boundary := importBoundaryFor(t, "transport")
	for _, target := range []string{"infra", "infra/security", "infra/security/nested"} {
		t.Run("unregistered_"+target, func(t *testing.T) {
			file := "internal/transport/http/fixture.go"
			imported := internalModulePrefix + target
			checkImportBoundaryFixture(t, boundary, map[string]string{file: importFixtureSource(imported)}, importBoundaryScan{
				files: 1, imports: 1, violations: []string{file + ":3 -> " + imported},
			})
		})
	}
	cases := []struct {
		name, file, target string
		allowed            bool
	}{
		{"frozen_exception", "internal/transport/http/middleware/request.go", "infra/security", true},
		{"same_package_other_file", "internal/transport/http/middleware/request_id.go", "infra/security", false},
		{"same_basename_other_directory", "internal/transport/http/request.go", "infra/security", false},
		{"frozen_file_other_package", "internal/transport/http/middleware/request.go", "infra/config", false},
		{"frozen_file_subpackage", "internal/transport/http/middleware/request.go", "infra/security/nested", false},
	}
	for _, fixture := range cases {
		t.Run(fixture.name, func(t *testing.T) {
			imported := internalModulePrefix + fixture.target
			want := importBoundaryScan{files: 1, imports: 1}
			if fixture.allowed {
				want.exceptions = []string{fixture.file + " -> " + imported}
			} else {
				want.violations = []string{fixture.file + ":3 -> " + imported}
			}
			checkImportBoundaryFixture(t, boundary, map[string]string{fixture.file: importFixtureSource(imported)}, want)
		})
	}
}

func TestImportBoundaryTransportTestFilesExempt(t *testing.T) {
	boundary := importBoundaryFor(t, "transport")
	// includeTests=false：只有生产文件受约束，handler 测试可用真实 infra 装配。
	relative := "internal/transport/http/fixture_test.go"
	source := strings.Replace(importFixtureSource(internalModulePrefix+"infra/security"), "package fixture", "package fixture_test", 1)
	checkImportBoundaryFixture(t, boundary, map[string]string{relative: source}, importBoundaryScan{skippedTests: 1})
}

func TestImportBoundaryInfraRule(t *testing.T) {
	boundary := importBoundaryFor(t, "infra")
	for _, target := range []string{"app", "application", "application/egress", "transport", "transport/http"} {
		t.Run("unregistered_"+target, func(t *testing.T) {
			file := "internal/infra/egress/fixture.go"
			imported := internalModulePrefix + target
			checkImportBoundaryFixture(t, boundary, map[string]string{file: importFixtureSource(imported)}, importBoundaryScan{
				files: 1, imports: 1, violations: []string{file + ":3 -> " + imported},
			})
		})
	}
	cases := []struct {
		name, file, target string
		allowed            bool
	}{
		{"frozen_exception", "internal/infra/egress/manager.go", "application/egress", true},
		{"same_package_other_file", "internal/infra/egress/egress_manager.go", "application/egress", false},
		{"same_basename_other_directory", "internal/infra/other/manager.go", "application/egress", false},
		{"frozen_file_other_package", "internal/infra/egress/manager.go", "application/gateway", false},
		{"frozen_file_subpackage", "internal/infra/egress/manager.go", "application/egress/nested", false},
	}
	for _, fixture := range cases {
		t.Run(fixture.name, func(t *testing.T) {
			imported := internalModulePrefix + fixture.target
			want := importBoundaryScan{files: 1, imports: 1}
			if fixture.allowed {
				want.exceptions = []string{fixture.file + " -> " + imported}
			} else {
				want.violations = []string{fixture.file + ":3 -> " + imported}
			}
			checkImportBoundaryFixture(t, boundary, map[string]string{fixture.file: importFixtureSource(imported)}, want)
		})
	}
}

func TestImportBoundaryInfraTestFilesExempt(t *testing.T) {
	boundary := importBoundaryFor(t, "infra")
	// includeTests=false：infra 的装配/集成测试用真实 application 类型，只有生产文件受约束。
	relative := "internal/infra/egress/fixture_test.go"
	source := strings.Replace(importFixtureSource(internalModulePrefix+"application/egress"), "package fixture", "package fixture_test", 1)
	checkImportBoundaryFixture(t, boundary, map[string]string{relative: source}, importBoundaryScan{skippedTests: 1})
}

// TestDirectoryCoverageGuardFixtures 自证 BE-G2 的目录覆盖守卫：旧实现（判定只内联在
// TestInternalDirectoryCoverageBoundary 里）无法被夹具调用，此处直接断言纯函数。
// 真实目录级负样本（可复现）：临时新增未登记目录后运行
//
//	New-Item -ItemType Directory internal/zz_probe_layer
//	Set-Content internal/zz_probe_layer/probe.go 'package zz_probe_layer'
//	cd backend; go test ./internal/ports/provider/ -run TestInternalDirectoryCoverageBoundary -count=1
//
// 期望 exit 1 且输出「internal/zz_probe_layer 未被任何规则或覆盖登记覆盖」；删除该目录后恢复 exit 0。
func TestDirectoryCoverageGuardFixtures(t *testing.T) {
	aligned := map[string]internalDirectoryCoverage{"app": {rule: "app 规则"}}
	exempt := map[string]internalDirectoryCoverage{"app": {reason: "装配入口，禁入规则无意义"}}
	cases := []struct {
		name    string
		present map[string]bool
		ruled   map[string]string
		entries map[string]internalDirectoryCoverage
		want    []string
	}{
		{"new_directory_without_rule_or_exemption", map[string]bool{"app": true, "zz_new": true}, map[string]string{"app": "app 规则"}, aligned,
			[]string{"internal/zz_new 未被任何规则或覆盖登记覆盖：请扩展 layerBoundaries 或登记豁免理由"}},
		{"registered_rule_missing_in_boundaries", map[string]bool{"app": true}, nil, aligned,
			[]string{`internal/app 覆盖登记规则 "app 规则"，但 layerBoundaries 无该规则`}},
		{"rule_name_mismatch", map[string]bool{"app": true}, map[string]string{"app": "app 规则"}, map[string]internalDirectoryCoverage{"app": {rule: "旧规则"}},
			[]string{`internal/app 覆盖登记 rule="旧规则"，实际规则="app 规则"`}},
		{"entry_without_rule_and_reason", map[string]bool{"app": true}, nil, map[string]internalDirectoryCoverage{"app": {}},
			[]string{"internal/app 的覆盖登记既不是规则也没有豁免理由"}},
		{"rule_points_to_missing_directory", map[string]bool{"app": true}, map[string]string{"app": "app 规则", "gone": "gone 规则"}, aligned,
			[]string{`规则 "gone 规则" 指向不存在的目录 internal/gone`}},
		{"entry_for_missing_directory", map[string]bool{"app": true}, map[string]string{"app": "app 规则"},
			map[string]internalDirectoryCoverage{"app": {rule: "app 规则"}, "gone": {reason: "已删除目录"}},
			[]string{"覆盖登记 internal/gone 已消失：请删除该登记"}},
		{"exemption_reason_covers_directory", map[string]bool{"app": true}, nil, exempt, nil},
		{"aligned_rule_covers_directory", map[string]bool{"app": true}, map[string]string{"app": "app 规则"}, aligned, nil},
	}
	for _, fixture := range cases {
		t.Run(fixture.name, func(t *testing.T) {
			got := directoryCoverageViolations(fixture.present, fixture.ruled, fixture.entries)
			if !slices.Equal(got, fixture.want) {
				t.Fatalf("违规=%q, 期望=%q", got, fixture.want)
			}
		})
	}
}

func importBoundaryFor(t *testing.T, directory string) layerBoundary {
	t.Helper()
	for _, boundary := range layerBoundaries {
		if boundary.directory == directory {
			return boundary
		}
	}
	t.Fatalf("缺少 %s 的真实分层规则", directory)
	return layerBoundary{}
}

func importFixtureSource(imported string) string {
	return "package fixture\n\nimport " + strconv.Quote(imported) + "\n"
}

func checkImportBoundaryFixture(t *testing.T, boundary layerBoundary, files map[string]string, want importBoundaryScan) {
	t.Helper()
	root := writeImportBoundaryFixture(t, files)
	result, err := forbiddenImports(root, boundary)
	if err != nil {
		t.Fatalf("扫描夹具失败: %v", err)
	}
	if !reflect.DeepEqual(result, want) {
		t.Fatalf("扫描结果=%+v, 期望=%+v", result, want)
	}
	t.Logf("fixture scope: Go 文件=%d, AST imports=%d, 豁免测试=%d, 违规=%v, 存量=%v", result.files, result.imports, result.skippedTests, result.violations, result.exceptions)
}

func writeImportBoundaryFixture(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for relative, source := range files {
		path := filepath.Join(root, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(source), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return root
}
