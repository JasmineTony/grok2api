package gateway

import (
	"context"
	"io"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	accountapp "github.com/chenyme/grok2api/backend/internal/application/account"
	clientkeyapp "github.com/chenyme/grok2api/backend/internal/application/clientkey"
	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/domain/audit"
	"github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	"github.com/chenyme/grok2api/backend/internal/infra/persistence/relational"
	"github.com/chenyme/grok2api/backend/internal/infra/provider"
	"github.com/chenyme/grok2api/backend/internal/infra/runtime/memory"
)

const (
	// voiceBillingSTTModel 是本用例的 Console STT 路由。
	voiceBillingSTTModel = "voice-billing-stt"
	// voiceBillingQuotaMode 与真实 Console 适配器的 console.QuotaMode 取值一致，
	// 让结算走与生产相同的额度口径（provider/console/catalog.go 的 QuotaMode）。
	voiceBillingQuotaMode = "console"
	// voiceBillingQuotaTotal 是预置的账号额度窗口容量，用于回读扣减结果。
	voiceBillingQuotaTotal = 5
)

// voiceBillingConn 是纯内存的上游 voice websocket；本用例只验证结算，不驱动真实代理。
type voiceBillingConn struct{}

func (voiceBillingConn) ReadMessage() (int, []byte, error) { return 0, nil, io.EOF }
func (voiceBillingConn) WriteMessage(int, []byte) error    { return nil }
func (voiceBillingConn) SetReadLimit(int64)                {}
func (voiceBillingConn) Close() error                      { return nil }

// voiceBillingConsoleAdapter 完整实现 Adapter / DefinitionAdapter /
// VoiceWebSocketAdapter / RoutingMetadataAdapter，不触达任何真实上游。
type voiceBillingConsoleAdapter struct {
	mu    sync.Mutex
	dials []provider.VoiceWebSocketRequest
}

func (a *voiceBillingConsoleAdapter) Provider() account.Provider { return account.ProviderConsole }

func (a *voiceBillingConsoleAdapter) Definition() provider.Definition {
	definition := testConversationDefinition(account.ProviderConsole)
	definition.Media.STT = true
	return definition
}

func (a *voiceBillingConsoleAdapter) QuotaMode(string) string { return voiceBillingQuotaMode }

func (a *voiceBillingConsoleAdapter) TierOrder(string) []account.WebTier { return nil }

func (a *voiceBillingConsoleAdapter) DialVoiceWebSocket(_ context.Context, request provider.VoiceWebSocketRequest) (provider.VoiceWebSocketConn, func(), error) {
	a.mu.Lock()
	a.dials = append(a.dials, request)
	a.mu.Unlock()
	return voiceBillingConn{}, func() {}, nil
}

func (a *voiceBillingConsoleAdapter) Dials() []provider.VoiceWebSocketRequest {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]provider.VoiceWebSocketRequest(nil), a.dials...)
}

type voiceBillingHarness struct {
	service     *Service
	accountRepo *relational.AccountRepository
	auditRepo   *relational.AuditRepository
	adapter     *voiceBillingConsoleAdapter
	key         clientkey.Key
	accountID   uint64
}

