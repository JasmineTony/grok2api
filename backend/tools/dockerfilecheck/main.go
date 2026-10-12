// dockerfilecheck 校验容器构建输入是否完整：CI 只能靠真实镜像构建发现的缺陷，这里静态拦截。
//
// 动机：Dockerfile 曾只 COPY frontend/scripts/build-inputs.ts，而 frontend/vite.config.ts 直接
// import 了同目录新抽出的 build-manifest-plugin.ts，容器内 `pnpm build` 报
// TS2307 并 exit 2；本机无 Docker，只有 CI 能抓到。本工具用静态文本解析替代真实构建。
//
// 三条不变量（违反即非零退出，并打印 文件:行 定位锚点）：
//  1. 必需文件必须被某个构建上下文 COPY 覆盖（源路径前缀匹配）；
//  2. 必需文件不得被 .dockerignore 的 last-match-wins 求值排除；
//  3. 每个上下文 COPY 的源路径必须存在；目录源在忽略规则下必须有可用内容。
//
// 口径边界见 --help。退出码：0 通过、1 违反不变量、2 参数或文件读取错误。
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
)

const (
	defaultRoot     = ".."
	exitOK          = 0
	exitFailure     = 1
	exitConfig      = 2
	dockerfileName  = "Dockerfile"
	ignoreFileName  = ".dockerignore"
	finalStageLabel = "镜像最终阶段"
)

const usageText = `dockerfilecheck 校验容器构建输入完整性（静态解析，不需要 Docker、不执行构建）。

判定（违反任一即退出码 1，输出「文件:行：说明」）：
  1. 必需文件未被任何上下文 COPY 覆盖；
  2. 必需文件被 .dockerignore 排除；
  3. COPY 源路径不存在，或 COPY 的目录在忽略规则下没有任何可用内容。

必需文件集合（闭包口径）：
  frontend：起点 frontend/vite.config.ts 与 frontend/vitest.config.ts；
    沿 ./ 或 ../ 的静态 import / export ... from / 动态 import() 传递闭包；
    展开 frontend/tsconfig.json 的 extends 与 references，再展开子工程的 files/include（仅
    .ts/.tsx/.mts/.cts/.d.ts/.js/.jsx/.mjs/.cjs/.json，尊重 exclude）；
    外加非源码输入 frontend/package.json、pnpm-lock.yaml、pnpm-workspace.yaml、index.html、
    tsconfig.json、tsconfig.app.json、tsconfig.node.json。
  backend：backend/go.mod、backend/go.sum、backend/docs/docs.go，以及 backend/cmd 与
    backend/internal 下的全部生产 .go；再沿 go.mod 模块路径（github.com/chenyme/grok2api/backend/）
    的自引用 import 扩展目录闭包。
  镜像最终阶段：VERSION 与 docker/entrypoint.sh（文件存在时才要求，避免最小夹具被迫造全量文件）。

口径边界（有意简化，避免误报）：
  - 只做静态文本解析：不解析别名（@/）、包名 import、import.meta.glob 模式串、TS 路径映射；
  - 不模拟 Docker 多阶段作用域：任何不带 --from= 的 COPY 都算「已覆盖」，不校验它在哪个 stage；
  - COPY 源按前缀匹配（源为文件时等价精确匹配）；不支持 JSON 数组形式与引号包裹的路径；
  - .dockerignore 语义：** 跨目录，* 与 ? 不跨目录；不支持字符类、大括号展开与反斜杠转义；
    父目录被排除后子项不能靠祖先白名单复活（与 gitignore 一致，属保守方向），
    要放行目录内容必须直接匹配，例如 !frontend/scripts/**；
  - 测试文件（*.test.ts/tsx、*.spec.ts/tsx、*_test.go）不参与闭包扩展，也不要求被 COPY 覆盖
    （容器构建不需要它们），因此它们被 .dockerignore 排除是合法的；
  - 相对 import 无法解析为仓库内文件时按失败处理（TS2307 同类缺陷）；无法解析的候选路径
    统一按仓库根相对处理，逃出仓库根即判失败。

参数：`

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// options 是命令行参数。
type options struct {
	root string
}

func parseOptions(args []string, stderr io.Writer) (options, error) {
	flags := flag.NewFlagSet("dockerfilecheck", flag.ContinueOnError)
	flags.SetOutput(stderr)
	flags.Usage = func() {
		fmt.Fprintln(stderr, usageText)
		flags.PrintDefaults()
	}
	var opts options
	flags.StringVar(&opts.root, "root", defaultRoot, "仓库根目录（含 Dockerfile 与 .dockerignore）；从 backend/ 运行时默认 ..")
	if err := flags.Parse(args); err != nil {
		return options{}, err
	}
	return opts, nil
}

