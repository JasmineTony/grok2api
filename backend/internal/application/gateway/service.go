package gateway

import (
	"errors"
	"time"
)

var (
	ErrModelNotFound              = errors.New("模型不存在或未启用")
	ErrNoAvailableAccount         = errors.New("没有可用上游账号")
	ErrResponseNotFound           = errors.New("Response 不存在或已过期")
	ErrResponseAccountUnavailable = errors.New("Response 绑定的上游账号不可用")
	ErrResponseStateUnsupported   = errors.New("目标模型不支持有状态 Response")
	ErrConversationUnsupported    = errors.New("目标模型不支持当前对话协议")
	ErrVideoInputTooLarge         = errors.New("视频参考图片编码后总输入超过 32 MiB")
	ErrVideoInputUnavailable      = errors.New("视频临时输入不存在或已过期")
	ErrVideoParameterInvalid      = errors.New("视频请求参数无效")
	ErrVideoOperationUnsupported  = errors.New("视频编辑/延长仅支持路由到 Console grok-imagine-video")
	ErrLedgerUnavailable          = errors.New("计费账本暂不可用")
)

const responseOwnershipTTL = 30 * 24 * time.Hour
const finalizationTimeout = 5 * time.Second
const minimumTextBillingReservationTTL = 2 * time.Hour
const billingReservationCrashGrace = 10 * time.Minute
const mediaBillingReservationTTL = 24 * time.Hour
const modelCatalogRefreshTimeout = 30 * time.Second
const accountStateWriteTimeout = 3 * time.Second
const unlimitedRoutingAttempts = -1
