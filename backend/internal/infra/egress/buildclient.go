package egress

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	_ "github.com/bdandy/go-socks4"
	"github.com/chenyme/grok2api/backend/internal/infra/buildtransport"
	"github.com/chenyme/grok2api/backend/internal/pkg/tunnelproxy"
	xproxy "golang.org/x/net/proxy"
)

// newBuildClient keeps Grok Build on the standard Go HTTP/TLS stack used by
// the official CLI-facing transport. Browser TLS impersonation is reserved for
// Grok Web, where the browser fingerprint and User-Agent belong together.
func newBuildClient(proxyURL string, responseHeaderTimeout time.Duration) (*http.Client, error) {
	return newBuildClientWithOptions(proxyURL, responseHeaderTimeout, false)
}

// newBuildEnvironmentClient preserves the process-wide Build direct
// transport's HTTP_PROXY/HTTPS_PROXY behavior while giving the caller an
// independent connection pool.
func newBuildEnvironmentClient(responseHeaderTimeout time.Duration) (*http.Client, error) {
	return newBuildClientWithOptions("", responseHeaderTimeout, true)
}

func newBuildClientWithOptions(proxyURL string, responseHeaderTimeout time.Duration, environmentProxy bool) (*http.Client, error) {
	direct := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	transport := &http.Transport{
		Proxy:                 nil,
		DialContext:           direct.DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          256,
		MaxIdleConnsPerHost:   128,
		MaxConnsPerHost:       256,
		IdleConnTimeout:       buildtransport.IdleConnTimeout,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: responseHeaderTimeout,
		ExpectContinueTimeout: time.Second,
	}
	if environmentProxy {
		transport.Proxy = http.ProxyFromEnvironment
	}
	if strings.TrimSpace(proxyURL) != "" {
		if err := configureBuildProxyTransport(transport, direct, proxyURL); err != nil {
			return nil, err
		}
	}
	if _, err := buildtransport.ConfigureHTTP2Health(transport); err != nil {
		return nil, fmt.Errorf("配置 Grok Build HTTP/2 健康探测: %w", err)
	}
	return &http.Client{
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}, nil
}

// configureBuildProxyTransport 按出口代理协议改写 transport 的 Proxy 或 DialContext，
// 协议不受支持或代理不可用时返回构建客户端时使用的错误。
func configureBuildProxyTransport(transport *http.Transport, direct *net.Dialer, proxyURL string) error {
	parsed, err := url.Parse(proxyURL)
	if err != nil {
		return fmt.Errorf("解析 Grok Build 出口代理: %w", err)
	}
	switch strings.ToLower(parsed.Scheme) {
	case "http", "https":
		transport.Proxy = http.ProxyURL(parsed)
	case "socks4", "socks4a", "socks5", "socks5h":
		dialer, err := xproxy.FromURL(parsed, direct)
		if err != nil {
			return fmt.Errorf("创建 Grok Build SOCKS 代理: %w", err)
		}
		transport.DialContext = dialContext(dialer)
	case "trojan", "vless", "ss", "vmess":
		dialer, err := tunnelproxy.NewDialer(proxyURL)
		if err != nil {
			return fmt.Errorf("创建 Grok Build 隧道代理: %w", err)
		}
		transport.DialContext = dialer.DialContext
	default:
		return fmt.Errorf("Grok Build 不支持代理协议 %q", parsed.Scheme)
	}
	return nil
}

func dialContext(dialer xproxy.Dialer) func(context.Context, string, string) (net.Conn, error) {
	if contextual, ok := dialer.(xproxy.ContextDialer); ok {
		return contextual.DialContext
	}
	type result struct {
		connection net.Conn
		err        error
	}
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		completed := make(chan result, 1)
		go func() {
			connection, err := dialer.Dial(network, address)
			completed <- result{connection: connection, err: err}
		}()
		select {
		case value := <-completed:
			return value.connection, value.err
		case <-ctx.Done():
			go func() {
				value := <-completed
				if value.connection != nil {
					_ = value.connection.Close()
				}
			}()
			return nil, ctx.Err()
		}
	}
}
