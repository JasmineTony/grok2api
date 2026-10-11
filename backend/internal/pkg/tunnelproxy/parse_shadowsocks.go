package tunnelproxy

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"strings"
)

func parseShadowsocks(value string) (Config, error) {
	payload, err := parseShadowsocksPayload(value)
	if err != nil {
		return Config{}, err
	}
	userPart, serverPart, err := splitShadowsocksEndpoint(payload)
	if err != nil {
		return Config{}, err
	}
	method, password, err := splitShadowsocksCredential(userPart)
	if err != nil {
		return Config{}, err
	}
	server, err := parseShadowsocksServer(serverPart)
	if err != nil {
		return Config{}, err
	}
	credential := method + ":" + password
	config := Config{
		Scheme: "ss", Server: server, Credential: password, Method: method, Transport: "tcp",
		CanonicalProxyURL: "ss://" + base64.RawURLEncoding.EncodeToString([]byte(credential)) + "@" + server,
	}
	if err := validateConfig(config); err != nil {
		return Config{}, fmt.Errorf("创建 Shadowsocks 隧道配置: %w", err)
	}
	return config, nil
}

func parseShadowsocksPayload(value string) (string, error) {
	payload := value[len("ss://"):]
	if before, _, found := strings.Cut(payload, "#"); found {
		payload = before
	}
	if before, rawQuery, found := strings.Cut(payload, "?"); found {
		query, err := url.ParseQuery(rawQuery)
		if err != nil {
			return "", errors.New("Shadowsocks 查询参数无效")
		}
		if plugin := strings.TrimSpace(query.Get("plugin")); plugin != "" {
			return "", errors.New("暂不支持 Shadowsocks plugin")
		}
		if len(query) != 0 {
			return "", errors.New("Shadowsocks 查询参数无效")
		}
		payload = before
	}
	return payload, nil
}

func splitShadowsocksEndpoint(payload string) (string, string, error) {
	if separator := strings.LastIndex(payload, "@"); separator >= 0 {
		userPart, serverPart := payload[:separator], payload[separator+1:]
		decoded, err := url.PathUnescape(userPart)
		if err != nil {
			return "", "", errors.New("Shadowsocks 凭据无效")
		}
		if !strings.Contains(decoded, ":") {
			decoded, err = decodeBase64String(decoded)
			if err != nil {
				return "", "", errors.New("Shadowsocks 凭据不是有效的 Base64")
			}
		}
		return decoded, serverPart, nil
	}
	decoded, err := decodeBase64String(payload)
	if err != nil {
		return "", "", errors.New("旧式 Shadowsocks 地址不是有效的 Base64")
	}
	separator := strings.LastIndex(decoded, "@")
	if separator < 0 {
		return "", "", errors.New("旧式 Shadowsocks 地址格式无效")
	}
	return decoded[:separator], decoded[separator+1:], nil
}

func splitShadowsocksCredential(userPart string) (string, string, error) {
	method, password, ok := strings.Cut(userPart, ":")
	if !ok || strings.TrimSpace(method) == "" || password == "" {
		return "", "", errors.New("Shadowsocks method/password 不能为空")
	}
	method = strings.ToLower(strings.TrimSpace(method))
	switch method {
	case "aes-128-gcm", "aes-256-gcm", "chacha20-ietf-poly1305":
	default:
		return "", "", fmt.Errorf("暂不支持 Shadowsocks method %q", method)
	}
	return method, password, nil
}

func parseShadowsocksServer(serverPart string) (string, error) {
	serverURL, err := url.Parse("ss://" + serverPart)
	if err != nil || serverURL.User != nil || (serverURL.Path != "" && serverURL.Path != "/") || serverURL.RawQuery != "" || serverURL.Fragment != "" {
		return "", errors.New("Shadowsocks 服务器地址无效")
	}
	server, err := canonicalServer(serverURL.Hostname(), serverURL.Port())
	if err != nil {
		return "", err
	}
	return server, nil
}
