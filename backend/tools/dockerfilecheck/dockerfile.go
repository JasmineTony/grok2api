// dockerfile.go 解析 Dockerfile 中来自构建上下文的 COPY 指令。
//
// 口径边界：
//   - 只识别 COPY，且忽略带 --from= 的阶段间拷贝（其源路径不是构建上下文）；
//   - 支持 shell 形式（空格分隔的多源 + 目标）；不支持 JSON 数组形式与引号包裹的路径；
//   - 支持以 `\` 续行的指令；`#` 开头的行视为注释（含 # syntax= 指令）；
//   - 源路径按「前缀匹配」覆盖：等于该路径，或位于该路径目录之下。
package main

import (
	"os"
	"strings"
)

// copySource 是一条上下文 COPY 的源路径（仓库根相对，'/' 分隔）与所在行号。
type copySource struct {
	path string
	line int
}

// logicalLine 是一条逻辑指令（已合并续行）与其起始行号。
type logicalLine struct {
	number int
	text   string
}

// contextCopySources 返回 Dockerfile 中全部上下文 COPY 源，以及被跳过的阶段拷贝条数。
func contextCopySources(path string) ([]copySource, int, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, 0, err
	}
	sources := make([]copySource, 0, 16)
	stageCopies := 0
	for _, line := range splitLogicalLines(string(raw)) {
		instruction, ok := parseCopyInstruction(line)
		if !ok {
			continue
		}
		if instruction.fromStage {
			stageCopies++
			continue
		}
		sources = append(sources, instruction.sources...)
	}
	return sources, stageCopies, nil
}

// splitLogicalLines 把 Dockerfile 拆成逻辑指令，跳过注释与空行，并合并 `\` 续行。
func splitLogicalLines(content string) []logicalLine {
	lines := make([]logicalLine, 0, 64)
	pending := ""
	startLine := 0
	for index, raw := range strings.Split(content, "\n") {
		text := strings.TrimSpace(strings.TrimRight(raw, "\r"))
		if pending == "" {
			if text == "" || strings.HasPrefix(text, "#") {
				continue
			}
			startLine = index + 1
		}
		if strings.HasSuffix(text, "\\") {
			pending += strings.TrimSuffix(text, "\\") + " "
			continue
		}
		pending += text
		lines = append(lines, logicalLine{number: startLine, text: pending})
		pending = ""
	}
	if pending != "" {
		lines = append(lines, logicalLine{number: startLine, text: pending})
	}
	return lines
}

// copyInstruction 是一条 COPY 指令的解析结果。
type copyInstruction struct {
	sources   []copySource
	fromStage bool
}

// parseCopyInstruction 解析 COPY 指令；第二个返回值表示该指令是否为 COPY。
func parseCopyInstruction(line logicalLine) (copyInstruction, bool) {
	fields := strings.Fields(line.text)
	if len(fields) < 2 || !strings.EqualFold(fields[0], "COPY") {
		return copyInstruction{}, false
	}
	rest := fields[1:]
	instruction := copyInstruction{}
	for len(rest) > 0 && strings.HasPrefix(rest[0], "--") {
		if strings.HasPrefix(rest[0], "--from=") {
			instruction.fromStage = true
		}
		rest = rest[1:]
	}
	if instruction.fromStage || len(rest) < 2 {
		return instruction, true
	}
	for _, source := range rest[:len(rest)-1] {
		instruction.sources = append(instruction.sources, copySource{path: cleanContextPath(source), line: line.number})
	}
	return instruction, true
}

// cleanContextPath 归一化 COPY 源路径：去掉前导 "./" 与前导/尾随 "/"。
func cleanContextPath(path string) string {
	for strings.HasPrefix(path, "./") {
		path = path[2:]
	}
	return strings.Trim(strings.TrimPrefix(path, "/"), "/")
}
