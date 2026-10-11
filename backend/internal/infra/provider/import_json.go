package provider

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	ports "github.com/chenyme/grok2api/backend/internal/ports/provider"
)

var utf8BOM = []byte{0xef, 0xbb, 0xbf}

// DecodeCredentialJSONEntries accepts a regular credential document, a
// top-level JSON array of credential objects, or a sequence of JSON objects,
// including one object per line.
func DecodeCredentialJSONEntries[T any](data []byte, expectedProvider string, limit int) ([]T, error) {
	data = bytes.TrimPrefix(data, utf8BOM)
	decoder := json.NewDecoder(bytes.NewReader(data))
	entries := make([]T, 0)
	for {
		start := nextJSONValueOffset(data, decoder.InputOffset())
		var raw json.RawMessage
		if err := decoder.Decode(&raw); err != nil {
			if errors.Is(err, io.EOF) {
				return entries, nil
			}
			return nil, fmt.Errorf("第 %d 行的账号 JSON 格式无效", jsonErrorLine(data, start, err))
		}
		line := lineAtJSONOffset(data, start)
		handled, err := appendCredentialJSONArray(&entries, raw, line, limit)
		if err != nil {
			return nil, err
		}
		if handled {
			continue
		}
		if err := appendCredentialJSONObject(&entries, raw, line, expectedProvider, limit); err != nil {
			return nil, err
		}
	}
}

// appendCredentialJSONArray 处理顶层裸数组形态：外部批量导出工具产出的常见形态。
// 行号以数组起始行为准；元素错误额外给出序号定位。返回 false 表示该值不是数组。
func appendCredentialJSONArray[T any](entries *[]T, raw json.RawMessage, line, limit int) (bool, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '[' {
		return false, nil
	}
	var elements []json.RawMessage
	if err := json.Unmarshal(raw, &elements); err != nil {
		return true, fmt.Errorf("第 %d 行的账号数组 JSON 格式无效", line)
	}
	// 超限先于逐元素解析拦截，数组中混有非法元素时同样优先报告限额。
	if limit > 0 && len(elements) > limit-len(*entries) {
		return true, fmt.Errorf("%w: 单次最多导入 %d 个账号", ports.ErrCredentialLimit, limit)
	}
	for index, element := range elements {
		// 结构预检：仅兼容对象与 null（null 归一为零值，交后续 normalize 报出带序号的明确错误）。
		if e := bytes.TrimSpace(element); len(e) == 0 || (e[0] != '{' && !bytes.Equal(e, []byte("null"))) {
			return true, fmt.Errorf("第 %d 行账号数组的第 %d 个元素必须是 JSON 对象", line, index+1)
		}
		var value T
		if err := json.Unmarshal(element, &value); err != nil {
			return true, fmt.Errorf("第 %d 行账号数组的第 %d 个元素内容无效", line, index+1)
		}
		*entries = append(*entries, value)
	}
	return true, nil
}

// appendCredentialJSONObject 处理单个 JSON 对象，兼容 accounts 批量字段与单账号对象。
func appendCredentialJSONObject[T any](entries *[]T, raw json.RawMessage, line int, expectedProvider string, limit int) error {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil || object == nil {
		return fmt.Errorf("第 %d 行必须是 JSON 对象", line)
	}
	if err := validateCredentialJSONProvider(object, line, expectedProvider); err != nil {
		return err
	}
	if rawAccounts, batch := object["accounts"]; batch {
		var values []T
		if err := json.Unmarshal(rawAccounts, &values); err != nil {
			return fmt.Errorf("第 %d 行的 accounts 必须是 JSON 对象数组", line)
		}
		return appendCredentialJSONEntries(entries, values, limit)
	}
	var value T
	if err := json.Unmarshal(raw, &value); err != nil {
		return fmt.Errorf("第 %d 行的账号 JSON 格式无效", line)
	}
	return appendCredentialJSONEntries(entries, []T{value}, limit)
}

// validateCredentialJSONProvider 校验对象内可选的 provider 字段与目标 Provider 一致。
func validateCredentialJSONProvider(object map[string]json.RawMessage, line int, expectedProvider string) error {
	rawProvider, exists := object["provider"]
	if !exists {
		return nil
	}
	var providerName string
	if err := json.Unmarshal(rawProvider, &providerName); err != nil {
		return fmt.Errorf("第 %d 行的 provider 必须是字符串", line)
	}
	providerName = strings.TrimSpace(providerName)
	if providerName != "" && providerName != expectedProvider {
		return fmt.Errorf("第 %d 行的 Provider 必须是 %s", line, expectedProvider)
	}
	return nil
}

func appendCredentialJSONEntries[T any](target *[]T, values []T, limit int) error {
	if limit > 0 && len(values) > limit-len(*target) {
		return fmt.Errorf("%w: 单次最多导入 %d 个账号", ports.ErrCredentialLimit, limit)
	}
	*target = append(*target, values...)
	return nil
}

func nextJSONValueOffset(data []byte, offset int64) int64 {
	for offset < int64(len(data)) {
		switch data[offset] {
		case ' ', '\t', '\r', '\n':
			offset++
		default:
			return offset
		}
	}
	return offset
}

func jsonErrorLine(data []byte, fallback int64, err error) int {
	var syntaxError *json.SyntaxError
	if errors.As(err, &syntaxError) && syntaxError.Offset > 0 {
		return lineAtJSONOffset(data, syntaxError.Offset-1)
	}
	return lineAtJSONOffset(data, fallback)
}

func lineAtJSONOffset(data []byte, offset int64) int {
	if offset < 0 {
		offset = 0
	}
	if offset > int64(len(data)) {
		offset = int64(len(data))
	}
	return 1 + bytes.Count(data[:offset], []byte{'\n'})
}
