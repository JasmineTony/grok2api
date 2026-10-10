package web

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"unicode/utf8"

	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

func appendUniqueString(values []string, value string) []string {
	if containsString(values, value) {
		return values
	}
	return append(values, value)
}

func containsString(values []string, value string) bool {
	for _, existing := range values {
		if existing == value {
			return true
		}
	}
	return false
}

func estimateTokens(value string) int64 {
	count := utf8.RuneCountInString(value)
	if count == 0 {
		return 0
	}
	return int64((count + 3) / 4)
}

func newWebID(prefix string) string {
	value := make([]byte, 16)
	_, _ = rand.Read(value)
	return prefix + "_" + hex.EncodeToString(value)
}

func streamHeaders() http.Header {
	value := http.Header{}
	value.Set("Content-Type", "text/event-stream; charset=utf-8")
	value.Set("Cache-Control", "no-cache")
	value.Set("X-Accel-Buffering", "no")
	return value
}

func jsonHeaders() http.Header {
	value := http.Header{}
	value.Set("Content-Type", "application/json; charset=utf-8")
	return value
}

func jsonProviderResponse(status int, value any) *provider.Response {
	data, _ := json.Marshal(value)
	return &provider.Response{StatusCode: status, Status: fmt.Sprintf("%d %s", status, http.StatusText(status)), Header: jsonHeaders(), Body: io.NopCloser(bytes.NewReader(data))}
}

type releaseBody struct {
	io.ReadCloser
	release func()
}

func (b *releaseBody) Close() error {
	err := b.ReadCloser.Close()
	if b.release != nil {
		b.release()
		b.release = nil
	}
	return err
}

type cancelBody struct {
	io.ReadCloser
	cancel context.CancelFunc
}

type readerCloser struct {
	io.Reader
	closer io.Closer
}

func (r *readerCloser) Close() error { return r.closer.Close() }

func (b *cancelBody) Close() error {
	err := b.ReadCloser.Close()
	if b.cancel != nil {
		b.cancel()
		b.cancel = nil
	}
	return err
}
