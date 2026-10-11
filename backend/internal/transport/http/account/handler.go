package account

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	accountapp "github.com/chenyme/grok2api/backend/internal/application/account"
	accountsyncapp "github.com/chenyme/grok2api/backend/internal/application/accountsync"
	"github.com/gin-gonic/gin"
)

type accountSynchronizer interface {
	Sync(ctx context.Context, accountIDs ...uint64) accountsyncapp.Result
	SyncStream(ctx context.Context, accountIDs <-chan uint64) accountsyncapp.Result
}

type accountSyncProgressor interface {
	SyncStreamObserved(ctx context.Context, accountIDs <-chan uint64, observer func(completed, total int)) accountsyncapp.Result
}

type accountModelSynchronizer interface {
	SyncModels(ctx context.Context, accountID uint64) error
}

const (
	maxAccountImportBytes         = 30 << 20
	maxAccountImportFiles         = 1000
	accountSyncQueueCapacity      = 20
	accountEventHeartbeatInterval = 15 * time.Second
	accountEventWriteTimeout      = 30 * time.Second
)

type Handler struct {
	service *accountapp.Service
	sync    accountSynchronizer
}

type accountSyncPipeline struct {
	ctx        context.Context
	cancel     context.CancelFunc
	ids        chan uint64
	done       chan accountsyncapp.Result
	progress   func(completed, total int)
	progressMu sync.Mutex
	queued     atomic.Int64
	completed  atomic.Int64
}

func NewHandler(service *accountapp.Service, sync accountSynchronizer) *Handler {
	return &Handler{service: service, sync: sync}
}

func (h *Handler) startSyncPipeline(parent context.Context, progress func(completed, total int)) *accountSyncPipeline {
	ctx, cancel := context.WithCancel(parent)
	pipeline := &accountSyncPipeline{ctx: ctx, cancel: cancel, progress: progress}
	if h.sync == nil {
		return pipeline
	}
	pipeline.ids = make(chan uint64, accountSyncQueueCapacity)
	pipeline.done = make(chan accountsyncapp.Result, 1)
	go func() {
		if observed, ok := h.sync.(accountSyncProgressor); ok && progress != nil {
			pipeline.done <- observed.SyncStreamObserved(ctx, pipeline.ids, func(completed, _ int) {
				pipeline.completed.Store(int64(completed))
				pipeline.reportProgress()
			})
			return
		}
		pipeline.done <- h.sync.SyncStream(ctx, pipeline.ids)
	}()
	return pipeline
}

func (p *accountSyncPipeline) Observe(accountID uint64) error {
	if p.ids == nil {
		return nil
	}
	p.queued.Add(1)
	select {
	case p.ids <- accountID:
		return nil
	case <-p.ctx.Done():
		p.queued.Add(-1)
		return p.ctx.Err()
	}
}

func (p *accountSyncPipeline) Finish(abort bool) accountsyncapp.Result {
	if abort {
		p.cancel()
	}
	if p.ids != nil {
		close(p.ids)
	}
	if !abort {
		// 转换阶段结束后不再增加同步任务，先报告一次固定分母，避免前端看到总数跳变。
		p.reportProgress()
	}
	result := accountsyncapp.Result{}
	if p.done != nil {
		result = <-p.done
	}
	if !abort && p.ids != nil {
		p.completed.Store(int64(result.Succeeded + result.Failed))
		p.reportProgress()
	}
	p.cancel()
	return result
}

// reportProgress 使用已进入同步流水线的任务数报告进度；转换结束后该分母保持固定。
func (p *accountSyncPipeline) reportProgress() {
	if p.ids == nil || p.progress == nil {
		return
	}
	p.progressMu.Lock()
	defer p.progressMu.Unlock()
	p.progress(int(p.completed.Load()), int(p.queued.Load()))
}

func (h *Handler) Register(router *gin.RouterGroup) {
	router.GET("/accounts", h.list)
	router.GET("/accounts/summary", h.summary)
	router.GET("/accounts/export", h.exportCredentials)
	router.POST("/accounts/export", h.exportSelectedCredentials)
	router.GET("/accounts/:id", h.get)
	router.POST("/accounts/device/start", h.startDevice)
	router.POST("/accounts/device/:sessionId/poll", h.pollDevice)
	router.POST("/accounts/import", h.importAuth)
	router.POST("/accounts/web/import", h.importWebAuth)
	router.POST("/accounts/console/import", h.importConsoleAuth)
	router.POST("/accounts/web/convert-to-build", h.convertWebToBuild)
	router.POST("/accounts/web/sync-to-console", h.syncWebToConsole)
	router.POST("/accounts/web/run-scripts", h.runWebAccountScripts)
	router.POST("/accounts/web/refresh-quotas", h.refreshAllWebQuotas)
	router.POST("/accounts/web/:id/accept-terms", h.acceptWebTerms)
	router.POST("/accounts/web/:id/birth-date", h.setWebBirthDate)
	router.POST("/accounts/web/:id/nsfw", h.enableWebNSFW)
	router.POST("/accounts/console/refresh-quotas", h.refreshAllConsoleQuotas)
	router.POST("/accounts/refresh-billing", h.refreshAllBilling)
	router.POST("/accounts/reset-quota", h.resetAllBuildQuota)
	router.POST("/accounts/refresh-tokens", h.refreshAllTokens)
	router.POST("/accounts/cleanup", h.cleanup)
	router.POST("/accounts/cleanup-preview", h.cleanupPreview)
	router.POST("/accounts/batch/refresh-billing", h.batchRefreshBilling)
	router.POST("/accounts/batch/reset-quota", h.batchResetQuota)
	router.POST("/accounts/batch/refresh-quotas", h.batchRefreshQuotas)
	router.POST("/accounts/batch/refresh-tokens", h.batchRefreshTokens)
	router.POST("/accounts/detect", h.detectBuildAccounts)
	router.PATCH("/accounts/batch", h.batchUpdate)
	router.POST("/accounts/deletion-preview", h.previewDeletion)
	router.DELETE("/accounts", h.batchDelete)
	router.PATCH("/accounts/:id", h.update)
	router.DELETE("/accounts/:id", h.delete)
	router.POST("/accounts/:id/clear-cooldown", h.clearCooldown)
	router.POST("/accounts/:id/refresh-token", h.refreshToken)
	router.POST("/accounts/:id/refresh-billing", h.refreshBilling)
	router.POST("/accounts/:id/refresh-quota", h.refreshWebQuota)
}
