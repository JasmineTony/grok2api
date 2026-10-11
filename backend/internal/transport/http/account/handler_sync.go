package account

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	accountapp "github.com/chenyme/grok2api/backend/internal/application/account"
	accountsyncapp "github.com/chenyme/grok2api/backend/internal/application/accountsync"
	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/shared/response"
	"github.com/gin-gonic/gin"
)

func (h *Handler) convertWebToBuild(c *gin.Context) {
	var request buildConversionRequest
	if c.ShouldBindJSON(&request) != nil {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "转换请求无效")
		return
	}
	if request.All && len(request.IDs) > 0 {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "全部转换与指定账号不能同时提交")
		return
	}
	if request.Strategy == "" {
		request.Strategy = accountapp.BuildConversionMissing
	}
	if request.Strategy != accountapp.BuildConversionAll && request.Strategy != accountapp.BuildConversionMissing {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "转换策略无效")
		return
	}
	var ids []uint64
	if !request.All {
		var err error
		ids, err = parseIDs(request.IDs)
		if err != nil {
			response.Error(c, http.StatusBadRequest, "invalidId", err.Error())
			return
		}
		if !h.validateProviderIDs(c, ids, string(accountdomain.ProviderWeb)) {
			return
		}
	}
	h.streamWebToBuildConversion(c, request.All, ids, request.Strategy)
}

func (h *Handler) syncWebToConsole(c *gin.Context) {
	var request webConsoleSyncRequest
	if c.ShouldBindJSON(&request) != nil {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "同步请求无效")
		return
	}
	if request.All && len(request.IDs) > 0 {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "全部同步与指定账号不能同时提交")
		return
	}
	if request.Strategy == "" {
		request.Strategy = accountapp.WebConsoleSyncAll
	}
	if request.Strategy != accountapp.WebConsoleSyncAll && request.Strategy != accountapp.WebConsoleSyncMissing {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "同步策略无效")
		return
	}
	var ids []uint64
	if !request.All {
		var err error
		ids, err = parseIDs(request.IDs)
		if err != nil {
			response.Error(c, http.StatusBadRequest, "invalidId", err.Error())
			return
		}
		if !h.validateProviderIDs(c, ids, string(accountdomain.ProviderWeb)) {
			return
		}
	}
	h.streamWebToConsoleSync(c, request.All, ids, request.Strategy)
}

func (h *Handler) runWebToConsoleSync(ctx context.Context, all bool, ids []uint64, strategy accountapp.WebConsoleSyncStrategy, progress accountapp.BatchProgressObserver, syncProgress func(completed, total int)) (accountapp.ImportResult, accountsyncapp.Result, error) {
	pipeline := h.startSyncPipeline(ctx, syncProgress)
	var (
		result accountapp.ImportResult
		err    error
	)
	if all {
		result, err = h.service.SyncAllWebAccountsToConsoleWithStrategy(pipeline.ctx, strategy, pipeline.Observe, progress)
	} else {
		result, err = h.service.SyncWebAccountsToConsoleWithStrategy(pipeline.ctx, ids, strategy, pipeline.Observe, progress)
	}
	syncResult := pipeline.Finish(err != nil)
	return result, syncResult, err
}

func (h *Handler) streamWebToConsoleSync(c *gin.Context, all bool, ids []uint64, strategy accountapp.WebConsoleSyncStrategy) {
	stream := newAccountEventStream(c)
	defer stream.Close()
	var total atomic.Int64
	result, syncResult, err := h.runWebToConsoleSync(c.Request.Context(), all, ids, strategy, stream.PhaseProgressObserver("importing", &total), stream.SyncProgressObserver())
	if err != nil {
		stream.WriteError("accountConsoleSyncFailed", "Grok Web 账号同步到 Console 失败")
		return
	}
	_ = stream.Write("complete", accountImportResponse{Created: result.Created, Updated: result.Updated, Skipped: result.Skipped, Synced: syncResult.Succeeded, SyncFailed: syncResult.Failed})
}

func (h *Handler) runWebToBuildConversion(ctx context.Context, all bool, ids []uint64, strategy accountapp.BuildConversionStrategy, progress accountapp.BatchProgressObserver, syncProgress func(completed, total int)) (accountapp.BuildConversionResult, accountsyncapp.Result, error) {
	pipeline := h.startSyncPipeline(ctx, syncProgress)
	var (
		result accountapp.BuildConversionResult
		err    error
	)
	if all {
		result, err = h.service.ConvertAllWebAccountsToBuildWithStrategy(pipeline.ctx, strategy, pipeline.Observe, progress)
	} else {
		result, err = h.service.ConvertWebAccountsToBuildWithStrategy(pipeline.ctx, ids, strategy, pipeline.Observe, progress)
	}
	syncResult := pipeline.Finish(err != nil)
	return result, syncResult, err
}

