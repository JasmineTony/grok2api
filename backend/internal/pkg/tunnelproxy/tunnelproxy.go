package tunnelproxy

import (
	"errors"
	"strings"
)

type Config struct {
	Scheme            string
	Server            string
	Credential        string
	Method            string
	AlterID           int
	Cipher            string
	Transport         string
	TLS               bool
	Security          string
	Flow              string
	ServerName        string
	Insecure          bool
	ALPN              []string
	RealityPublicKey  string
	RealityShortID    string
	ClientFingerprint string
	SpiderX           string
	WebSocketHost     string
	WebSocketPath     string
	CanonicalProxyURL string
}

func IsSupportedScheme(scheme string) bool {
	switch strings.ToLower(strings.TrimSpace(scheme)) {
	case "trojan", "vless", "ss", "vmess":
		return true
	default:
		return false
	}
}

func Normalize(value string) (string, error) {
	config, err := Parse(value)
	if err != nil {
		return "", err
	}
	return config.CanonicalProxyURL, nil
}

func Parse(value string) (Config, error) {
	value = strings.TrimSpace(value)
	if strings.IndexFunc(value, func(character rune) bool { return character < 0x20 || character == 0x7f }) >= 0 {
		return Config{}, errors.New("隧道代理地址包含控制字符")
	}
	scheme, _, ok := strings.Cut(value, "://")
	if !ok || !IsSupportedScheme(scheme) {
		return Config{}, errors.New("不支持的隧道代理协议")
	}
	switch strings.ToLower(scheme) {
	case "ss":
		return parseShadowsocks(value)
	case "vmess":
		return parseVMess(value)
	default:
		return parseUserInfoProxy(value)
	}
}