// run 是 main 的可测试实现：返回退出码，全部输出写入传入的 writer。
func run(args []string, stdout, stderr io.Writer) int {
	opts, err := parseOptions(args, stderr)
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return exitOK
		}
		fmt.Fprintf(stderr, "参数错误：%v\n", err)
		return exitConfig
	}
	result, err := analyze(opts.root)
	if err != nil {
		fmt.Fprintf(stderr, "分析失败：%v\n", err)
		fmt.Fprintf(stderr, "提示：--root 必须指向包含 %s 与 %s 的仓库根（从 backend/ 运行时默认 %s）。\n",
			dockerfileName, ignoreFileName, defaultRoot)
		return exitConfig
	}
	printReport(stdout, result)
	if len(result.findings) > 0 {
		return exitFailure
	}
	return exitOK
}

// requiredFile 是必须进入构建上下文的单个文件；origin 是要求它存在的依据位置（file:line）。
type requiredFile struct {
	path   string
	origin string
	reason string
}

// finding 是一条违反不变量的记录：anchor 是 file:line 形式的定位锚点。
type finding struct {
	anchor  string
	message string
}

// closureResult 是一次闭包分析的结果。
type closureResult struct {
	label      string
	required   []requiredFile
	unresolved []finding
	exempt     int
}

// checkStats 汇总检查计数，用于自证「参与判定的文件数」，避免漏报式通过。
type checkStats struct {
	checked       int
	notCovered    int
	ignored       int
	badCopySource int
	emptyCopyDir  int
	unresolved    int
}

// analysis 是一次完整分析的输入与结果。
type analysis struct {
	root        string
	copySources []copySource
	stageCopies int
	rules       []ignoreRule
	groups      []closureResult
	stats       checkStats
	findings    []finding
}

// analyze 读取仓库输入并完成全部判定。
func analyze(rootOption string) (analysis, error) {
	root, err := filepath.Abs(rootOption)
	if err != nil {
		return analysis{}, err
	}
	sources, stageCopies, err := contextCopySources(filepath.Join(root, dockerfileName))
	if err != nil {
		return analysis{}, fmt.Errorf("读取 %s 失败：%w", dockerfileName, err)
	}
	rules, err := loadIgnoreRules(filepath.Join(root, ignoreFileName))
	if err != nil {
		return analysis{}, fmt.Errorf("读取 %s 失败：%w", ignoreFileName, err)
	}
	result := analysis{root: root, copySources: sources, stageCopies: stageCopies, rules: rules}
	frontend, err := collectFrontendRequired(root)
	if err != nil {
		return analysis{}, err
	}
	backend, err := collectBackendRequired(root)
	if err != nil {
		return analysis{}, err
	}
	stage, err := collectStageFixedInputs(root)
	if err != nil {
		return analysis{}, err
	}
	result.groups = []closureResult{frontend, backend, stage}
	result.check()
	return result, nil
}

// check 汇总三条不变量的判定结果，写入 findings 与 stats。
func (a *analysis) check() {
	for _, group := range a.groups {
		a.stats.unresolved += len(group.unresolved)
		a.findings = append(a.findings, group.unresolved...)
		for _, item := range group.required {
			a.checkRequired(item, group.label)
		}
	}
	a.checkCopySources()
	sort.Slice(a.findings, func(i, j int) bool {
		if a.findings[i].anchor != a.findings[j].anchor {
			return a.findings[i].anchor < a.findings[j].anchor
		}
		return a.findings[i].message < a.findings[j].message
	})
}

// checkRequired 校验单个必需文件的 COPY 覆盖与忽略规则。
func (a *analysis) checkRequired(item requiredFile, label string) {
	a.stats.checked++
	if !coveredBy(a.copySources, item.path) {
		a.stats.notCovered++
		a.findings = append(a.findings, finding{
			anchor:  item.origin,
			message: fmt.Sprintf("%s：%s 未被任何上下文 COPY 覆盖（%s）", label, item.path, item.reason),
		})
	}
	ignored, rule := isIgnored(a.rules, item.path)
	if ignored {
		a.stats.ignored++
		a.findings = append(a.findings, finding{
			anchor:  fmt.Sprintf("%s:%d", ignoreFileName, rule.line),
			message: fmt.Sprintf("%s：规则 %s 排除了必需文件 %s（%s）", label, rule.raw, item.path, item.reason),
		})
	}
}

