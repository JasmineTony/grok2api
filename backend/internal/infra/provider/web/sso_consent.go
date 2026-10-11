package web

import (
	"bytes"
	"strings"

	"golang.org/x/net/html"
)

// parseConsentToken 提取 consent 页里的一次性防伪令牌。优先解析表单 input，
// 未命中时再严格匹配页面内嵌 JSON（RSC 数据流）中的 consentToken，解析不到返回空串。
func parseConsentToken(body []byte) string {
	if token := consentTokenFromInput(body); token != "" {
		return token
	}
	return consentTokenFromJSON(body)
}

// consentTokenFromInput 用 HTML tokenizer 解析 <input name="consent_token" value="...">，
// 容忍属性顺序颠倒、单/双引号、自闭合标签以及 name 与 value 之间夹杂其它属性。
func consentTokenFromInput(body []byte) string {
	tokenizer := html.NewTokenizer(bytes.NewReader(body))
	for {
		switch tokenizer.Next() {
		case html.ErrorToken:
			return ""
		case html.StartTagToken, html.SelfClosingTagToken:
			name, hasAttrs := tokenizer.TagName()
			if !strings.EqualFold(string(name), "input") || !hasAttrs {
				continue
			}
			fieldName, value := readInputAttributes(tokenizer)
			if strings.EqualFold(fieldName, "consent_token") && value != "" {
				return value
			}
		}
	}
}

// readInputAttributes 顺序读取当前标签的全部属性，返回 name 与 value 两个属性值（均已 TrimSpace），
// 未出现的属性返回空串。属性读取一次耗尽，故取到最后一组后直接返回。
func readInputAttributes(tokenizer *html.Tokenizer) (string, string) {
	fieldName := ""
	value := ""
	for {
		key, attrValue, more := tokenizer.TagAttr()
		switch strings.ToLower(string(key)) {
		case "name":
			fieldName = strings.TrimSpace(string(attrValue))
		case "value":
			value = strings.TrimSpace(string(attrValue))
		}
		if !more {
			return fieldName, value
		}
	}
}

// consentTokenFromJSON 严格定界匹配 consentToken 之后紧跟的 JSON 字符串值（允许 RSC 流里的 \" 转义），
// 不使用宽泛正则，避免在 RSC 数据流中误匹配其它字段。
func consentTokenFromJSON(body []byte) string {
	const key = "consentToken"
	for offset := 0; offset < len(body); {
		index := bytes.Index(body[offset:], []byte(key))
		if index < 0 {
			return ""
		}
		start := offset + index + len(key)
		offset = start
		rest := bytes.TrimLeft(body[start:], " \t\r\n\\\"")
		if len(rest) == 0 || rest[0] != ':' {
			continue
		}
		rest = bytes.TrimLeft(rest[1:], " \t\r\n\\\"")
		end := bytes.IndexByte(rest, '"')
		if end < 0 {
			continue
		}
		// RSC 流里的引号带反斜杠转义，值末尾可能残留一个反斜杠。
		if value := strings.TrimRight(string(rest[:end]), "\\"); isConsentTokenValue(value) {
			return value
		}
	}
	return ""
}

// isConsentTokenValue 只接受 base64url 编码的 JWT 形状，缩小 JSON 回退的误匹配面。
func isConsentTokenValue(value string) bool {
	return strings.HasPrefix(value, "eyJ") && strings.Count(value, ".") == 2 && !strings.ContainsRune(value, '\\') && len(value) <= 8192
}
