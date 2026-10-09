package inference

import (
	"context"
	"errors"
	"io"
	"testing"
	"time"

	clientws "github.com/gorilla/websocket"
)

// waitVoiceWSOutcomeWithin 在独立 goroutine 中执行 waitVoiceWSOutcome，并附加硬上限。
// 静默会话下实现必须主动观察请求上下文；一旦该观察被移除，这里会立即失败，
// 而不是让整个测试进程挂死。
func waitVoiceWSOutcomeWithin(t *testing.T, ctx context.Context, errCh <-chan pumpResult) (string, bool, bool) {
	t.Helper()
	type outcome struct {
		errorCode      string
		upstreamFailed bool
		normal         bool
	}
	done := make(chan outcome, 1)
	go func() {
		errorCode, upstreamFailed, normal := waitVoiceWSOutcome(ctx, errCh)
		done <- outcome{errorCode: errorCode, upstreamFailed: upstreamFailed, normal: normal}
	}()
	select {
	case value := <-done:
		return value.errorCode, value.upstreamFailed, value.normal
	case <-time.After(2 * time.Second):
		t.Fatal("waitVoiceWSOutcome 未在 2s 内返回：静默会话没有观察请求上下文")
		return "", false, false
	}
}

// TestWaitVoiceWSOutcomePumpBranches 覆盖任一 pump 先结束时的归因分支。
func TestWaitVoiceWSOutcomePumpBranches(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name          string
		pump          pumpResult
		wantErrorCode string
		wantUpstream  bool
		wantNormal    bool
	}{
		{
			name:       "客户端侧正常关闭",
			pump:       pumpResult{},
			wantNormal: true,
		},
		{
			name:       "客户端侧 EOF 视为正常关闭",
			pump:       pumpResult{result: voiceWSPumpResult{err: io.EOF}},
			wantNormal: true,
		},
		{
			name:       "客户端侧正常关闭码视为正常关闭",
			pump:       pumpResult{result: voiceWSPumpResult{err: &clientws.CloseError{Code: clientws.CloseNormalClosure, Text: "bye"}}},
			wantNormal: true,
		},
		{
			name:          "客户端读取失败",
			pump:          pumpResult{result: voiceWSPumpResult{err: errors.New("client read failed")}},
			wantErrorCode: "client_stream_interrupted",
		},
		{
			// 客户端 → 上游 pump 的写入目标是上游连接，写失败归因上游。
			name:          "客户端 pump 写入上游失败归因上游",
			pump:          pumpResult{result: voiceWSPumpResult{err: errors.New("client write failed"), writeFailed: true}},
			wantErrorCode: "upstream_stream_interrupted",
			wantUpstream:  true,
		},
		{
			name:          "上游读取失败",
			pump:          pumpResult{upstreamSide: true, result: voiceWSPumpResult{err: errors.New("upstream read failed")}},
			wantErrorCode: "upstream_stream_interrupted",
			wantUpstream:  true,
		},
		{
			// 上游 → 客户端 pump 的写入目标是客户端连接，写失败归因客户端。
			name:          "上游 pump 写入客户端失败归因客户端",
			pump:          pumpResult{upstreamSide: true, result: voiceWSPumpResult{err: errors.New("upstream write failed"), writeFailed: true}},
			wantErrorCode: "client_stream_interrupted",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			errCh := make(chan pumpResult, 1)
			errCh <- test.pump
			errorCode, upstreamFailed, normal := waitVoiceWSOutcomeWithin(t, context.Background(), errCh)
			if errorCode != test.wantErrorCode || upstreamFailed != test.wantUpstream || normal != test.wantNormal {
				t.Fatalf("waitVoiceWSOutcome = (%q, %t, %t), want (%q, %t, %t)",
					errorCode, upstreamFailed, normal, test.wantErrorCode, test.wantUpstream, test.wantNormal)
			}
		})
	}
}

// TestWaitVoiceWSOutcomeObservesRequestTimeout 是 issue #1071 的核心回归断言：
// 两个 pump 都静默时，只有请求上下文超时才能收敛会话并返回 request_timeout。
func TestWaitVoiceWSOutcomeObservesRequestTimeout(t *testing.T) {
	t.Parallel()
	silent := make(chan pumpResult)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	started := time.Now()
	errorCode, upstreamFailed, normal := waitVoiceWSOutcomeWithin(t, ctx, silent)
	if errorCode != "request_timeout" || upstreamFailed || normal {
		t.Fatalf("waitVoiceWSOutcome = (%q, %t, %t), want (%q, false, false)", errorCode, upstreamFailed, normal, "request_timeout")
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("静默会话超时收敛耗时 %s，请求上下文超时未及时生效", elapsed)
	}
}

// TestWaitVoiceWSOutcomeObservesRequestCancel 覆盖非超时的上下文取消：仍归因客户端。
func TestWaitVoiceWSOutcomeObservesRequestCancel(t *testing.T) {
	t.Parallel()
	silent := make(chan pumpResult)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	started := time.Now()
	errorCode, upstreamFailed, normal := waitVoiceWSOutcomeWithin(t, ctx, silent)
	if errorCode != "client_stream_interrupted" || upstreamFailed || normal {
		t.Fatalf("waitVoiceWSOutcome = (%q, %t, %t), want (%q, false, false)", errorCode, upstreamFailed, normal, "client_stream_interrupted")
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("静默会话取消收敛耗时 %s，请求上下文取消未及时生效", elapsed)
	}
}
