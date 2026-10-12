// dockerignore.go 实现 .dockerignore 的静态求值。
//
// 口径边界（有意简化，属保守方向）：
//   - 支持 **（跨目录）、* 与 ?（不跨目录）；不支持字符类、大括号展开、\ 转义，不支持注释外语法；
//   - 尾随 "/" 的目录标记按普通模式处理，目录匹配依赖「祖先路径参与判定」；
//   - 某一祖先目录被排除后，子项不能靠祖先白名单复活（与 gitignore 一致；要放行目录内容
//     必须直接匹配，例如 !frontend/scripts/**）；
//   - 同一路径上多条命中时 last-match-wins；未命中任何规则即进入构建上下文。
package main

import (
	"os"
	"regexp"
	"strings"
)

// ignoreRule 是一条已编译的 .dockerignore 规则。
type ignoreRule struct {
	line    int
	raw     string
	pattern string
	negated bool
	regex   *regexp.Regexp
}

// loadIgnoreRules 读取并编译 .dockerignore，保持文件顺序（顺序即优先级）。
func loadIgnoreRules(path string) ([]ignoreRule, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	rules := make([]ignoreRule, 0, 32)
	for index, rawLine := range strings.Split(string(content), "\n") {
		text := strings.TrimSpace(strings.TrimRight(rawLine, "\r"))
		if text == "" || strings.HasPrefix(text, "#") {
			continue
		}
		rule := ignoreRule{line: index + 1, raw: text}
		pattern := text
		if strings.HasPrefix(pattern, "!") {
			rule.negated = true
			pattern = pattern[1:]
		}
		rule.pattern = normalizeIgnorePattern(pattern)
		if rule.pattern == "" {
			continue
		}
		expr, err := compileIgnorePattern(rule.pattern)
		if err != nil {
			return nil, err
		}
		rule.regex = expr
		rules = append(rules, rule)
	}
	return rules, nil
}

// normalizeIgnorePattern 归一化模式：去掉前导 "./"、前导/尾随 "/"。
func normalizeIgnorePattern(pattern string) string {
	cleaned := strings.TrimSpace(pattern)
	for strings.HasPrefix(cleaned, "./") {
		cleaned = cleaned[2:]
	}
	cleaned = strings.TrimPrefix(cleaned, "/")
	return strings.TrimSuffix(cleaned, "/")
}

// compileIgnorePattern 把 dockerignore 通配符编译为正则：`**` 跨目录，`*` 与 `?` 不跨目录。
func compileIgnorePattern(pattern string) (*regexp.Regexp, error) {
	var builder strings.Builder
	builder.WriteString("^")
	for index := 0; index < len(pattern); {
		consumed, chunk := consumePatternToken(pattern, index)
		builder.WriteString(chunk)
		index += consumed
	}
	builder.WriteString("$")
	return regexp.Compile(builder.String())
}

// consumePatternToken 返回从 index 起的正则片段与消耗的字节数。
func consumePatternToken(pattern string, index int) (int, string) {
	if pattern[index] == '*' {
		if index+1 < len(pattern) && pattern[index+1] == '*' {
			if index+2 < len(pattern) && pattern[index+2] == '/' {
				return 3, "(?:.*/)?"
			}
			return 2, ".*"
		}
		return 1, "[^/]*"
	}
	if pattern[index] == '?' {
		return 1, "[^/]"
	}
	return 1, regexp.QuoteMeta(string(pattern[index]))
}

// directMatch 返回与路径本身直接匹配的最后一条规则；没有则为 nil。
func directMatch(rules []ignoreRule, path string) *ignoreRule {
	var matched *ignoreRule
	for index := range rules {
		if rules[index].regex.MatchString(path) {
			matched = &rules[index]
		}
	}
	return matched
}

// isIgnored 判断仓库根相对路径是否被排除，并返回导致排除的规则。
func isIgnored(rules []ignoreRule, path string) (bool, *ignoreRule) {
	for _, ancestor := range ancestorsOf(path) {
		matched := directMatch(rules, ancestor)
		if matched != nil && !matched.negated {
			return true, matched
		}
	}
	matched := directMatch(rules, path)
	if matched == nil {
		return false, nil
	}
	return !matched.negated, matched
}

// ancestorsOf 返回路径的全部祖先目录（不含自身），从最浅层开始。
func ancestorsOf(path string) []string {
	parts := strings.Split(path, "/")
	if len(parts) < 2 {
		return nil
	}
	ancestors := make([]string, 0, len(parts)-1)
	for index := 1; index < len(parts); index++ {
		ancestors = append(ancestors, strings.Join(parts[:index], "/"))
	}
	return ancestors
}
