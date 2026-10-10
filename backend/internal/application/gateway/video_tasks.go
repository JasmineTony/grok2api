package gateway

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/media"
	"github.com/chenyme/grok2api/backend/internal/domain/model"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	"github.com/chenyme/grok2api/backend/internal/pkg/batch"
)

// 视频任务生命周期：固定 Worker 的入队/认领/恢复与并发控制。
// RunVideoWorkers 使用固定 Worker 处理持久化任务，避免突发请求按任务创建无界 goroutine。
func (s *Service) RunVideoWorkers(ctx context.Context) {
	if s.mediaQueue == nil || s.mediaWorker <= 0 {
		return
	}
	var workers sync.WaitGroup
	workers.Add(s.mediaWorker)
	for range s.mediaWorker {
		go func() {
			defer workers.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case id := <-s.mediaQueue:
					err := batch.Do(ctx, func(workCtx context.Context) error {
						s.processVideoJob(workCtx, id)
						return nil
					})
					s.mediaMu.Lock()
					delete(s.mediaQueued, id)
					s.mediaMu.Unlock()
					if err != nil && ctx.Err() == nil {
						if panicErr, ok := err.(*batch.PanicError); ok {
							s.logger.Error("video_worker_panicked", "job_id", id, "error", panicErr, "stack", string(panicErr.Stack))
						} else {
							s.logger.Error("video_worker_failed", "job_id", id, "error", err)
						}
					}
				}
			}
		}()
	}
	workers.Wait()
}

func (s *Service) enqueueVideoJob(id string) bool {
	if id == "" || s.mediaQueue == nil {
		return false
	}
	s.mediaMu.Lock()
	if _, exists := s.mediaQueued[id]; exists {
		s.mediaMu.Unlock()
		return true
	}
	s.mediaQueued[id] = struct{}{}
	s.mediaMu.Unlock()
	select {
	case s.mediaQueue <- id:
		return true
	default:
		s.mediaMu.Lock()
		delete(s.mediaQueued, id)
		s.mediaMu.Unlock()
		full := s.mediaQueueFull.Add(1)
		if s.logger != nil && (full == 1 || full%100 == 0) {
			s.logger.Warn("video_queue_full", "count", full, "queued", len(s.mediaQueue), "capacity", cap(s.mediaQueue))
		}
		return false
	}
}

func (s *Service) processVideoJob(ctx context.Context, id string) {
	job, claimed, err := s.claimVideoJob(ctx, id)
	if err != nil {
		s.logger.Warn("video_job_claim_failed", "job_id", id, "error", err)
		return
	}
	if !claimed {
		return
	}
	var route model.Route
	if job.ModelRouteID != 0 {
		route, err = s.models.Get(ctx, job.ModelRouteID)
	} else {
		route, err = s.models.GetByPublicID(ctx, job.Model)
	}
	if err != nil {
		s.failVideoJob(ctx, job, "model_not_found", errors.New("模型路由不存在"), 0, nil)
		return
	}
	s.runVideoJob(ctx, job, route)
}

// RunVideoRecovery 周期认领新建后未启动或执行实例失联后的媒体任务。
func (s *Service) RunVideoRecovery(ctx context.Context) {
	ticker := time.NewTicker(videoJobRecoveryInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.RecoverVideoJobs(ctx); err != nil {
				s.logger.Warn("video_job_recovery_failed", "error", err)
			}
		}
	}
}

func (s *Service) claimVideoJob(ctx context.Context, id string) (media.Job, bool, error) {
	now := time.Now().UTC()
	claimToken, err := security.NewOpaqueToken(18)
	if err != nil {
		return media.Job{}, false, err
	}
	return s.mediaJobs.TryClaimMediaJob(ctx, id, now, now.Add(videoJobLease), claimToken)
}
