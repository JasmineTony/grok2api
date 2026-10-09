package web

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

type scriptedSSOClient struct {
	responses []*http.Response
	requests  []*http.Request
}

func (c *scriptedSSOClient) Do(request *http.Request) (*http.Response, error) {
	c.requests = append(c.requests, request)
	response := c.responses[0]
	c.responses = c.responses[1:]
	return response, nil
}

func TestSSOBuildFlowFollowsOnlyTrustedXAIHTTPSRedirects(t *testing.T) {
	client := &scriptedSSOClient{responses: []*http.Response{
		{StatusCode: http.StatusFound, Header: http.Header{"Location": []string{"https://auth.x.ai/next"}, "Set-Cookie": []string{"session=abc; Path=/; Secure"}}, Body: io.NopCloser(strings.NewReader(""))},
		{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("ok"))},
	}}
	flow := &ssoBuildFlow{client: client, userAgent: "test-agent", cookies: map[string]string{"sso": "secret"}}
	status, finalURL, body, err := flow.do(context.Background(), http.MethodGet, ssoDeviceURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK || finalURL != "https://auth.x.ai/next" || string(body) != "ok" {
		t.Fatalf("response = %d %s %q", status, finalURL, body)
	}
	if len(client.requests) != 2 || client.requests[1].Header.Get("User-Agent") != "test-agent" {
		t.Fatalf("requests = %#v", client.requests)
	}
	cookie := client.requests[1].Header.Get("Cookie")
	if !strings.Contains(cookie, "sso=secret") || !strings.Contains(cookie, "session=abc") {
		t.Fatalf("redirect cookies = %q", cookie)
	}

	unsafe := &scriptedSSOClient{responses: []*http.Response{{StatusCode: http.StatusFound, Header: http.Header{"Location": []string{"https://example.com/steal"}}, Body: io.NopCloser(strings.NewReader(""))}}}
	flow = &ssoBuildFlow{client: unsafe, userAgent: "test-agent", cookies: map[string]string{"sso": "secret"}}
	if _, _, _, err := flow.do(context.Background(), http.MethodGet, ssoDeviceURL, nil); err == nil {
		t.Fatal("unsafe redirect was accepted")
	}
}

func TestSSOBuildFlowMapsDeadSSOToUnauthorized(t *testing.T) {
	client := &scriptedSSOClient{responses: []*http.Response{
		{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(
			`{"device_code":"dc","user_code":"uc","interval":1,"expires_in":1800}`))},
		{StatusCode: http.StatusSeeOther, Header: http.Header{"Location": []string{"https://accounts.x.ai/sign-in"}}, Body: io.NopCloser(strings.NewReader(""))},
	}}
	flow := &ssoBuildFlow{client: client, userAgent: "lease-agent", cookies: map[string]string{"sso": "dead"}}
	_, err := flow.convert(context.Background(), fakeCredential())
	if !errors.Is(err, provider.ErrUnauthorized) {
		t.Fatalf("err = %v, want ErrUnauthorized", err)
	}
	if len(client.requests) != 2 {
		t.Fatalf("requests = %d, want 2 (device, verify)", len(client.requests))
	}
}

func TestSSOBuildFlowUsesAuthEndpointsOnly(t *testing.T) {
	client := &scriptedSSOClient{responses: []*http.Response{
		{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(
			`{"device_code":"dc","user_code":"uc","interval":1,"expires_in":1800}`))},
		{StatusCode: http.StatusSeeOther, Header: http.Header{"Location": []string{consentPageURL}}, Body: io.NopCloser(strings.NewReader(""))},
		{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(consentPageHTML))},
		{StatusCode: http.StatusSeeOther, Header: http.Header{"Location": []string{"https://accounts.x.ai/oauth2/device/done"}}, Body: io.NopCloser(strings.NewReader(""))},
		{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(
			`{"access_token":"access","refresh_token":"refresh","expires_in":3600}`))},
	}}
	flow := &ssoBuildFlow{client: client, userAgent: "lease-agent", cookies: map[string]string{"sso": "live", "sso-rw": "live"}}
	seed, err := flow.convert(context.Background(), fakeCredential())
	if err != nil {
		t.Fatal(err)
	}
	if seed.AccessToken != "access" || seed.RefreshToken != "refresh" || len(client.requests) != 5 {
		t.Fatalf("seed=%#v requests=%d", seed, len(client.requests))
	}
	// 设备授权状态变更仍只在 auth.x.ai 完成；accounts.x.ai 只用于读取 consent 页正文。
	for index, request := range client.requests {
		host := request.URL.Hostname()
		if index == 2 {
			if host != "accounts.x.ai" || request.URL.String() != consentPageURL {
				t.Fatalf("consent request = %s", request.URL)
			}
			continue
		}
		if host != "auth.x.ai" {
			t.Fatalf("device flow visited unexpected host %q", host)
		}
	}
}

