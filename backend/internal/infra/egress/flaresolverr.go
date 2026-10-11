package egress

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	application "github.com/chenyme/grok2api/backend/internal/application/egress"
	"github.com/chenyme/grok2api/backend/internal/pkg/tunnelproxy"
)

const maxFlareSolverrResponseBytes = 2 << 20

var (
	proxyCredentialPattern  = regexp.MustCompile(`(?i)\b(https?|socks4a?|socks5h?)://[^\s/@:]+:[^\s/@]+@`)
	tunnelCredentialPattern = regexp.MustCompile(`(?i)\b(?:trojan|vless)://[^\s/@]+@|\b(?:ss|vmess)://[^\s,;]+`)
	bearerCredentialPattern = regexp.MustCompile(`(?i)\bbearer\s+[a-z0-9._~+/=-]+`)
	namedCredentialPattern  = regexp.MustCompile(`(?i)\b(token|password|passwd|authorization|cookie)\s*[:=]\s*[^\s,;]+`)
)

type ClearanceConfig struct {
	Mode            string
	FlareSolverrURL string
	TargetURL       string
	Timeout         time.Duration
	RefreshInterval time.Duration
}

type clearanceSolution struct {
	Cookies   string
	UserAgent string
}

type clearanceSolver interface {
	Solve(context.Context, ClearanceConfig, string) (clearanceSolution, error)
}

type flaresolverrSolver struct{}

func (flaresolverrSolver) Solve(ctx context.Context, cfg ClearanceConfig, proxyURL string) (clearanceSolution, error) {
	if parsedProxy, parseErr := url.Parse(proxyURL); parseErr == nil && tunnelproxy.IsSupportedScheme(parsedProxy.Scheme) {
		return clearanceSolution{}, errors.New("FlareSolverr 暂不支持 Trojan、VLESS、SS 或 VMess 隧道代理")
	}
	endpoint, err := flaresolverrEndpoint(cfg.FlareSolverrURL)
	if err != nil {
		return clearanceSolution{}, err
	}
	target := strings.TrimSpace(cfg.TargetURL)
	if target == "" {
		target = "https://grok.com"
	}
	body, err := flaresolverrPayload(target, cfg.Timeout, proxyURL)
	if err != nil {
		return clearanceSolution{}, err
	}
	request, err := flaresolverrRequest(ctx, endpoint, body)
	if err != nil {
		return clearanceSolution{}, err
	}
	responseBody, err := flaresolverrResponse(cfg, request)
	if err != nil {
		return clearanceSolution{}, err
	}
	return decodeFlareSolverrSolution(responseBody)
}

// flaresolverrPayload 按 FlareSolverr 的 request.get 协议编码请求体，仅在配置了出口代理时附带 proxy 字段。
func flaresolverrPayload(target string, timeout time.Duration, proxyURL string) ([]byte, error) {
	payload := map[string]any{
		"cmd":        "request.get",
		"url":        target,
		"maxTimeout": timeout.Milliseconds(),
	}
	if proxyURL != "" {
		payload["proxy"] = map[string]string{"url": proxyURL}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("编码 FlareSolverr 请求: %w", err)
	}
	return body, nil
}

func flaresolverrRequest(ctx context.Context, endpoint string, body []byte) (*http.Request, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("创建 FlareSolverr 请求: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	return request, nil
}

// flaresolverrResponse 调用 FlareSolverr 并返回通过大小上限与状态码校验的响应体。
func flaresolverrResponse(cfg ClearanceConfig, request *http.Request) ([]byte, error) {
	client := &http.Client{
		Timeout: cfg.Timeout + 15*time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return errors.New("FlareSolverr 响应不允许重定向")
		},
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("调用 FlareSolverr: %w", err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, maxFlareSolverrResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("读取 FlareSolverr 响应: %w", err)
	}
	if len(responseBody) > maxFlareSolverrResponseBytes {
		return nil, errors.New("FlareSolverr 响应过大")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("FlareSolverr 返回 HTTP %d", response.StatusCode)
	}
	return responseBody, nil
}

// decodeFlareSolverrSolution 解析响应体，把 solution 归一化为可用的 Cloudflare 放行凭据。
func decodeFlareSolverrSolution(responseBody []byte) (clearanceSolution, error) {
	var result struct {
		Status   string `json:"status"`
		Message  string `json:"message"`
		Solution struct {
			UserAgent string `json:"userAgent"`
			Cookies   []struct {
				Name  string `json:"name"`
				Value string `json:"value"`
			} `json:"cookies"`
		} `json:"solution"`
	}
	if err := json.Unmarshal(responseBody, &result); err != nil {
		return clearanceSolution{}, fmt.Errorf("解析 FlareSolverr 响应: %w", err)
	}
	if result.Status != "ok" {
		message := sanitizeFlareSolverrMessage(result.Message)
		if message == "" {
			message = "unknown error"
		}
		return clearanceSolution{}, fmt.Errorf("FlareSolverr 求解失败: %s", message)
	}
	parts := make([]string, 0, len(result.Solution.Cookies))
	for _, cookie := range result.Solution.Cookies {
		if strings.TrimSpace(cookie.Name) != "" && strings.TrimSpace(cookie.Value) != "" {
			parts = append(parts, cookie.Name+"="+cookie.Value)
		}
	}
	cookies := application.SanitizeCloudflareCookies(strings.Join(parts, "; "))
	userAgent := strings.TrimSpace(result.Solution.UserAgent)
	if userAgent == "" || len(userAgent) > 512 || strings.IndexFunc(userAgent, func(character rune) bool { return character < 0x20 || character == 0x7f }) >= 0 {
		return clearanceSolution{}, errors.New("FlareSolverr 返回的 User-Agent 无效")
	}
	return clearanceSolution{Cookies: cookies, UserAgent: userAgent}, nil
}

func sanitizeFlareSolverrMessage(value string) string {
	value = strings.Map(func(character rune) rune {
		if character < 0x20 || character == 0x7f {
			return -1
		}
		return character
	}, strings.TrimSpace(value))
	value = proxyCredentialPattern.ReplaceAllStringFunc(value, func(candidate string) string {
		separator := strings.Index(candidate, "://")
		if separator < 0 {
			return "[redacted proxy]"
		}
		return candidate[:separator+3] + "***:***@"
	})
	value = tunnelCredentialPattern.ReplaceAllString(value, "[redacted tunnel proxy]")
	value = bearerCredentialPattern.ReplaceAllString(value, "Bearer [redacted]")
	value = namedCredentialPattern.ReplaceAllString(value, "$1=[redacted]")
	characters := []rune(value)
	if len(characters) > 300 {
		value = string(characters[:300])
	}
	return value
}

func flaresolverrEndpoint(value string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" || parsed.User != nil {
		return "", errors.New("FlareSolverr URL 无效")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errors.New("FlareSolverr URL 必须使用 HTTP 或 HTTPS")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("FlareSolverr URL 不能包含查询参数或片段")
	}
	path := strings.TrimSuffix(parsed.EscapedPath(), "/")
	if path == "" {
		path = "/v1"
	} else if path != "/v1" {
		path += "/v1"
	}
	parsed.RawPath = ""
	parsed.Path = path
	return parsed.String(), nil
}