func (h *Handler) streamWebToBuildConversion(c *gin.Context, all bool, ids []uint64, strategy accountapp.BuildConversionStrategy) {
	stream := newAccountEventStream(c)
	defer stream.Close()
	var total atomic.Int64
	result, syncResult, err := h.runWebToBuildConversion(c.Request.Context(), all, ids, strategy, stream.PhaseProgressObserver("converting", &total), stream.SyncProgressObserver())
	if err != nil {
		stream.WriteError("accountConversionFailed", "Grok Web 账号转换失败")
		return
	}
	_ = stream.Write("complete", newBuildConversionResponse(result, syncResult))
}

func newBuildConversionResponse(result accountapp.BuildConversionResult, syncResult accountsyncapp.Result) buildConversionResponse {
	return buildConversionResponse{
		Created: result.Created, Linked: result.Linked, Skipped: result.Skipped, Failed: result.Failed,
		Synced: syncResult.Succeeded, SyncFailed: syncResult.Failed,
	}
}

func prepareAccountEventStream(c *gin.Context) {
	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache, no-transform")
	c.Header("X-Accel-Buffering", "no")
}

type accountEventStream struct {
	context   *gin.Context
	mu        sync.Mutex
	stop      chan struct{}
	done      chan struct{}
	closeOnce sync.Once
}

func newAccountEventStream(c *gin.Context) *accountEventStream {
	prepareAccountEventStream(c)
	stream := &accountEventStream{context: c, stop: make(chan struct{}), done: make(chan struct{})}
	_ = stream.writeComment("connected")
	go stream.heartbeat()
	return stream
}

func (s *accountEventStream) ProgressObserver() accountapp.BatchProgressObserver {
	return s.PhaseProgressObserver("", nil)
}

func (s *accountEventStream) PhaseProgressObserver(phase string, totalValue *atomic.Int64) accountapp.BatchProgressObserver {
	return func(completed, total int) error {
		if totalValue != nil {
			totalValue.Store(int64(total))
		}
		return s.Write("progress", accountTaskProgressResponse{Completed: completed, Total: total, Phase: phase})
	}
}

func (s *accountEventStream) SyncProgressObserver() func(completed, total int) {
	return func(completed, total int) {
		_ = s.Write("progress", accountTaskProgressResponse{Completed: completed, Total: total, Phase: "syncing"})
	}
}

func (s *accountEventStream) WriteError(code, message string) {
	_ = s.Write("error", gin.H{"code": code, "message": message})
}

func (s *accountEventStream) Write(event string, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := setAccountWriteDeadline(s.context.Writer); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(s.context.Writer, "event: %s\ndata: %s\n\n", event, payload); err != nil {
		return err
	}
	s.context.Writer.Flush()
	return s.context.Request.Context().Err()
}

func (s *accountEventStream) writeComment(comment string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := setAccountWriteDeadline(s.context.Writer); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(s.context.Writer, ": %s\n\n", comment); err != nil {
		return err
	}
	s.context.Writer.Flush()
	return s.context.Request.Context().Err()
}

func (s *accountEventStream) heartbeat() {
	defer close(s.done)
	ticker := time.NewTicker(accountEventHeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-s.context.Request.Context().Done():
			return
		case <-ticker.C:
			if err := s.writeComment("heartbeat"); err != nil {
				return
			}
		}
	}
}

func (s *accountEventStream) Close() {
	s.closeOnce.Do(func() { close(s.stop) })
	<-s.done
}

func setAccountWriteDeadline(writer http.ResponseWriter) error {
	err := http.NewResponseController(writer).SetWriteDeadline(time.Now().Add(accountEventWriteTimeout))
	if errors.Is(err, http.ErrNotSupported) {
		return nil
	}
	return err
}

// writeAccountEvent keeps the event encoder independently testable without starting a heartbeat.
func writeAccountEvent(c *gin.Context, event string, value any) error {
	return (&accountEventStream{context: c}).Write(event, value)
}

func (h *Handler) syncInitial(ctx context.Context, accountIDs ...uint64) accountsyncapp.Result {
	if h.sync == nil {
		return accountsyncapp.Result{}
	}
	return h.sync.Sync(ctx, accountIDs...)
}
