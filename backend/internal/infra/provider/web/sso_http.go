package web

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/infra/provider/browserheaders"
)

func (f *ssoBuildFlow) do(ctx context.Context, method, endpoint string, form url.Values) (int, string, []byte, error) {
	return f.doWithFollow(ctx, method, endpoint, form, true, nil)
}

// doWithFollow 在 follow=false 时遇到 3xx 直接返回状态码与解析后的 Location 作为 finalURL，
// 用于重定向目标域会被 Cloudflare 拦截（accounts.x.ai）的请求。
// extra 是额外请求头（如浏览器表单提交的 Origin/Referer），会覆盖同名默认头。
func (f *ssoBuildFlow) doWithFollow(ctx context.Context, method, endpoint string, form url.Values, follow bool, extra http.Header) (int, string, []byte, error) {
	if !safeXAIURL(endpoint) {
		return 0, "", nil, fmt.Errorf("xAI OAuth URL 不安全")
	}
	currentURL := endpoint
	currentMethod := method
	currentForm := form
	for redirects := 0; redirects <= 8; redirects++ {
		request, err := f.newFollowRequest(ctx, currentMethod, currentURL, currentForm, extra)
		if err != nil {
			return 0, "", nil, err
		}
		response, err := f.client.Do(request)
		if err != nil {
			return 0, "", nil, err
		}
		f.captureCookies(response)
		data, readErr := io.ReadAll(io.LimitReader(response.Body, maxAuthBody+1))
		_ = response.Body.Close()
		if readErr != nil {
			return response.StatusCode, currentURL, nil, readErr
		}
		if len(data) > maxAuthBody {
			return response.StatusCode, currentURL, nil, fmt.Errorf("xAI OAuth 响应超过 2 MiB")
		}
		if response.StatusCode < 300 || response.StatusCode > 399 {
			return response.StatusCode, currentURL, data, nil
		}
		nextURL, locationErr := resolveSSORedirectTarget(response, currentURL)
		currentURL = nextURL
		if locationErr != nil {
			return response.StatusCode, currentURL, data, locationErr
		}
		if !follow {
			return response.StatusCode, currentURL, nil, nil
		}
		if response.StatusCode == http.StatusSeeOther || ((response.StatusCode == http.StatusMovedPermanently || response.StatusCode == http.StatusFound) && currentMethod != http.MethodGet && currentMethod != http.MethodHead) {
			currentMethod = http.MethodGet
			currentForm = nil
		}
	}
	return 0, currentURL, nil, fmt.Errorf("xAI OAuth 重定向次数过多")
}

// newFollowRequest 构造一次 OAuth 请求：表单非空时按 urlencoded 提交，extra 覆盖同名默认头。
func (f *ssoBuildFlow) newFollowRequest(ctx context.Context, method, endpoint string, form url.Values, extra http.Header) (*http.Request, error) {
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json, text/html;q=0.9, */*;q=0.8")
	request.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	request.Header.Set("User-Agent", f.userAgent)
	request.Header.Set("Cookie", f.cookieHeader())
	if form != nil {
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	for key, values := range extra {
		for _, value := range values {
			request.Header.Set(key, value)
		}
	}
	return request, nil
}

// resolveSSORedirectTarget 解析 3xx 响应的 Location 得到跳转目标。
// Location 缺失或解析失败时返回当前 URL 与对应错误；目标域名不受信时返回已解析的新 URL 与错误。
func resolveSSORedirectTarget(response *http.Response, currentURL string) (string, error) {
	location := strings.TrimSpace(response.Header.Get("Location"))
	if location == "" {
		return currentURL, fmt.Errorf("xAI OAuth 重定向缺少 Location")
	}
	base, _ := url.Parse(currentURL)
	next, err := url.Parse(location)
	if err != nil {
		return currentURL, err
	}
	target := base.ResolveReference(next).String()
	if !safeXAIURL(target) {
		return target, fmt.Errorf("xAI OAuth 重定向到非受信域名")
	}
	return target, nil
}

// fetchConsentPage 以浏览器文档导航方式读取 consent 页正文，用于提取一次性防伪令牌 consent_token。
func (f *ssoBuildFlow) fetchConsentPage(ctx context.Context, consentURL string) ([]byte, error) {
	if !safeXAIURL(consentURL) {
		return nil, fmt.Errorf("xAI OAuth consent 页 URL 不安全")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, consentURL, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	request.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	request.Header.Set("Cache-Control", "no-cache")
	request.Header.Set("Pragma", "no-cache")
	request.Header.Set("Sec-Fetch-Dest", "document")
	request.Header.Set("Sec-Fetch-Mode", "navigate")
	request.Header.Set("Sec-Fetch-Site", "same-origin")
	request.Header.Set("Upgrade-Insecure-Requests", "1")
	request.Header.Set("User-Agent", f.userAgent)
	request.Header.Set("Cookie", f.cookieHeader())
	browserheaders.ApplyChromiumClientHints(request.Header, f.userAgent)
	response, err := f.client.Do(request)
	if err != nil {
		return nil, err
	}
	f.captureCookies(response)
	body, readErr := io.ReadAll(io.LimitReader(response.Body, maxAuthBody+1))
	_ = response.Body.Close()
	if readErr != nil {
		return nil, readErr
	}
	if len(body) > maxAuthBody {
		return nil, fmt.Errorf("xAI OAuth 响应超过 2 MiB")
	}
	// 必须保留状态码：出口层依赖 conversionHTTPError 的状态码区分上游拒绝与节点反爬失败。
	if response.StatusCode < 200 || response.StatusCode >= 400 {
		return nil, fmt.Errorf("SSO 自动批准 Device Flow 读取 consent 页失败: %w", conversionHTTPError{status: response.StatusCode})
	}
	return body, nil
}

func (f *ssoBuildFlow) captureCookies(response *http.Response) {
	for _, cookie := range response.Cookies() {
		name := strings.TrimSpace(cookie.Name)
		value := strings.TrimSpace(cookie.Value)
		if name == "" || len(name) > 128 || len(value) > 16384 || strings.ContainsAny(name+value, "\r\n\x00") {
			continue
		}
		if cookie.MaxAge < 0 {
			delete(f.cookies, name)
			continue
		}
		f.cookies[name] = value
	}
}

func (f *ssoBuildFlow) cookieHeader() string {
	keys := make([]string, 0, len(f.cookies))
	for key := range f.cookies {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+f.cookies[key])
	}
	return strings.Join(parts, "; ")
}

func safeXAIURL(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || parsed.Hostname() == "" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "x.ai" || strings.HasSuffix(host, ".x.ai")
}
