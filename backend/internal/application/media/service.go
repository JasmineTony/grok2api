package media

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/chenyme/grok2api/backend/internal/repository"
)

var (
	ErrAssetNotFound         = errors.New("媒体资源不存在")
	ErrInvalidImage          = errors.New("图片内容无效")
	ErrInvalidImageSelection = errors.New("图片选择无效")
	ErrInvalidVideoSelection = errors.New("视频任务选择无效")
	ErrActiveVideoSelection  = errors.New("排队中或生成中的视频任务不能删除")
	ErrInvalidFilter         = errors.New("媒体筛选条件无效")
	ErrMediaJobsUnavailable  = errors.New("视频任务仓储未配置")
	ErrInputAssetNotFound    = errors.New("临时输入资产不存在或已过期")
	ErrMediaCapacity         = errors.New("媒体存储容量不足")
)

// Service 负责图片/视频校验、文件落盘和元数据持久化的一致性收口。
type Service struct {
	assets        repository.MediaAssetRepository
	jobs          repository.MediaJobRepository
	tickets       repository.MediaUploadTicketRepository
	objects       repository.MediaObjectStorage
	cleanupLock   repository.DistributedLock
	publicBaseURL string
	configMu      sync.RWMutex
	maxImageBytes int64
	maxTotalBytes int64
	cleanupAt     int
	cleanupEvery  time.Duration
	cleanupSignal chan struct{}
	configChanged chan struct{}
	totalBytes    atomic.Int64
	inputSaveMu   sync.Mutex
}

type Config struct {
	PublicBaseURL           string
	MaxImageBytes           int64
	MaxTotalBytes           int64
	CleanupThresholdPercent int
	CleanupInterval         time.Duration
}

type ImageStats struct {
	TotalImages int64
	TotalBytes  int64
}

type VideoStats struct {
	TotalJobs  int64
	Completed  int64
	Failed     int64
	InProgress int64
	Queued     int64
}

func NewService(assets repository.MediaAssetRepository, jobs repository.MediaJobRepository, objects repository.MediaObjectStorage, cleanupLock repository.DistributedLock, cfg Config) *Service {
	return NewServiceWithTickets(assets, jobs, nil, objects, cleanupLock, cfg)
}

// NewServiceWithTickets 构造包含视频上传票据能力的媒体服务。
func NewServiceWithTickets(assets repository.MediaAssetRepository, jobs repository.MediaJobRepository, tickets repository.MediaUploadTicketRepository, objects repository.MediaObjectStorage, cleanupLock repository.DistributedLock, cfg Config) *Service {
	return &Service{
		assets: assets, jobs: jobs, tickets: tickets, objects: objects, cleanupLock: cleanupLock,
		publicBaseURL: strings.TrimRight(strings.TrimSpace(cfg.PublicBaseURL), "/"), maxImageBytes: cfg.MaxImageBytes,
		maxTotalBytes: cfg.MaxTotalBytes, cleanupAt: cfg.CleanupThresholdPercent, cleanupEvery: cfg.CleanupInterval,
		cleanupSignal: make(chan struct{}, 1), configChanged: make(chan struct{}, 1),
	}
}

// UpdateConfig 热更新媒体容量和清理策略，不重建底层存储实例。
func (s *Service) UpdateConfig(cfg Config) {
	s.configMu.Lock()
	s.publicBaseURL = strings.TrimRight(strings.TrimSpace(cfg.PublicBaseURL), "/")
	s.maxImageBytes = cfg.MaxImageBytes
	s.maxTotalBytes = cfg.MaxTotalBytes
	s.cleanupAt = cfg.CleanupThresholdPercent
	s.cleanupEvery = cfg.CleanupInterval
	s.configMu.Unlock()
	select {
	case s.configChanged <- struct{}{}:
	default:
	}
}

func (s *Service) runtimeConfig() Config {
	s.configMu.RLock()
	defer s.configMu.RUnlock()
	return Config{
		PublicBaseURL: s.publicBaseURL,
		MaxImageBytes: s.maxImageBytes, MaxTotalBytes: s.maxTotalBytes,
		CleanupThresholdPercent: s.cleanupAt, CleanupInterval: s.cleanupEvery,
	}
}

func cleanupThresholdBytes(cfg Config) int64 {
	return cfg.MaxTotalBytes * int64(cfg.CleanupThresholdPercent) / 100
}

// newAssetID 生成带业务前缀的高熵资源 ID，图片与视频资产共用同一命名规则。
func newAssetID(prefix string) (string, error) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("生成媒体资源 ID: %w", err)
	}
	return prefix + base64.RawURLEncoding.EncodeToString(raw), nil
}
