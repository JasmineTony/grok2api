package tunnelproxy

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

func canonicalServer(host, port string) (string, error) {
	host = strings.TrimSpace(strings.Trim(host, "[]"))
	if host == "" {
		return "", errors.New("隧道代理服务器不能为空")
	}
	parsedPort, err := strconv.ParseUint(strings.TrimSpace(port), 10, 16)
	if err != nil || parsedPort == 0 {
		return "", errors.New("隧道代理端口无效")
	}
	return net.JoinHostPort(host, strconv.FormatUint(parsedPort, 10)), nil
}

func validateWebSocketHost(host string) error {
	parsed, err := url.Parse("http://" + strings.TrimSpace(host))
	if err != nil || parsed.Hostname() == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return errors.New("WebSocket host 无效")
	}
	if parsed.Port() != "" {
		if _, err := canonicalServer(parsed.Hostname(), parsed.Port()); err != nil {
			return errors.New("WebSocket host 无效")
		}
	}
	return nil
}

func decodeBase64String(value string) (string, error) {
	decoded, err := decodeBase64Bytes(value)
	return string(decoded), err
}

func decodeBase64Bytes(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	for _, encoding := range []*base64.Encoding{base64.RawStdEncoding, base64.StdEncoding, base64.RawURLEncoding, base64.URLEncoding} {
		if decoded, err := encoding.DecodeString(value); err == nil {
			return decoded, nil
		}
	}
	return nil, errors.New("invalid base64")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func splitList(value string) []string {
	var result []string
	for item := range strings.SplitSeq(value, ",") {
		if item = strings.TrimSpace(item); item != "" {
			result = append(result, item)
		}
	}
	return result
}

func queryBool(query url.Values, names ...string) (bool, error) {
	for _, name := range names {
		if raw, ok := query[name]; ok && len(raw) != 0 {
			return parseBool(raw[0], name)
		}
	}
	return false, nil
}

func jsonBool(value map[string]any, name string) (bool, error) {
	raw, ok := value[name]
	if !ok || raw == nil {
		return false, nil
	}
	switch typed := raw.(type) {
	case bool:
		return typed, nil
	case string:
		return parseBool(typed, name)
	case float64:
		return parseBool(strconv.FormatFloat(typed, 'f', -1, 64), name)
	default:
		return false, fmt.Errorf("%s 必须是布尔值", name)
	}
}

func parseBool(value, name string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes":
		return true, nil
	case "", "0", "false", "no":
		return false, nil
	default:
		return false, fmt.Errorf("%s 必须是布尔值", name)
	}
}

func jsonString(value map[string]any, name string) string {
	raw, ok := value[name]
	if !ok || raw == nil {
		return ""
	}
	switch typed := raw.(type) {
	case string:
		return strings.TrimSpace(typed)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		return ""
	}
}

func jsonStringList(value map[string]any, name string) ([]string, error) {
	raw, ok := value[name]
	if !ok || raw == nil {
		return nil, nil
	}
	if text, ok := raw.(string); ok {
		return splitList(text), nil
	}
	items, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("%s 必须是字符串或字符串数组", name)
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		text, ok := item.(string)
		if !ok {
			return nil, fmt.Errorf("%s 必须是字符串或字符串数组", name)
		}
		if text = strings.TrimSpace(text); text != "" {
			result = append(result, text)
		}
	}
	return result, nil
}
