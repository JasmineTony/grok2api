package cli

import (
	"encoding/json"
	"fmt"
	"strings"
)

func (c *responsesToolCompatibility) normalizeFunctionCallOutputInput(item map[string]any, param string) (map[string]any, error) {
	return c.normalizeFunctionLikeCallOutputInput(item, param, true)
}

func (c *responsesToolCompatibility) normalizeCustomToolCallOutputInput(item map[string]any, param string) (map[string]any, error) {
	return c.normalizeFunctionLikeCallOutputInput(item, param, false)
}

func (c *responsesToolCompatibility) normalizeFunctionLikeCallOutputInput(item map[string]any, param string, allowContentBlocks bool) (map[string]any, error) {
	callID := strings.TrimSpace(stringField(item, "call_id"))
	if callID == "" {
		return nil, &responsesRequestError{Message: param + ".call_id 不能为空", Param: param + ".call_id", Code: "invalid_parameter"}
	}
	output := item["output"]
	var err error
	if blocks, ok := output.([]any); ok && allowContentBlocks && isFunctionCallOutputContentArray(blocks) {
		output, err = c.normalizeFunctionCallOutputBlocks(blocks, param+".output")
	} else {
		output, err = encodeToolOutput(output, param+".output")
	}
	if err != nil {
		return nil, err
	}
	// 按官方 Build 回放结构重建，不携带输出态 id/status。
	return map[string]any{"type": "function_call_output", "call_id": callID, "output": output}, nil
}

// isFunctionCallOutputContentArray 区分 Responses 内容数组与普通结构化 JSON 数组。
// 只要出现一个 input_* 内容块，整个数组就按内容数组严格校验，避免混合数组
// 中的图片被静默字符串化；普通对象/标量/空数组仍沿用 JSON 字符串契约。
func isFunctionCallOutputContentArray(blocks []any) bool {
	for _, raw := range blocks {
		block, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		blockType := strings.TrimSpace(stringField(block, "type"))
		if strings.HasPrefix(blockType, "input_") {
			return true
		}
	}
	return false
}

func (c *responsesToolCompatibility) normalizeFunctionCallOutputBlocks(blocks []any, param string) ([]any, error) {
	normalized := make([]any, 0, len(blocks))
	for index, raw := range blocks {
		blockParam := fmt.Sprintf("%s[%d]", param, index)
		block, ok := raw.(map[string]any)
		if !ok {
			return nil, &responsesRequestError{Message: blockParam + " 必须是对象", Param: blockParam, Code: "invalid_parameter"}
		}
		blockType := strings.TrimSpace(stringField(block, "type"))
		if blockType == "" {
			return nil, &responsesRequestError{Message: blockParam + ".type 不能为空", Param: blockParam + ".type", Code: "invalid_parameter"}
		}
		switch blockType {
		case "input_text":
			text, ok := block["text"].(string)
			if !ok {
				return nil, &responsesRequestError{Message: blockParam + ".text 必须是字符串", Param: blockParam + ".text", Code: "invalid_parameter"}
			}
			normalized = append(normalized, map[string]any{"type": "input_text", "text": text})
		case "input_image":
			converted, err := c.normalizeFunctionCallOutputImageBlock(block, blockParam)
			if err != nil {
				return nil, err
			}
			normalized = append(normalized, converted)
		case "input_file":
			converted, err := normalizeFunctionCallOutputFileBlock(block, blockParam)
			if err != nil {
				return nil, err
			}
			normalized = append(normalized, converted)
		default:
			return nil, &responsesRequestError{Message: "Grok Build 不支持该 function_call_output.output 类型", Param: blockParam + ".type", Code: "unsupported_parameter"}
		}
	}
	return normalized, nil
}

func (c *responsesToolCompatibility) normalizeFunctionCallOutputImageBlock(block map[string]any, param string) (map[string]any, error) {
	_, hasImageURL, err := nonEmptyContentBlockString(block, "image_url", param)
	if err != nil {
		return nil, err
	}
	_, hasFileID, err := nonEmptyContentBlockString(block, "file_id", param)
	if err != nil {
		return nil, err
	}
	if !hasImageURL && !hasFileID {
		return nil, &responsesRequestError{Message: param + ".image_url 或 .file_id 至少需要一个", Param: param + ".image_url", Code: "invalid_parameter"}
	}
	return c.normalizeInputImagePart(block, param)
}

func normalizeFunctionCallOutputFileBlock(block map[string]any, param string) (map[string]any, error) {
	hasSource := false
	for _, key := range []string{"file_data", "file_id", "file_url", "filename"} {
		_, exists, err := nonEmptyContentBlockString(block, key, param)
		if err != nil {
			return nil, err
		}
		if key != "filename" && exists {
			hasSource = true
		}
	}
	if !hasSource {
		return nil, &responsesRequestError{Message: param + " 至少需要 file_data、file_id 或 file_url 之一", Param: param + ".file_data", Code: "invalid_parameter"}
	}
	return normalizeInputFilePart(block), nil
}

func nonEmptyContentBlockString(block map[string]any, key, param string) (string, bool, error) {
	raw, exists := block[key]
	if !exists || raw == nil {
		return "", false, nil
	}
	value, ok := raw.(string)
	if !ok || strings.TrimSpace(value) == "" {
		return "", false, &responsesRequestError{Message: param + "." + key + " 必须是非空字符串", Param: param + "." + key, Code: "invalid_parameter"}
	}
	return value, true, nil
}

func encodeToolOutput(value any, param string) (string, error) {
	switch typed := value.(type) {
	case nil:
		return "", nil
	case string:
		return typed, nil
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return "", &responsesRequestError{Message: param + " 无法编码", Param: param, Code: "invalid_parameter"}
		}
		return string(encoded), nil
	}
}
