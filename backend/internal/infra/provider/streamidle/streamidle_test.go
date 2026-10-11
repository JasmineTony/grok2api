package streamidle

import (
	"context"
	"errors"
	"io"
	"testing"
	"time"

	"github.com/chenyme/grok2api/backend/internal/pkg/neterror"
)

type contextReader struct{ ctx context.Context }

func (r contextReader) Read([]byte) (int, error) {
	<-r.ctx.Done()
	return 0, r.ctx.Err()
}

func (contextReader) Close() error { return nil }

func TestReadCloserCancelsBlockedReadWithSharedSentinel(t *testing.T) {
	ctx, cancel := context.WithCancelCause(context.Background())
	wrapper := New(contextReader{ctx: ctx}, 20*time.Millisecond, cancel)
	defer wrapper.Close()

	_, err := wrapper.Read(make([]byte, 1))
	if !errors.Is(err, neterror.ErrUpstreamStreamIdleTimeout) {
		t.Fatalf("Read() error = %v, want ErrUpstreamStreamIdleTimeout", err)
	}
	if cause := context.Cause(ctx); !errors.Is(cause, neterror.ErrUpstreamStreamIdleTimeout) {
		t.Fatalf("context cause = %v, want ErrUpstreamStreamIdleTimeout", cause)
	}
	if !wrapper.TimedOut() {
		t.Fatal("TimedOut() = false after idle deadline")
	}
}

func TestReadCloserResetsDeadlineOnProgress(t *testing.T) {
	ctx, cancel := context.WithCancelCause(context.Background())
	// 计时余量：单次进度间隔（gap）必须远小于空闲阈值，且整段流的耗时必须大于阈值
	// ——前者避免机器负载把一次 sleep 拖过阈值造成假失败，后者保证「未重置定时器」时本用例仍会失败
	// （缺少 Reset 时定时器会在 150ms 触发，io.Copy 立即报错）。
	wrapper := New(io.NopCloser(&pacedReader{chunks: 30, gap: 10 * time.Millisecond}), 150*time.Millisecond, cancel)
	defer wrapper.Close()
	if _, err := io.Copy(io.Discard, wrapper); err != nil {
		t.Fatal(err)
	}
	if wrapper.TimedOut() || context.Cause(ctx) != nil {
		t.Fatalf("steady stream timed out: timedOut=%t cause=%v", wrapper.TimedOut(), context.Cause(ctx))
	}
}

func TestReadCloserReportsProgressBeforeIdleTimeout(t *testing.T) {
	ctx, cancel := context.WithCancelCause(context.Background())
	reader, writer := io.Pipe()
	wrapper := New(reader, 200*time.Millisecond, cancel)
	defer wrapper.Close()

	go func() {
		_, _ = writer.Write([]byte("{"))
		<-ctx.Done()
		_ = writer.CloseWithError(ctx.Err())
	}()

	buffer := make([]byte, 1)
	if n, err := wrapper.Read(buffer); n != 1 || err != nil {
		t.Fatalf("first read = (%d, %v), want one byte", n, err)
	}
	if _, err := wrapper.Read(buffer); !errors.Is(err, neterror.ErrUpstreamStreamIdleTimeout) || !neterror.IdleTimeoutObservedData(err) {
		t.Fatalf("idle error = %#v, observed=%t", err, neterror.IdleTimeoutObservedData(err))
	}
}

type pacedReader struct {
	chunks int
	gap    time.Duration
}

func (r *pacedReader) Read(buffer []byte) (int, error) {
	if r.chunks == 0 {
		return 0, io.EOF
	}
	time.Sleep(r.gap)
	r.chunks--
	buffer[0] = 'x'
	return 1, nil
}
