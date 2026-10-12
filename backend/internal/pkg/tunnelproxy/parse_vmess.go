package tunnelproxy

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

type vmessShare struct {
	Version       string `json:"v,omitempty"`
	Address       string `json:"add"`
	Port          string `json:"port"`
	UUID          string `json:"id"`
	AlterID       string `json:"aid"`
	Cipher        string `json:"scy,omitempty"`
	Network       string `json:"net"`
	TLS           string `json:"tls,omitempty"`
	ServerName    string `json:"sni,omitempty"`
	ALPN          string `json:"alpn,omitempty"`
	Host          string `json:"host,omitempty"`
	Path          string `json:"path,omitempty"`
	AllowInsecure bool   `json:"allowInsecure,omitempty"`
}

type vmessIdentity struct {
	address string
	port    string
	userID  string
	alterID int
	cipher  string
}

func parseVMess(value string) (Config, error) {
	raw, err := decodeVMessShare(value)
	if err != nil {
		return Config{}, err
	}
	address := jsonString(raw, "add")
	port := jsonString(raw, "port")
	server, err := parseVMessServer(address, port)
	if err != nil {
		return Config{}, err
	}
	identity, err := parseVMessIdentity(raw, address, port)
	if err != nil {
		return Config{}, err
	}
	transport, tlsEnabled, err := resolveVMessTransport(raw)
	if err != nil {
		return Config{}, err
	}
	return buildVMessConfig(raw, server, identity, transport, tlsEnabled)
}

func decodeVMessShare(value string) (map[string]any, error) {
	payload := value[len("vmess://"):]
	if before, _, found := strings.Cut(payload, "#"); found {
		payload = before
	}
	decoded, err := decodeBase64Bytes(payload)
	if err != nil {
		return nil, errors.New("VMess 配置不是有效的 Base64")
	}
	var raw map[string]any
	if err := json.Unmarshal(decoded, &raw); err != nil {
		return nil, errors.New("VMess 配置不是有效的 JSON")
	}
	return raw, nil
}

func parseVMessServer(address, port string) (string, error) {
	server, err := canonicalServer(address, port)
	if err != nil {
		return "", fmt.Errorf("VMess %w", err)
	}
	return server, nil
}

func parseVMessIdentity(raw map[string]any, address, port string) (vmessIdentity, error) {
	parsedUUID, err := uuid.Parse(jsonString(raw, "id"))
	if err != nil {
		return vmessIdentity{}, errors.New("VMess UUID 无效")
	}
	alterID, err := strconv.Atoi(firstNonEmpty(jsonString(raw, "aid"), "0"))
	if err != nil || alterID < 0 || alterID > 65535 {
		return vmessIdentity{}, errors.New("VMess alterId 无效")
	}
	cipher := strings.ToLower(firstNonEmpty(jsonString(raw, "scy"), jsonString(raw, "security"), "auto"))
	switch cipher {
	case "auto", "aes-128-gcm", "chacha20-poly1305", "none":
	default:
		return vmessIdentity{}, fmt.Errorf("暂不支持 VMess cipher %q", cipher)
	}
	return vmessIdentity{
		address: address, port: port, userID: parsedUUID.String(), alterID: alterID, cipher: cipher,
	}, nil
}

func resolveVMessTransport(raw map[string]any) (string, bool, error) {
	transport := strings.ToLower(firstNonEmpty(jsonString(raw, "net"), "tcp"))
	if transport == "websocket" {
		transport = "ws"
	}
	if transport != "tcp" && transport != "ws" {
		return "", false, fmt.Errorf("暂不支持 VMess %s 传输", transport)
	}
	if headerType := strings.ToLower(jsonString(raw, "type")); headerType != "" && headerType != "none" {
		return "", false, fmt.Errorf("暂不支持 VMess header type %q", headerType)
	}
	tlsMode := strings.ToLower(jsonString(raw, "tls"))
	if tlsMode != "" && tlsMode != "none" && tlsMode != "tls" {
		return "", false, fmt.Errorf("暂不支持 VMess TLS 模式 %q", tlsMode)
	}
	return transport, tlsMode == "tls", nil
}

func resolveVMessWebSocket(raw map[string]any, serverName, transport string) (string, string, error) {
	host := firstNonEmpty(jsonString(raw, "host"), serverName)
	if err := validateWebSocketHost(host); transport == "ws" && err != nil {
		return "", "", err
	}
	path := jsonString(raw, "path")
	if path == "" {
		path = "/"
	} else if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	if transport == "tcp" && (jsonString(raw, "path") != "" || jsonString(raw, "host") != "") {
		return "", "", errors.New("VMess TCP 隧道不能包含 WebSocket host/path")
	}
	return host, path, nil
}

func buildVMessConfig(raw map[string]any, server string, identity vmessIdentity, transport string, tlsEnabled bool) (Config, error) {
	serverName := firstNonEmpty(jsonString(raw, "sni"), identity.address)
	alpn, err := jsonStringList(raw, "alpn")
	if err != nil {
		return Config{}, err
	}
	host, path, err := resolveVMessWebSocket(raw, serverName, transport)
	if err != nil {
		return Config{}, err
	}
	insecure, err := jsonBool(raw, "allowInsecure")
	if err != nil {
		return Config{}, err
	}
	share := vmessShare{
		Version: "2", Address: identity.address, Port: identity.port, UUID: identity.userID,
		AlterID: strconv.Itoa(identity.alterID), Cipher: identity.cipher, Network: transport,
		ServerName: serverName, ALPN: strings.Join(alpn, ","), AllowInsecure: insecure,
	}
	if transport == "ws" {
		share.Host = host
		share.Path = path
	}
	if tlsEnabled {
		share.TLS = "tls"
	}
	canonicalJSON, err := json.Marshal(share)
	if err != nil {
		return Config{}, err
	}
	config := Config{
		Scheme: "vmess", Server: server, Credential: identity.userID, AlterID: identity.alterID, Cipher: identity.cipher,
		Transport: transport, TLS: tlsEnabled, ServerName: serverName, Insecure: insecure, ALPN: alpn,
		WebSocketHost: host, WebSocketPath: path,
		CanonicalProxyURL: "vmess://" + base64.RawStdEncoding.EncodeToString(canonicalJSON),
	}
	if err := validateConfig(config); err != nil {
		return Config{}, fmt.Errorf("创建 VMess 隧道配置: %w", err)
	}
	return config, nil
}
