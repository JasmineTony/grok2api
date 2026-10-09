package egress

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"

	domain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	"github.com/chenyme/grok2api/backend/internal/pkg/tunnelproxy"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// ProxyURL returns one administrator-selected secret without placing it in
// ordinary list/detail payloads. HTTP handlers must mark the response no-store.
func (s *Service) ProxyURL(ctx context.Context, id uint64) (string, error) {
	value, err := s.repository.GetEgressNode(ctx, id)
	if errors.Is(err, repository.ErrNotFound) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(value.EncryptedProxyURL) == "" {
		return "", fmt.Errorf("%w: 节点未配置代理地址", ErrInvalidInput)
	}
	proxyURL, err := s.cipher.Decrypt(value.EncryptedProxyURL)
	if err != nil {
		return "", err
	}
	return NormalizeProxyURL(proxyURL)
}

// ProxyDisplay preserves the routable endpoint and, for standard proxies, the
// username, while ensuring passwords and tunnel credentials never enter list
// responses. The short fingerprint lets operators identify duplicate physical
// proxies without revealing the secret.
func ProxyDisplay(proxyURL string) string {
	parsed, err := url.Parse(proxyURL)
	if err != nil {
		return ""
	}
	if tunnelproxy.IsSupportedScheme(parsed.Scheme) {
		config, parseErr := tunnelproxy.Parse(proxyURL)
		if parseErr != nil {
			return ""
		}
		return strings.ToLower(config.Scheme) + "://***@" + config.Server
	}
	if parsed.Host == "" {
		return ""
	}
	if parsed.User != nil {
		username := parsed.User.Username()
		if _, hasPassword := parsed.User.Password(); hasPassword {
			parsed.User = url.UserPassword(username, "***")
		} else {
			parsed.User = url.User(username)
		}
	}
	parsed.Path, parsed.RawPath, parsed.RawQuery, parsed.Fragment = "", "", "", ""
	return parsed.String()
}

func (s *Service) accountBoundProxy(value domain.Node) bool {
	if s == nil || s.cipher == nil || strings.TrimSpace(value.EncryptedProxyURL) == "" {
		return false
	}
	proxyURL, err := s.cipher.Decrypt(value.EncryptedProxyURL)
	return err == nil && strings.Contains(proxyURL, ProxyAccountPlaceholder)
}

func NormalizeProxyURL(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	if len(value) > maxProxyURLBytes || strings.IndexFunc(value, func(character rune) bool { return character < 0x20 || character == 0x7f }) >= 0 {
		return "", errors.New("代理地址过长或包含控制字符")
	}
	hasAccountPlaceholder := strings.Contains(value, ProxyAccountPlaceholder)
	if strings.Count(value, ProxyAccountPlaceholder) > 1 {
		return "", errors.New("代理地址最多包含一个 {account} 占位符")
	}
	if hasAccountPlaceholder && strings.Contains(value, proxyAccountSentinel) {
		return "", errors.New("代理地址包含保留的账号占位符文本")
	}
	parseValue := strings.ReplaceAll(value, ProxyAccountPlaceholder, proxyAccountSentinel)
	// 传统 "IP:Port:Username:Password" 形式没有 scheme，一律按 http 处理；
	// 必须在 {account} 替换为 sentinel 之后解析，否则 url.UserPassword 会把占位符转义成
	// %7Baccount%7D，导致账号级粘性代理语义丢失。
	if username, password, host, legacy := splitLegacyProxyFormat(parseValue); legacy {
		if hasAccountPlaceholder && !strings.Contains(username, proxyAccountSentinel) {
			return "", errors.New("{account} 只能用于代理认证用户名")
		}
		normalized := (&url.URL{Scheme: "http", User: url.UserPassword(username, password), Host: host}).String()
		return strings.ReplaceAll(normalized, proxyAccountSentinel, ProxyAccountPlaceholder), nil
	}
	parsed, err := url.Parse(parseValue)
	if err != nil {
		return "", errors.New("代理地址格式无效")
	}
	scheme := strings.ToLower(parsed.Scheme)
	if tunnelproxy.IsSupportedScheme(scheme) {
		if hasAccountPlaceholder {
			return "", errors.New("隧道代理不支持 {account} 占位符")
		}
		normalized, normalizeErr := tunnelproxy.Normalize(value)
		if normalizeErr != nil {
			return "", normalizeErr
		}
		return normalized, nil
	}
	if parsed.Host == "" || parsed.Hostname() == "" {
		return "", errors.New("代理地址格式无效")
	}
	switch scheme {
	case "http", "https", "socks4", "socks4a", "socks5", "socks5h":
	default:
		return "", errors.New("代理地址协议必须是 HTTP、HTTPS、SOCKS4、SOCKS5、Trojan、VLESS、SS 或 VMess")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return "", errors.New("代理地址不能包含路径、查询参数或片段")
	}
	if hasAccountPlaceholder {
		if parsed.User == nil || !strings.Contains(parsed.User.Username(), proxyAccountSentinel) {
			return "", errors.New("{account} 只能用于代理认证用户名")
		}
		return strings.ReplaceAll(parsed.String(), proxyAccountSentinel, ProxyAccountPlaceholder), nil
	}
	return parsed.String(), nil
}

// splitLegacyProxyFormat 识别代理服务商常见的无 scheme 传统格式 "IP:Port:Username:Password"，
// 密码允许包含冒号。为避免误判既有格式，只有严格满足以下条件时才识别：
// 恰好 4 段、第一段是合法 IPv4（不支持 IPv6，也不支持主机名）、第二段是 1-65535 的纯十进制
// 端口（拒绝 "+8080"、" 8080"、"0" 与越界值）、用户名与密码均非空。
// 该格式没有 scheme，调用方一律按 http 处理。ok 为 false 表示不是该格式，应继续按标准 URL 解析。
func splitLegacyProxyFormat(value string) (username, password, host string, ok bool) {
	parts := strings.SplitN(value, ":", 4)
	if len(parts) != 4 {
		return "", "", "", false
	}
	if net.ParseIP(parts[0]).To4() == nil {
		return "", "", "", false
	}
	port, err := strconv.ParseUint(parts[1], 10, 16)
	if err != nil || port == 0 || parts[2] == "" || parts[3] == "" {
		return "", "", "", false
	}
	return parts[2], parts[3], net.JoinHostPort(parts[0], parts[1]), true
}

func SanitizeCloudflareCookies(value string) string {
	allowed := make([]string, 0, 4)
	seen := make(map[string]struct{})
	for part := range strings.SplitSeq(value, ";") {
		name, cookieValue, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		name = strings.TrimSpace(name)
		lower := strings.ToLower(name)
		if lower != "cf_clearance" && lower != "__cf_bm" && lower != "_cfuvid" && !strings.HasPrefix(lower, "cf_chl_") {
			continue
		}
		if _, exists := seen[lower]; exists {
			continue
		}
		cookieValue = strings.TrimSpace(cookieValue)
		if cookieValue == "" || len(cookieValue) > maxCloudflareCookieBytes || strings.IndexFunc(cookieValue, func(character rune) bool { return character < 0x20 || character == 0x7f }) >= 0 {
			continue
		}
		seen[lower] = struct{}{}
		allowed = append(allowed, lower+"="+cookieValue)
	}
	return strings.Join(allowed, "; ")
}