func TestSSOBuildFlowVerifyDoesNotFollowRedirect(t *testing.T) {
	client := &scriptedSSOClient{responses: []*http.Response{
		{StatusCode: http.StatusSeeOther, Header: http.Header{"Location": []string{"https://accounts.x.ai/oauth2/device/consent"}}, Body: io.NopCloser(strings.NewReader(""))},
	}}
	flow := &ssoBuildFlow{client: client, userAgent: "lease-agent", cookies: map[string]string{"sso": "live"}}
	status, finalURL, _, err := flow.doWithFollow(context.Background(), http.MethodPost, ssoVerifyURL, url.Values{"user_code": {"uc"}}, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303", status)
	}
	if finalURL != "https://accounts.x.ai/oauth2/device/consent" {
		t.Fatalf("finalURL = %q", finalURL)
	}
	if len(client.requests) != 1 {
		t.Fatalf("redirect must not be followed, requests = %d", len(client.requests))
	}
}

func TestSSODeviceRedirectStateRequiresExactTrustedPath(t *testing.T) {
	tests := map[string]string{
		"https://accounts.x.ai/oauth2/device/consent":           "consent",
		"https://accounts.x.ai/oauth2/device/done/":             "done",
		"https://accounts.x.ai/sign-in?returnTo=%2Foauth2":      "sign-in",
		"https://accounts.x.ai/other?next=consent":              "",
		"https://accounts.x.ai/oauth2/device/consent-untrusted": "",
		"https://example.com/oauth2/device/consent":             "",
	}
	for raw, wanted := range tests {
		if actual := ssoDeviceRedirectState(raw); actual != wanted {
			t.Fatalf("ssoDeviceRedirectState(%q)=%q want=%q", raw, actual, wanted)
		}
	}
}

func fakeCredential() accountdomain.Credential { return accountdomain.Credential{} }

func TestSSOBuildConversionSanitizesTokenAndURLs(t *testing.T) {
	if token := normalizeSSOToken("sso=token-value; x-userid=drop"); token != "token-value" {
		t.Fatalf("token = %q", token)
	}
	for _, value := range []string{"https://accounts.x.ai/", "https://auth.x.ai/oauth2/device/code"} {
		if !safeXAIURL(value) {
			t.Fatalf("trusted URL rejected: %s", value)
		}
	}
	for _, value := range []string{"http://auth.x.ai/", "https://x.ai.example.com/", "https://user@auth.x.ai/"} {
		if safeXAIURL(value) {
			t.Fatalf("unsafe URL accepted: %s", value)
		}
	}
}

const (
	consentPageURL  = "https://accounts.x.ai/oauth2/device/consent"
	consentToken    = "eyJhbGciOiJFUzI1NiIsInR5cCI6ImNvbnNlbnQrand0In0.eyJkYyI6ImRjIn0.c2ln"
	consentPageHTML = `<form method="post" action="/oauth2/device/approve">` +
		`<input type="hidden" name="user_code" value="uc">` +
		`<input type="hidden" name="consent_token" value="` + consentToken + `"></form>`
	chromeTestUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
)

// consentFlowResponses 构造 device → verify → consent → approve → token 的标准响应队列。
func consentFlowResponses(verifyLocation string, consentResponse *http.Response) []*http.Response {
	return []*http.Response{
		{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(
			`{"device_code":"dc","user_code":"uc","interval":1,"expires_in":1800}`))},
		{StatusCode: http.StatusSeeOther, Header: http.Header{"Location": []string{verifyLocation}}, Body: io.NopCloser(strings.NewReader(""))},
		consentResponse,
		{StatusCode: http.StatusSeeOther, Header: http.Header{"Location": []string{"https://accounts.x.ai/oauth2/device/done"}}, Body: io.NopCloser(strings.NewReader(""))},
		{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(
			`{"access_token":"access","refresh_token":"refresh","expires_in":3600}`))},
	}
}