// checkCopySources 校验每条上下文 COPY 的源路径存在且（目录源）至少有一个可用文件。
func (a *analysis) checkCopySources() {
	for _, source := range a.copySources {
		info, err := os.Stat(filepath.Join(a.root, filepath.FromSlash(source.path)))
		if err != nil {
			a.stats.badCopySource++
			a.findings = append(a.findings, finding{
				anchor:  fmt.Sprintf("%s:%d", dockerfileName, source.line),
				message: fmt.Sprintf("COPY 源路径在仓库中不存在：%s", source.path),
			})
			continue
		}
		if !info.IsDir() || a.directoryHasContent(source.path) {
			continue
		}
		a.stats.emptyCopyDir++
		a.findings = append(a.findings, finding{
			anchor:  fmt.Sprintf("%s:%d", dockerfileName, source.line),
			message: fmt.Sprintf("COPY 的目录 %s 在 %s 下没有任何可用内容（白名单可能缺失）", source.path, ignoreFileName),
		})
	}
}

// directoryHasContent 判断目录在忽略规则下是否至少有一个文件会进入构建上下文。
func (a *analysis) directoryHasContent(dir string) bool {
	found := false
	walkRoot := filepath.Join(a.root, filepath.FromSlash(dir))
	_ = filepath.WalkDir(walkRoot, func(current string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		rel, relErr := filepath.Rel(a.root, current)
		if relErr != nil {
			return nil
		}
		if ignored, _ := isIgnored(a.rules, filepath.ToSlash(rel)); ignored {
			return nil
		}
		found = true
		return filepath.SkipAll
	})
	return found
}

// printReport 输出口径摘要、计数与全部 finding。
func printReport(w io.Writer, a analysis) {
	fmt.Fprintln(w, "dockerfilecheck：容器构建输入完整性门禁（静态解析，无需 Docker）")
	fmt.Fprintf(w, "仓库根：%s\n", a.root)
	fmt.Fprintf(w, "%s：上下文 COPY 源 %d 条（忽略 --from 阶段拷贝 %d 条）\n", dockerfileName, len(a.copySources), a.stageCopies)
	fmt.Fprintf(w, "%s：规则 %d 条\n", ignoreFileName, len(a.rules))
	for _, group := range a.groups {
		fmt.Fprintf(w, "%s：必需文件 %d 个，豁免测试文件 %d 个，未解析相对 import %d 个\n",
			group.label, len(group.required), group.exempt, len(group.unresolved))
	}
	fmt.Fprintf(w, "参与判定：必需文件 %d 个（未被 COPY 覆盖 %d，被忽略规则排除 %d）；COPY 源不可用 %d（不存在 %d / 目录无内容 %d）\n",
		a.stats.checked, a.stats.notCovered, a.stats.ignored,
		a.stats.badCopySource+a.stats.emptyCopyDir, a.stats.badCopySource, a.stats.emptyCopyDir)
	fmt.Fprintln(w, "口径边界与简化假设见 dockerfilecheck --help")
	if len(a.findings) == 0 {
		fmt.Fprintln(w, "通过：全部必需输入都能进入构建上下文")
		return
	}
	fmt.Fprintf(w, "失败：%d 项\n", len(a.findings))
	for _, item := range a.findings {
		fmt.Fprintf(w, "  %s：%s\n", item.anchor, item.message)
	}
}

// coveredBy 判断路径是否被某条 COPY 源覆盖（等于源路径，或位于源路径目录下）。
func coveredBy(sources []copySource, path string) bool {
	for _, source := range sources {
		if path == source.path || hasPathPrefix(path, source.path) {
			return true
		}
	}
	return false
}

// hasPathPrefix 判断路径是否位于目录前缀之下。
func hasPathPrefix(path, dir string) bool {
	return dir != "" && len(path) > len(dir)+1 && path[:len(dir)] == dir && path[len(dir)] == '/'
}

// fileExists 判断路径存在且是普通文件。
func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// sortRequired 让输出稳定：必需文件按路径、未解析引用按锚点排序。
func sortRequired(result *closureResult) {
	sort.Slice(result.required, func(i, j int) bool { return result.required[i].path < result.required[j].path })
	sort.Slice(result.unresolved, func(i, j int) bool { return result.unresolved[i].anchor < result.unresolved[j].anchor })
}
