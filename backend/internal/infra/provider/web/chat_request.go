package web

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/infra/provider/conversation"
)

// buildRequestMessages 把 chat/responses 两种入参形态统一成消息列表。
func buildRequestMessages(input openAIRequest, operation string) ([]chatMessage, error) {
	if operation == "chat" {
		return input.Messages, nil
	}
	var messages []chatMessage
	if strings.TrimSpace(input.Instructions) != "" {
		content, _ := json.Marshal(input.Instructions)
		messages = append(messages, chatMessage{Role: "system", Content: content})
	}
	trimmed := bytes.TrimSpace(input.Input)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return nil, errors.New("input 不能为空")
	}
	if trimmed[0] == '"' {
		var text string
		if json.Unmarshal(trimmed, &text) != nil {
			return nil, errors.New("input 格式无效")
		}
		content, _ := json.Marshal(text)
		return append(messages, chatMessage{Role: "user", Content: content}), nil
	}
	if err := json.Unmarshal(trimmed, &messages); err != nil {
		return nil, errors.New("input 必须是字符串或消息数组")
	}
	return messages, nil
}

func normalizeOpenAIInput(input openAIRequest, operation string) (normalizedChatInput, error) {
	messages, err := buildRequestMessages(input, operation)
	if err != nil {
		return normalizedChatInput{}, err
	}
	if len(messages) == 0 {
		return normalizedChatInput{}, errors.New("messages 不能为空")
	}
	value, attachments, err := renderRequestMessages(messages)
	if err != nil {
		return normalizedChatInput{}, err
	}
	if value == "" && len(attachments) == 0 {
		return normalizedChatInput{}, errors.New("消息中没有可发送的文本或附件")
	}
	if len(attachments) > maxChatAttachments {
		return normalizedChatInput{}, fmt.Errorf("单次对话最多支持 %d 个附件", maxChatAttachments)
	}
	return normalizedChatInput{Prompt: value, Attachments: attachments}, nil
}

// writeGatewayFunctionCall 把 OpenAI function_call 消息渲染为上游 function_call 块。
func writeGatewayFunctionCall(builder *strings.Builder, message chatMessage) error {
	if !toolNamePattern.MatchString(strings.TrimSpace(message.Name)) {
		return errors.New("function_call.name 无效")
	}
	arguments := normalizeToolArguments(message.Arguments)
	if !json.Valid([]byte(arguments)) {
		return errors.New("function_call.arguments 必须是有效 JSON")
	}
	builder.WriteString("[assistant]\n<tool_calls>\n  <tool_call>\n    <tool_name>")
	builder.WriteString(message.Name)
	builder.WriteString("</tool_name>\n    <parameters>")
	builder.WriteString(arguments)
	builder.WriteString("</parameters>\n  </tool_call>\n</tool_calls>\n\n")
	return nil
}

// writeGatewayFunctionCallOutput 把 function_call_output 消息渲染为上游工具结果块。
func writeGatewayFunctionCallOutput(builder *strings.Builder, message chatMessage) error {
	text, err := rawTextValue(message.Output)
	if err != nil {
		return errors.New("function_call_output.output 必须是字符串或 JSON")
	}
	builder.WriteString("[tool result for ")
	builder.WriteString(strings.TrimSpace(message.CallID))
	builder.WriteString("]\n")
	builder.WriteString(text)
	builder.WriteString("\n\n")
	return nil
}

// renderRequestMessages 按消息类型渲染上游提示词，并收集附件。
func renderRequestMessages(messages []chatMessage) (string, []chatAttachmentInput, error) {
	var builder strings.Builder
	attachments := make([]chatAttachmentInput, 0, 2)
	for _, message := range messages {
		typeName := strings.ToLower(strings.TrimSpace(message.Type))
		if typeName == "function_call" {
			if err := writeGatewayFunctionCall(&builder, message); err != nil {
				return "", nil, err
			}
			continue
		}
		if typeName == "function_call_output" {
			if err := writeGatewayFunctionCallOutput(&builder, message); err != nil {
				return "", nil, err
			}
			continue
		}
		text, messageAttachments, err := contentTextAndAttachments(message.Content)
		if err != nil {
			return "", nil, err
		}
		attachments = append(attachments, messageAttachments...)
		if len(message.ToolCalls) > 0 {
			xml := toolCallsToXML(message.ToolCalls)
			if text != "" && xml != "" {
				text += "\n" + xml
			} else if xml != "" {
				text = xml
			}
		}
		if message.ToolCallID != "" {
			text = "Tool result (" + message.ToolCallID + "): " + text
		}
		if strings.TrimSpace(text) == "" {
			continue
		}
		builder.WriteString("[")
		builder.WriteString(strings.ToLower(strings.TrimSpace(message.Role)))
		builder.WriteString("]\n")
		builder.WriteString(text)
		builder.WriteString("\n\n")
	}
	return strings.TrimSpace(builder.String()), attachments, nil
}