func newVoiceBillingHarness(t *testing.T) *voiceBillingHarness {
	t.Helper()
	ctx := context.Background()
	database, err := relational.OpenSQLite(ctx, filepath.Join(t.TempDir(), "voice-ws-billing.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if err := database.InitializeSchema(ctx); err != nil {
		t.Fatal(err)
	}

	accountRepo := relational.NewAccountRepository(database)
	modelRepo := relational.NewModelRepository(database)
	auditRepo := relational.NewAuditRepository(database)
	keyRepo := relational.NewClientKeyRepository(database)
	credential, _, err := accountRepo.UpsertByIdentity(ctx, account.Credential{
		Provider: account.ProviderConsole, AuthType: account.AuthTypeSSO,
		Name: "console-stt-billing", SourceKey: "console-stt-billing", EncryptedAccessToken: "console-token",
		Enabled: true, AuthStatus: account.AuthStatusActive, MaxConcurrent: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := modelRepo.UpsertRoutes(ctx, []modeldomain.Route{{
		PublicID: voiceBillingSTTModel, Provider: account.ProviderConsole, UpstreamModel: voiceBillingSTTModel,
		Capability: modeldomain.CapabilitySTT, Enabled: true,
	}}); err != nil {
		t.Fatal(err)
	}
	if err := modelRepo.ReplaceAccountCapabilities(ctx, credential.ID, []string{voiceBillingSTTModel}, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	// 预置额度窗口，DecrementQuota 才能真实扣减并在结算后回读。
	if err := accountRepo.SaveQuotaWindows(ctx, credential.ID, "", time.Now().UTC(), []account.QuotaWindow{{
		Mode: voiceBillingQuotaMode, Remaining: voiceBillingQuotaTotal, Total: voiceBillingQuotaTotal, WindowSeconds: 3600,
	}}); err != nil {
		t.Fatal(err)
	}
	key, err := keyRepo.Create(ctx, clientkey.Key{
		Name: "voice-stt-billing-key", Prefix: "vsb", SecretHash: strings.Repeat("c", 64), EncryptedSecret: "encrypted",
		Enabled: true, BillingLimitUSDTicks: 10_000_000_000,
	})
	if err != nil {
		t.Fatal(err)
	}

	adapter := &voiceBillingConsoleAdapter{}
	registry := provider.NewRegistry(adapter)
	sticky := memory.NewStickyStore()
	accountService := accountapp.NewService(accountRepo, auditRepo, memory.NewDeviceSessionStore(), sticky, registry, testCipher(t), nil)
	selector := NewSelector(accountRepo, memory.NewConcurrencyLimiter(), sticky, registry, time.Hour, time.Second, time.Minute)
	service := NewService(modelRepo, auditRepo, accountService, clientkeyapp.NewService(keyRepo, nil, nil, 60, 4, nil), registry, selector, nil, 1)
	return &voiceBillingHarness{
		service: service, accountRepo: accountRepo, auditRepo: auditRepo,
		adapter: adapter, key: key, accountID: credential.ID,
	}
}

func (h *voiceBillingHarness) openSTTSession(t *testing.T, requestID string) *VoiceWebSocketSession {
	t.Helper()
	session, err := h.service.OpenVoiceWebSocket(context.Background(), VoiceWebSocketInput{
		RequestID: requestID, ClientKey: h.key, PublicModel: voiceBillingSTTModel, Path: "/stt",
	})
	if err != nil {
		t.Fatalf("OpenVoiceWebSocket 失败: %v", err)
	}
	if session == nil || session.Operation != audit.OperationSTT || session.AccountID != h.accountID {
		t.Fatalf("STT 会话 = %#v", session)
	}
	if dials := h.adapter.Dials(); len(dials) != 1 || dials[0].Path != "/stt" {
		t.Fatalf("上游拨号 = %#v, want 单次 /stt", dials)
	}
	return session
}

func (h *voiceBillingHarness) auditRecord(t *testing.T, requestID string) audit.Record {
	t.Helper()
	records, _, err := h.auditRepo.List(context.Background(), 0, 20)
	if err != nil {
		t.Fatal(err)
	}
	for _, record := range records {
		if record.RequestID == requestID {
			return record
		}
	}
	t.Fatalf("未找到 request_id=%s 的审计记录", requestID)
	return audit.Record{}
}

func (h *voiceBillingHarness) quotaRemaining(t *testing.T) int {
	t.Helper()
	windows, err := h.accountRepo.GetQuotaWindows(context.Background(), []uint64{h.accountID})
	if err != nil {
		t.Fatal(err)
	}
	for _, window := range windows[h.accountID] {
		if window.Mode == voiceBillingQuotaMode {
			return window.Remaining
		}
	}
	t.Fatalf("账号 %d 缺少 %s 额度窗口", h.accountID, voiceBillingQuotaMode)
	return 0
}

// TestVoiceWebSocketSTTSettlesConfirmedUsageAfterClientInterruption 覆盖 issue #1072：
// 上游已确认时长后客户端异常断开，key 计费与账号额度扣减必须按同一口径推进。
func TestVoiceWebSocketSTTSettlesConfirmedUsageAfterClientInterruption(t *testing.T) {
	t.Parallel()
	harness := newVoiceBillingHarness(t)
	harness.openSTTSession(t, "req-stt-interrupted").
		Finalize(VoiceWebSocketOutcome{ErrorCode: "client_stream_interrupted", AudioDurationSeconds: 12.5})

	pricing, priced := audit.EstimateOfficialSTTCost(12.5, true)
	if !priced {
		t.Fatal("STT 计费不可用")
	}
	record := harness.auditRecord(t, "req-stt-interrupted")
	if record.ErrorCode != "client_stream_interrupted" {
		t.Fatalf("审计错误码 = %q, want client_stream_interrupted", record.ErrorCode)
	}
	if record.EstimatedCostInUSDTicks != pricing.CostInUSDTicks || record.EstimatedCostInUSDTicks <= 0 {
		t.Fatalf("审计计费 = %d, want %d（>0）", record.EstimatedCostInUSDTicks, pricing.CostInUSDTicks)
	}
	if record.PricingModel != pricing.Model {
		t.Fatalf("审计计价模型 = %q, want %q", record.PricingModel, pricing.Model)
	}
	// usageConfirmed 同时门控审计计费与额度扣减，两者必须口径一致。
	if remaining := harness.quotaRemaining(t); remaining != voiceBillingQuotaTotal-1 {
		t.Fatalf("账号额度剩余 = %d, want %d", remaining, voiceBillingQuotaTotal-1)
	}
}

// TestVoiceWebSocketSTTWithoutConfirmedDurationIsUnpriced 覆盖无已确认时长的负例：
// 审计计费必须为 0；客户端中途断开时账号额度也不得扣减。
func TestVoiceWebSocketSTTWithoutConfirmedDurationIsUnpriced(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name               string
		errorCode          string
		duration           float64
		checkQuota         bool
		wantQuotaRemaining int
	}{
		{
			name: "客户端中途断开且无确认时长", errorCode: "client_stream_interrupted",
			checkQuota: true, wantQuotaRemaining: voiceBillingQuotaTotal,
		},
		{name: "正常完成且无确认时长", errorCode: ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			harness := newVoiceBillingHarness(t)
			harness.openSTTSession(t, "req-stt-unpriced").
				Finalize(VoiceWebSocketOutcome{ErrorCode: test.errorCode, AudioDurationSeconds: test.duration})

			record := harness.auditRecord(t, "req-stt-unpriced")
			if record.EstimatedCostInUSDTicks != 0 {
				t.Fatalf("无确认时长的审计计费 = %d, want 0", record.EstimatedCostInUSDTicks)
			}
			if test.checkQuota {
				if remaining := harness.quotaRemaining(t); remaining != test.wantQuotaRemaining {
					t.Fatalf("账号额度剩余 = %d, want %d", remaining, test.wantQuotaRemaining)
				}
			}
		})
	}
}
