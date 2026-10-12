package web

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

// ssoDeviceCodes 是 xAI Device Flow 启动响应中的设备与用户码。
type ssoDeviceCodes struct {
	DeviceCode string `json:"device_code"`
	UserCode   string `json:"user_code"`
	Interval   int    `json:"interval"`
	ExpiresIn  int    `json:"expires_in"`
}

// startSSODeviceFlow 请求/sso_device 并校验返回的设备码，缺省值沿用上游默认。
func (f *ssoBuildFlow) startSSODeviceFlow(ctx context.Context) (ssoDeviceCodes, error) {
	form := url.Values{"client_id": {ssoBuildClientID}, "scope": {ssoBuildScope}}
	status, _, body, err := f.do(ctx, http.MethodPost, ssoDeviceURL, form)
	if err != nil {
		return ssoDeviceCodes{}, err
	}
	if status < 200 || status >= 300 {
		return ssoDeviceCodes{}, fmt.Errorf("xAI Device Flow 启动失败: %w", conversionHTTPError{status: status})
	}
	var device ssoDeviceCodes
	if err := json.Unmarshal(body, &device); err != nil {
		return ssoDeviceCodes{}, fmt.Errorf("解析 xAI Device Flow: %w", err)
	}
	if device.DeviceCode == "" || device.UserCode == "" {
		return ssoDeviceCodes{}, fmt.Errorf("xAI Device Flow 返回字段不完整")
	}
	if device.Interval <= 0 {
		device.Interval = 5
	}
	if device.ExpiresIn <= 0 {
		device.ExpiresIn = 1800
	}
	return device, nil
}

// verifySSODeviceCode 触发自动验证并校验重定向状态为 consent。
func (f *ssoBuildFlow) verifySSODeviceCode(ctx context.Context, userCode string) (string, error) {
	// verify/approve 已在 auth.x.ai 完成状态变更。重定向目标只是结果页，
	// 因此不跟随 3xx，直接解析首个 3xx Location 的状态路径。
	status, finalURL, _, err := f.doWithFollow(ctx, http.MethodPost, ssoVerifyURL, url.Values{"user_code": {userCode}}, false, nil)
	if err != nil {
		return "", err
	}
	if status == http.StatusUnauthorized {
		return "", provider.ErrUnauthorized
	}
	if status < 200 || status >= 400 {
		return "", fmt.Errorf("SSO 自动验证 Device Flow 失败: %w", conversionHTTPError{status: status})
	}
	if redirectState := ssoDeviceRedirectState(finalURL); redirectState != "consent" {
		if redirectState == "sign-in" {
			return "", provider.ErrUnauthorized
		}
		return "", fmt.Errorf("SSO 自动验证 Device Flow 失败")
	}
	return finalURL, nil
}

// approveSSODeviceCode 抓取 consent 页一次性令牌并提交自动批准。
func (f *ssoBuildFlow) approveSSODeviceCode(ctx context.Context, consentURL, userCode string) error {
	// approve 必须回传 consent 页里的一次性防伪令牌 consent_token；verify 的 3xx 分支不返回正文，
	// 因此这里按浏览器文档导航再取一次 consent 页正文。
	consentBody, err := f.fetchConsentPage(ctx, consentURL)
	if err != nil {
		return err
	}
	consentToken := parseConsentToken(consentBody)
	if consentToken == "" {
		return fmt.Errorf("SSO 自动批准 Device Flow 失败: 未获取到 consent_token")
	}
	// Origin 必须与 consent 页同源（accounts.x.ai 或 auth.x.ai），Referer 为 consent 页完整 URL。
	status, finalURL, _, err := f.doWithFollow(ctx, http.MethodPost, ssoApproveURL, url.Values{
		"user_code": {userCode}, "action": {"allow"}, "principal_type": {"User"}, "principal_id": {""},
		"consent_token": {consentToken},
	}, false, http.Header{"Origin": {ssoOrigin(consentURL)}, "Referer": {consentURL}})
	if err != nil {
		return err
	}
	if status < 200 || status >= 400 {
		return fmt.Errorf("SSO 自动批准 Device Flow 失败: %w", conversionHTTPError{status: status})
	}
	if redirectState := ssoDeviceRedirectState(finalURL); redirectState != "done" {
		if redirectState == "sign-in" {
			return provider.ErrUnauthorized
		}
		return fmt.Errorf("SSO 自动批准 Device Flow 失败")
	}
	return nil
}

func ssoDeviceRedirectState(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || !safeXAIURL(raw) {
		return ""
	}
	path := strings.TrimRight(parsed.EscapedPath(), "/")
	switch path {
	case "/oauth2/device/consent":
		return "consent"
	case "/oauth2/device/done":
		return "done"
	case "/sign-in", "/sign-up":
		return "sign-in"
	default:
		return ""
	}
}

// ssoOrigin 从 URL 派生 Origin（scheme://host）；consent 页可能位于 accounts.x.ai 或 auth.x.ai，不能硬编码。
func ssoOrigin(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}
