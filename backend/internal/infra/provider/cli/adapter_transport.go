package cli

import (
	"compress/gzip"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	settingsdomain "github.com/chenyme/grok2api/backend/internal/domain/settings"
	"github.com/chenyme/grok2api/backend/internal/infra/buildtransport"
)

type buildDirectTransport struct {
	current atomic.Pointer[http.Transport]
}

func newBuildDirectTransport(responseHeaderTimeout time.Duration) *buildDirectTransport {
	value := &buildDirectTransport{}
	value.current.Store(newBuildHTTPTransport(responseHeaderTimeout))
	return value
}

func (t *buildDirectTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return t.current.Load().RoundTrip(request)
}

func (t *buildDirectTransport) UpdateResponseHeaderTimeout(responseHeaderTimeout time.Duration) {
	next := newBuildHTTPTransport(responseHeaderTimeout)
	previous := t.current.Swap(next)
	if previous != nil {
		previous.CloseIdleConnections()
	}
}

func newBuildHTTPTransport(responseHeaderTimeout time.Duration) *http.Transport {
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment, ForceAttemptHTTP2: true,
		MaxIdleConns: 256, MaxIdleConnsPerHost: 128, MaxConnsPerHost: 256,
		IdleConnTimeout: buildtransport.IdleConnTimeout, TLSHandshakeTimeout: 10 * time.Second,
		ResponseHeaderTimeout: normalizeBuildResponseHeaderTimeout(responseHeaderTimeout),
		ExpectContinueTimeout: time.Second,
	}
	if _, err := buildtransport.ConfigureHTTP2Health(transport); err != nil {
		slog.Warn("build_http2_health_config_failed", "error", err)
	}
	return transport
}

func normalizeBuildResponseHeaderTimeout(value time.Duration) time.Duration {
	if value <= 0 {
		return settingsdomain.DefaultBuildResponseHeaderTimeout
	}
	return value
}

func normalizeBuildStreamIdleTimeout(value time.Duration) time.Duration {
	if value <= 0 {
		return settingsdomain.DefaultBuildStreamIdleTimeout
	}
	return value
}

func normalizeGzipResponse(response *http.Response) error {
	if response == nil || response.Body == nil || !strings.EqualFold(strings.TrimSpace(response.Header.Get("Content-Encoding")), "gzip") {
		return nil
	}
	reader, err := gzip.NewReader(response.Body)
	if err != nil {
		_ = response.Body.Close()
		return err
	}
	response.Body = &gzipResponseBody{Reader: reader, source: response.Body}
	response.Header.Del("Content-Encoding")
	response.Header.Del("Content-Length")
	response.ContentLength = -1
	return nil
}

type gzipResponseBody struct {
	*gzip.Reader
	source io.Closer
}

func (b *gzipResponseBody) Close() error {
	readerErr := b.Reader.Close()
	sourceErr := b.source.Close()
	if readerErr != nil {
		return readerErr
	}
	return sourceErr
}
