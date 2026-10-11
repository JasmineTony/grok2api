package tunnelproxy

import (
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/google/uuid"
)

func parseUserInfoProxy(value string) (Config, error) {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Hostname() == "" || parsed.User == nil {
		return Config{}, errors.New("隧道代理地址格式无效")
	}
	scheme := strings.ToLower(parsed.Scheme)
	credential := parsed.User.Username()
	if credential == "" {
		return Config{}, errors.New("隧道代理凭据不能为空")
	}
	if _, hasPassword := parsed.User.Password(); hasPassword {
		return Config{}, errors.New("隧道代理凭据格式无效")
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return Config{}, errors.New("隧道代理地址路径无效")
	}
	server, err := canonicalServer(parsed.Hostname(), parsed.Port())
	if err != nil {
		return Config{}, err
	}
	return buildUserInfoProxyConfig(scheme, credential, server, parsed.Hostname(), parsed.Query())
}

func buildUserInfoProxyConfig(scheme, credential, server, hostname string, query url.Values) (Config, error) {
	transport, err := resolveUserInfoTransport(query)
	if err != nil {
		return Config{}, err
	}
	flow := strings.ToLower(strings.TrimSpace(query.Get("flow")))
	credential, err = normalizeUserInfoCredential(scheme, credential, query)
	if err != nil {
		return Config{}, err
	}
	tlsEnabled, securityMode, err := resolveUserInfoSecurity(scheme, transport, query)
	if err != nil {
		return Config{}, err
	}
	if err := validateUserInfoFlow(scheme, transport, securityMode, flow); err != nil {
		return Config{}, err
	}
	if headerType := strings.ToLower(strings.TrimSpace(query.Get("headerType"))); headerType != "" && headerType != "none" {
		return Config{}, fmt.Errorf("暂不支持 %s headerType %q", strings.ToUpper(scheme), headerType)
	}
	insecure, err := queryBool(query, "allowInsecure", "insecure", "skip-cert-verify")
	if err != nil {
		return Config{}, err
	}
	serverName := firstNonEmpty(query.Get("sni"), query.Get("peer"), hostname)
	reality, err := resolveRealityParameters(securityMode, query)
	if err != nil {
		return Config{}, err
	}
	wsHost, wsPath, err := resolveUserInfoWebSocket(query, serverName, transport)
	if err != nil {
		return Config{}, err
	}
	config := Config{
		Scheme: scheme, Server: server, Credential: credential, Transport: transport,
		TLS: tlsEnabled, Security: securityMode, Flow: flow, ServerName: serverName, Insecure: insecure,
		ALPN: splitList(query.Get("alpn")), RealityPublicKey: reality.publicKey, RealityShortID: reality.shortID,
		ClientFingerprint: reality.fingerprint, SpiderX: reality.spiderX, WebSocketHost: wsHost, WebSocketPath: wsPath,
	}
	config.CanonicalProxyURL = canonicalUserInfoProxyURL(config)
	if err := validateConfig(config); err != nil {
		return Config{}, fmt.Errorf("创建 %s 隧道配置: %w", strings.ToUpper(scheme), err)
	}
	return config, nil
}

func resolveUserInfoTransport(query url.Values) (string, error) {
	transport := strings.ToLower(firstNonEmpty(query.Get("type"), query.Get("network")))
	if transport == "" || transport == "none" {
		transport = "tcp"
	}
	if transport == "websocket" {
		transport = "ws"
	}
	if transport != "tcp" && transport != "ws" {
		return "", fmt.Errorf("暂不支持 %s 传输", transport)
	}
	return transport, nil
}

func normalizeUserInfoCredential(scheme, credential string, query url.Values) (string, error) {
	if scheme != "vless" {
		return credential, nil
	}
	parsedUUID, err := uuid.Parse(credential)
	if err != nil {
		return "", errors.New("VLESS UUID 无效")
	}
	if encryption := strings.ToLower(strings.TrimSpace(query.Get("encryption"))); encryption != "" && encryption != "none" {
		return "", errors.New("VLESS encryption 必须为 none")
	}
	return parsedUUID.String(), nil
}