// Image generation is stateless: only the latest user turn is a prompt. In
// particular, assistant images from an OpenAI-compatible client's history must
// not be reinterpreted as image-edit inputs on the next generation request.
func normalizeLatestImageInput(input openAIRequest, operation string) (normalizedChatInput, error) {
	if operation == conversation.OperationChat {
		for index := len(input.Messages) - 1; index >= 0; index-- {
			message := input.Messages[index]
			if !strings.EqualFold(strings.TrimSpace(message.Role), "user") {
				continue
			}
			return normalizeImageMessage(message.Content)
		}
		return normalizedChatInput{}, errors.New("messages 中缺少用户消息")
	}

	trimmed := bytes.TrimSpace(input.Input)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return normalizedChatInput{}, errors.New("input 不能为空")
	}
	if trimmed[0] == '"' {
		var prompt string
		if json.Unmarshal(trimmed, &prompt) != nil {
			return normalizedChatInput{}, errors.New("input 格式无效")
		}
		prompt = strings.TrimSpace(prompt)
		if prompt == "" {
			return normalizedChatInput{}, errors.New("图片生成提示词不能为空")
		}
		return normalizedChatInput{Prompt: prompt}, nil
	}

	var messages []chatMessage
	if json.Unmarshal(trimmed, &messages) != nil {
		return normalizedChatInput{}, errors.New("input 必须是字符串或消息数组")
	}
	for index := len(messages) - 1; index >= 0; index-- {
		message := messages[index]
		typeName := strings.ToLower(strings.TrimSpace(message.Type))
		if (typeName == "" || typeName == "message") && strings.EqualFold(strings.TrimSpace(message.Role), "user") {
			return normalizeImageMessage(message.Content)
		}
	}
	return normalizedChatInput{}, errors.New("input 中缺少用户消息")
}

func normalizeImageMessage(content json.RawMessage) (normalizedChatInput, error) {
	prompt, attachments, err := contentTextAndAttachments(content)
	if err != nil {
		return normalizedChatInput{}, err
	}
	prompt = strings.TrimSpace(prompt)
	if prompt == "" && len(attachments) == 0 {
		return normalizedChatInput{}, errors.New("图片生成提示词不能为空")
	}
	return normalizedChatInput{Prompt: prompt, Attachments: attachments}, nil
}

func rawTextValue(raw json.RawMessage) (string, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return "", nil
	}
	var text string
	if json.Unmarshal(trimmed, &text) == nil {
		return text, nil
	}
	if !json.Valid(trimmed) {
		return "", errors.New("invalid JSON")
	}
	return string(trimmed), nil
}

func contentTextAndAttachments(raw json.RawMessage) (string, []chatAttachmentInput, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return "", nil, nil
	}
	if trimmed[0] == '"' {
		var value string
		if json.Unmarshal(trimmed, &value) != nil {
			return "", nil, errors.New("消息 content 字符串无效")
		}
		return value, nil, nil
	}
	var parts []map[string]any
	if json.Unmarshal(trimmed, &parts) != nil {
		return "", nil, errors.New("消息 content 必须是字符串或内容数组")
	}
	values := make([]string, 0, len(parts))
	attachments := make([]chatAttachmentInput, 0, 2)
	for _, part := range parts {
		typeName, _ := part["type"].(string)
		switch typeName {
		case "text", "input_text", "output_text":
			if text, _ := part["text"].(string); text != "" {
				values = append(values, text)
			}
		case "image_url", "input_image", "image":
			if value := extractImageURL(part); value != "" {
				attachments = append(attachments, chatAttachmentInput{Source: value, Image: true})
			} else if fileID, _ := part["file_id"].(string); fileID != "" {
				return "", nil, errors.New("Grok Web 对话暂不支持 input_image.file_id，请使用 image_url 或 Base64 data URI")
			} else {
				return "", nil, errors.New("图片内容缺少 image_url")
			}
		case "file", "input_file":
			attachment, err := extractFileAttachment(part)
			if err != nil {
				return "", nil, err
			}
			attachments = append(attachments, attachment)
		case "input_audio":
			return "", nil, errors.New("Grok Web 对话暂不支持 input_audio 内容")
		default:
			return "", nil, fmt.Errorf("Grok Web 对话暂不支持 content.type=%q", typeName)
		}
	}
	return strings.Join(values, "\n"), attachments, nil
}

func extractFileAttachment(part map[string]any) (chatAttachmentInput, error) {
	value := part
	if nested, _ := part["file"].(map[string]any); nested != nil {
		value = nested
	}
	if fileID, _ := value["file_id"].(string); strings.TrimSpace(fileID) != "" {
		return chatAttachmentInput{}, errors.New("Grok Web 对话暂不支持 input_file.file_id，请使用 file_url 或 file_data")
	}
	fileURL, _ := value["file_url"].(string)
	fileData, _ := value["file_data"].(string)
	if strings.TrimSpace(fileURL) != "" && strings.TrimSpace(fileData) != "" {
		return chatAttachmentInput{}, errors.New("input_file 不能同时提供 file_url 和 file_data")
	}
	source := strings.TrimSpace(fileURL)
	if source == "" {
		source = strings.TrimSpace(fileData)
	}
	if source == "" {
		return chatAttachmentInput{}, errors.New("input_file 缺少 file_url 或 file_data")
	}
	filename, _ := value["filename"].(string)
	return chatAttachmentInput{Source: source, Filename: strings.TrimSpace(filename)}, nil
}

func extractImageURL(part map[string]any) string {
	value := part["image_url"]
	if text, ok := value.(string); ok {
		return text
	}
	if object, ok := value.(map[string]any); ok {
		text, _ := object["url"].(string)
		return text
	}
	return ""
}