func okConsentResponse(body string) *http.Response {
	return &http.Response{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}
}

func TestParseConsentTokenExtractsHiddenField(t *testing.T) {
	tests := []struct {
		name string
		body string
		want string
	}{
		{"标准顺序", `<form><input type="hidden" name="consent_token" value="` + consentToken + `"></form>`, consentToken},
		{"属性顺序颠倒", `<input value="` + consentToken + `" name="consent_token">`, consentToken},
		{"自闭合标签", `<input name="consent_token" value="` + consentToken + `" />`, consentToken},
		{"单引号属性", `<input name='consent_token' value='` + consentToken + `'>`, consentToken},
		{"中间夹其它属性", `<input type="hidden" name="consent_token" id="x" data-a="b" value="` + consentToken + `">`, consentToken},
		{"大写属性名", `<INPUT NAME="consent_token" VALUE="` + consentToken + `">`, consentToken},
		{"缺字段", `<input type="hidden" name="other" value="` + consentToken + `">`, ""},
		{"空值", `<input name="consent_token" value="">`, ""},
		{"畸形 HTML", `<html><body><p>no input here</p></body></html>`, ""},
		{"非 HTML", "not html <<>> at all", ""},
		{"空正文", "", ""},
		{"JSON 回退命中", `{"consentToken":"` + consentToken + `"}`, consentToken},
		{"JSON 回退命中-RSC 转义", `self.__next_f.push([1,"{\"consentToken\":\"` + consentToken + `\"}"])`, consentToken},
		{"JSON 回退不命中-字段缺失", `{"otherToken":"` + consentToken + `"}`, ""},
		{"JSON 回退不命中-非 JWT", `{"consentToken":"not-a-jwt"}`, ""},
		{"JSON 回退不命中-前缀误匹配", `{"consentTokenValue":"` + consentToken + `"}`, ""},
	}
	for _, test := range tests {
		if got := parseConsentToken([]byte(test.body)); got != test.want {
			t.Fatalf("%s: parseConsentToken = %q, want %q", test.name, got, test.want)
		}
	}
}