func resolveUserInfoSecurity(scheme, transport string, query url.Values) (bool, string, error) {
	tlsEnabled := scheme == "trojan"
	securityMode := "none"
	if tlsEnabled {
		securityMode = "tls"
	}
	switch security := strings.ToLower(strings.TrimSpace(query.Get("security"))); security {
	case "", "tls":
		if security == "tls" {
			tlsEnabled = true
			securityMode = "tls"
		}
	case "none":
		tlsEnabled = false
		securityMode = "none"
	case "reality":
		if scheme != "vless" {
			return false, "", errors.New("Reality security 当前仅支持 VLESS")
		}
		if transport != "tcp" {
			return false, "", errors.New("VLESS Reality 当前仅支持 TCP 传输")
		}
		tlsEnabled = true
		securityMode = "reality"
	default:
		return false, "", fmt.Errorf("暂不支持 %s security %q", strings.ToUpper(scheme), security)
	}
	return tlsEnabled, securityMode, nil
}

func validateUserInfoFlow(scheme, transport, securityMode, flow string) error {
	if flow == "" {
		return nil
	}
	if scheme != "vless" || flow != "xtls-rprx-vision" {
		return fmt.Errorf("暂不支持 VLESS flow %q", flow)
	}
	if transport != "tcp" || (securityMode != "tls" && securityMode != "reality") {
		return errors.New("VLESS Vision 需要 TCP 和 TLS 或 Reality security")
	}
	return nil
}

type realityParameters struct {
	publicKey   string
	shortID     string
	fingerprint string
	spiderX     string
}

func resolveRealityParameters(securityMode string, query url.Values) (realityParameters, error) {
	parameters := realityParameters{
		publicKey:   firstNonEmpty(query.Get("pbk"), query.Get("public-key"), query.Get("publicKey")),
		shortID:     firstNonEmpty(query.Get("sid"), query.Get("short-id"), query.Get("shortId")),
		fingerprint: strings.ToLower(firstNonEmpty(query.Get("fp"), query.Get("fingerprint"), query.Get("client-fingerprint"))),
		spiderX:     firstNonEmpty(query.Get("spx"), query.Get("spider-x"), query.Get("spiderX")),
	}
	if securityMode != "reality" {
		if parameters.publicKey != "" || parameters.shortID != "" || parameters.fingerprint != "" || parameters.spiderX != "" {
			return realityParameters{}, errors.New("Reality 参数只能用于 Reality security")
		}
		return parameters, nil
	}
	if parameters.publicKey == "" {
		return realityParameters{}, errors.New("VLESS Reality public key 不能为空")
	}
	if parameters.fingerprint == "" {
		parameters.fingerprint = "chrome"
	}
	if _, supported := realityClientHelloID(parameters.fingerprint); !supported {
		return realityParameters{}, fmt.Errorf("VLESS Reality 暂不支持客户端指纹 %q", parameters.fingerprint)
	}
	return parameters, nil
}

func resolveUserInfoWebSocket(query url.Values, serverName, transport string) (string, string, error) {
	wsHost := firstNonEmpty(query.Get("host"), serverName)
	if err := validateWebSocketHost(wsHost); transport == "ws" && err != nil {
		return "", "", err
	}
	wsPath := query.Get("path")
	if wsPath == "" {
		wsPath = "/"
	} else if !strings.HasPrefix(wsPath, "/") {
		wsPath = "/" + wsPath
	}
	if transport == "tcp" && (query.Get("path") != "" || query.Get("host") != "") {
		return "", "", errors.New("TCP 隧道不能包含 WebSocket host/path")
	}
	return wsHost, wsPath, nil
}

func canonicalUserInfoProxyURL(config Config) string {
	query := make(url.Values)
	query.Set("type", config.Transport)
	security := config.Security
	if security == "" {
		security = "none"
		if config.TLS {
			security = "tls"
		}
	}
	query.Set("security", security)
	if config.Scheme == "vless" {
		query.Set("encryption", "none")
	}
	if config.Flow != "" {
		query.Set("flow", config.Flow)
	}
	query.Set("sni", config.ServerName)
	if security == "reality" {
		query.Set("pbk", config.RealityPublicKey)
		query.Set("sid", config.RealityShortID)
		query.Set("fp", config.ClientFingerprint)
		if config.SpiderX != "" {
			query.Set("spx", config.SpiderX)
		}
	}
	if config.Insecure {
		query.Set("allowInsecure", "1")
	}
	if len(config.ALPN) != 0 {
		query.Set("alpn", strings.Join(config.ALPN, ","))
	}
	if config.Transport == "ws" {
		query.Set("host", config.WebSocketHost)
		query.Set("path", config.WebSocketPath)
	}
	return (&url.URL{
		Scheme:   config.Scheme,
		User:     url.User(config.Credential),
		Host:     config.Server,
		RawQuery: query.Encode(),
	}).String()
}