func TestSSOOriginDerivesSchemeAndHost(t *testing.T) {
	tests := map[string]string{
		"https://accounts.x.ai/oauth2/device/consent": "https://accounts.x.ai",
		"https://auth.x.ai/oauth2/device/consent?x=1": "https://auth.x.ai",
		"https://auth.x.ai:8443/oauth2/device/consent": "https://auth.x.ai:8443",
		"/oauth2/device/consent":                       "",
		"":                                             "",
	}
	for raw, want := range tests {
		if got := ssoOrigin(raw); got != want {
			t.Fatalf("ssoOrigin(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestSSOBuildFlowSendsConsentTokenToApprove(t *testing.T) {
	client := &scriptedSSOClient{responses: consentFlowResponses(consentPageURL, okConsentResponse(consentPageHTML))}
	flow := &ssoBuildFlow{client: client, userAgent: chromeTestUserAgent, cookies: map[string]string{"sso": "live"}}
	seed, err := flow.convert(context.Background(), fakeCredential())
	if err != nil {
		t.Fatal(err)
	}
	if seed.AccessToken != "access" || len(client.requests) != 5 {
		t.Fatalf("seed=%#v requests=%d", seed, len(client.requests))
	}

	consent := client.requests[2]
	if consent.Method != http.MethodGet || consent.URL.String() != consentPageURL {
		t.Fatalf("consent request = %s %s", consent.Method, consent.URL)
	}
	for key, want := range map[string]string{
		"Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"Sec-Fetch-Dest":            "document",
		"Sec-Fetch-Mode":            "navigate",
		"Sec-Fetch-Site":            "same-origin",
		"Upgrade-Insecure-Requests": "1",
	} {
		if got := consent.Header.Get(key); got != want {
			t.Fatalf("consent header %s = %q, want %q", key, got, want)
		}
	}
	if !strings.HasPrefix(consent.Header.Get("Sec-Ch-Ua"), `"Google Chrome";v="138"`) {
		t.Fatalf("consent client hints = %q", consent.Header.Get("Sec-Ch-Ua"))
	}

	approve := client.requests[3]
	if approve.Method != http.MethodPost || approve.URL.String() != ssoApproveURL {
		t.Fatalf("approve request = %s %s", approve.Method, approve.URL)
	}
	if got := approve.Header.Get("Origin"); got != "https://accounts.x.ai" {
		t.Fatalf("approve Origin = %q", got)
	}
	if got := approve.Header.Get("Referer"); got != consentPageURL {
		t.Fatalf("approve Referer = %q", got)
	}
	payload, err := io.ReadAll(approve.Body)
	if err != nil {
		t.Fatal(err)
	}
	form, err := url.ParseQuery(string(payload))
	if err != nil {
		t.Fatal(err)
	}
	if form.Get("consent_token") != consentToken || form.Get("user_code") != "uc" || form.Get("action") != "allow" {
		t.Fatalf("approve form = %q", payload)
	}
}

func TestSSOBuildFlowConsentOriginFollowsConsentHost(t *testing.T) {
	authConsentURL := "https://auth.x.ai/oauth2/device/consent"
	client := &scriptedSSOClient{responses: consentFlowResponses(authConsentURL, okConsentResponse(consentPageHTML))}
	flow := &ssoBuildFlow{client: client, userAgent: "lease-agent", cookies: map[string]string{"sso": "live"}}
	if _, err := flow.convert(context.Background(), fakeCredential()); err != nil {
		t.Fatal(err)
	}
	if got := client.requests[2].URL.String(); got != authConsentURL {
		t.Fatalf("consent URL = %q", got)
	}
	if got := client.requests[3].Header.Get("Origin"); got != "https://auth.x.ai" {
		t.Fatalf("approve Origin = %q", got)
	}
	if got := client.requests[3].Header.Get("Referer"); got != authConsentURL {
		t.Fatalf("approve Referer = %q", got)
	}
}

func TestSSOBuildFlowConsentPageForbiddenKeepsStatus(t *testing.T) {
	client := &scriptedSSOClient{responses: []*http.Response{
		{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(
			`{"device_code":"dc","user_code":"uc","interval":1,"expires_in":1800}`))},
		{StatusCode: http.StatusSeeOther, Header: http.Header{"Location": []string{consentPageURL}}, Body: io.NopCloser(strings.NewReader(""))},
		{StatusCode: http.StatusForbidden, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("Request could not be verified"))},
	}}
	flow := &ssoBuildFlow{client: client, userAgent: "lease-agent", cookies: map[string]string{"sso": "live"}}
	_, err := flow.convert(context.Background(), fakeCredential())
	var statusErr conversionHTTPError
	if !errors.As(err, &statusErr) || statusErr.status != http.StatusForbidden {
		t.Fatalf("err = %v, want conversionHTTPError 403", err)
	}
	if len(client.requests) != 3 {
		t.Fatalf("requests = %d, want 3 (device, verify, consent)", len(client.requests))
	}
}

func TestSSOBuildFlowRequiresConsentToken(t *testing.T) {
	client := &scriptedSSOClient{responses: []*http.Response{
		{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(
			`{"device_code":"dc","user_code":"uc","interval":1,"expires_in":1800}`))},
		{StatusCode: http.StatusSeeOther, Header: http.Header{"Location": []string{consentPageURL}}, Body: io.NopCloser(strings.NewReader(""))},
		okConsentResponse(`<form><input type="hidden" name="user_code" value="uc"></form>`),
	}}
	flow := &ssoBuildFlow{client: client, userAgent: "lease-agent", cookies: map[string]string{"sso": "live"}}
	_, err := flow.convert(context.Background(), fakeCredential())
	if err == nil || !strings.Contains(err.Error(), "consent_token") {
		t.Fatalf("err = %v, want 未获取到 consent_token", err)
	}
	if len(client.requests) != 3 {
		t.Fatalf("approve must not be sent, requests = %d", len(client.requests))
	}
}
