package gateway

import (
	"context"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	accountapp "github.com/chenyme/grok2api/backend/internal/application/account"
	clientkeyapp "github.com/chenyme/grok2api/backend/internal/application/clientkey"
	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	"github.com/chenyme/grok2api/backend/internal/infra/persistence/relational"
	providerregistry "github.com/chenyme/grok2api/backend/internal/infra/provider"
	"github.com/chenyme/grok2api/backend/internal/infra/runtime/memory"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// mediaAttemptLoopLimiter 记录每个账号并发槽位的真实获取次数。Acquire 每取中一个账号都会
// 通过该 limiter 申请槽位，因此计数是「本轮是否重新获取租约」的直接可观察证据；Current
// 恒返回 0，避免测试夹具自身制造饱和假象。
type mediaAttemptLoopLimiter struct {
	mu     sync.Mutex
	grants map[string]int
}

func newMediaAttemptLoopLimiter() *mediaAttemptLoopLimiter {
	return &mediaAttemptLoopLimiter{grants: make(map[string]int)}
}

func (l *mediaAttemptLoopLimiter) Acquire(_ context.Context, key string, _ int) (func(), bool, error) {
	l.mu.Lock()
	l.grants[key]++
	l.mu.Unlock()
	return func() {}, true, nil
}

func (l *mediaAttemptLoopLimiter) Current(_ context.Context, _ string) (int, error) { return 0, nil }

func (l *mediaAttemptLoopLimiter) CurrentMany(_ context.Context, keys []string) (map[string]int, error) {
	values := make(map[string]int, len(keys))
	for _, key := range keys {
		values[key] = 0
	}
	return values, nil
}

func (l *mediaAttemptLoopLimiter) leaseGrants(accountID uint64) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.grants[accountConcurrencyKey(accountID)]
}

// mediaAttemptLoopFixture 固定两个可用账号，直接驱动 runImageAttempts / runVoiceAttempts。
type mediaAttemptLoopFixture struct {
	ctx      context.Context
	service  *Service
	accounts repository.AccountRepository
	limiter  *mediaAttemptLoopLimiter
	key      clientkey.Key
	first    account.Credential
	second   account.Credential
}

func newMediaAttemptLoopFixture(t *testing.T, name, publicModel string, capability modeldomain.Capability, authType account.AuthType) *mediaAttemptLoopFixture {
	t.Helper()
	ctx := context.Background()
	database, err := relational.OpenSQLite(ctx, filepath.Join(t.TempDir(), name+".db"))
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
	responseRepo := relational.NewResponseRepository(database)
	credentials := make([]account.Credential, 0, 2)
	for index, credentialName := range []string{"attempt-first", "attempt-second"} {
		credential, _, createErr := accountRepo.UpsertByIdentity(ctx, account.Credential{
			Provider: account.ProviderBuild, AuthType: authType, Name: credentialName, SourceKey: credentialName,
			EncryptedAccessToken: credentialName, ExpiresAt: time.Now().Add(time.Hour),
			Enabled: true, AuthStatus: account.AuthStatusActive, Priority: 200 - index, MaxConcurrent: 1,
		})
		if createErr != nil {
			t.Fatal(createErr)
		}
		credentials = append(credentials, credential)
	}
	if err := modelRepo.UpsertRoutes(ctx, []modeldomain.Route{{
		PublicID: publicModel, Provider: account.ProviderBuild, UpstreamModel: publicModel,
		Capability: capability, Enabled: true,
	}}); err != nil {
		t.Fatal(err)
	}
	for _, credential := range credentials {
		if err := modelRepo.ReplaceAccountCapabilities(ctx, credential.ID, []string{publicModel}, time.Now().UTC()); err != nil {
			t.Fatal(err)
		}
	}
	// 空注册表：凭据不再需要刷新，EnsureCredential 原样放行，避免夹具行为干扰尝试循环。
	registry := providerregistry.NewRegistry()
	sticky := memory.NewStickyStore()
	limiter := newMediaAttemptLoopLimiter()
	accountService := accountapp.NewService(accountRepo, auditRepo, memory.NewDeviceSessionStore(), sticky, registry, testCipher(t), nil)
	selector := NewSelector(accountRepo, limiter, sticky, registry, time.Hour, time.Second, time.Minute)
	return &mediaAttemptLoopFixture{
		ctx: ctx, service: NewService(modelRepo, auditRepo, accountService, clientkeyapp.NewService(nil, nil, nil, 60, 4, nil), registry, selector, responseRepo, 3),
		accounts: accountRepo, limiter: limiter, key: clientkey.Key{},
		first: credentials[0], second: credentials[1],
	}
}

// mediaAttemptLoopTransportError 表示可重试的传输失败（非 response header timeout）。
type mediaAttemptLoopTransportError struct{}

func (mediaAttemptLoopTransportError) Error() string { return "simulated retryable transport failure" }

// TestRunVoiceAttemptsReacquiresLeaseAfterRetryableAttemptError 固定 voice 尝试循环在
// 「可重试失败 → 换号」路径上的正确行为：每轮的租约获取必须独立于上一轮的上游错误，
// 否则账号池中仍有健康账号时也会被误判为耗尽（返回 503 ErrNoAvailableAccount）。
// 回归背景：曾出现 err 在循环外声明且每轮不重置，导致后续轮次的 Acquire 被跳过。
func TestRunVoiceAttemptsReacquiresLeaseAfterRetryableAttemptError(t *testing.T) {
	t.Run("sso credential rejection switches to the second account", func(t *testing.T) {
		fixture := newMediaAttemptLoopFixture(t, "voice-attempt", "grok-voice-attempt", modeldomain.CapabilityTTS, account.AuthTypeSSO)
		executed := []uint64{}
		plan := voiceExecutionPlan{
			key:    fixture.key,
			route:  modeldomain.Route{ID: 1, Provider: account.ProviderBuild, PublicID: "grok-voice-attempt", UpstreamModel: "grok-voice-attempt"},
			policy: newRoutingAttemptPolicy(3),
			execute: func(_ context.Context, _ account.Provider, credential account.Credential, _ string) (voiceExecutionResult, error) {
				executed = append(executed, credential.ID)
				if credential.ID == fixture.first.ID {
					return voiceExecutionResult{}, provider.ErrUnauthorized
				}
				return voiceExecutionResult{response: &provider.Response{
					StatusCode: http.StatusOK, Status: "200 OK",
					Header: make(http.Header), Body: io.NopCloser(strings.NewReader("ok")),
				}}, nil
			},
		}
		state, err := fixture.service.runVoiceAttempts(fixture.ctx, plan)

		if err != nil {
			t.Fatalf("error = %v, want nil (第二个账号应被真正尝试并成功)", err)
		}
		if len(executed) != 2 || executed[0] != fixture.first.ID || executed[1] != fixture.second.ID {
			t.Fatalf("executed accounts = %v, want first then second", executed)
		}
		if state.outcome.response == nil || state.outcome.response.StatusCode != http.StatusOK {
			t.Fatalf("outcome response = %#v, want the second account's 200", state.outcome.response)
		}
		if state.outcome.credential.ID != fixture.second.ID {
			t.Fatalf("outcome credential = %d, want %d", state.outcome.credential.ID, fixture.second.ID)
		}
		if state.outcome.lease == nil || state.outcome.lease.Credential.ID != fixture.second.ID {
			t.Fatalf("outcome lease = %#v, want a fresh lease on %d", state.outcome.lease, fixture.second.ID)
		}
		// 关键证据：第二个账号被真正租用，说明下一轮确实执行了 Acquire。
		if grants := fixture.limiter.leaseGrants(fixture.second.ID); grants != 1 {
			t.Fatalf("second account lease grants = %d, want 1", grants)
		}
		if _, excluded := state.excluded[fixture.first.ID]; !excluded {
			t.Fatalf("first account must stay excluded after SSO rejection (excluded=%v)", state.excluded)
		}
	})

	t.Run("retryable transport failure retries the same account", func(t *testing.T) {
		fixture := newMediaAttemptLoopFixture(t, "voice-transport", "grok-voice-transport", modeldomain.CapabilityTTS, account.AuthTypeOAuth)
		executed := []uint64{}
		plan := voiceExecutionPlan{
			key:    fixture.key,
			route:  modeldomain.Route{ID: 1, Provider: account.ProviderBuild, PublicID: "grok-voice-transport", UpstreamModel: "grok-voice-transport"},
			policy: newRoutingAttemptPolicy(3),
			execute: func(_ context.Context, _ account.Provider, credential account.Credential, _ string) (voiceExecutionResult, error) {
				executed = append(executed, credential.ID)
				return voiceExecutionResult{}, mediaAttemptLoopTransportError{}
			},
		}
		state, err := fixture.service.runVoiceAttempts(fixture.ctx, plan)

		// 传输失败绑定在出口上：重试的是同一账号，而不是把它冷却后换号。
		if err == nil {
			t.Fatal("error = nil, want the terminal transport failure after attempts are exhausted")
		}
		if errors.Is(err, ErrNoAvailableAccount) {
			t.Fatalf("error = %v, want the transport failure rather than pool exhaustion", err)
		}
		if len(executed) != 3 {
			t.Fatalf("executed attempts = %v, want 3 attempts on the same account", executed)
		}
		for index, accountID := range executed {
			if accountID != fixture.first.ID {
				t.Fatalf("attempt %d ran on account %d, want the same account %d", index, accountID, fixture.first.ID)
			}
		}
		if grants := fixture.limiter.leaseGrants(fixture.first.ID); grants != 3 {
			t.Fatalf("first account lease grants = %d, want 3 (Acquire 必须在每轮真实执行)", grants)
		}
		// 末轮已无重试预算，账号保留在 excluded 中属终态；关键是它此前被反复重试。
		if _, excluded := state.excluded[fixture.first.ID]; !excluded {
			t.Fatalf("first account must remain excluded after the final attempt (excluded=%v)", state.excluded)
		}
	})
}

// TestRunImageAttemptsRetryableAttemptErrorSwitchesAccount 固定 image 尝试循环在
// 「可重试失败 → 换号」路径上的行为：SSO 凭据被拒要求换号时，第二个账号必须被真正租用
// 并尝试；transport 失败按既有设计是终态（handleImageExecutionFailure 不重试 transport），
// 直接以 502 结束，不应表现为「账号池耗尽」。
// 回归背景：曾出现 err 在循环外声明且每轮不重置，导致 SSO 换号路径跳过第二轮的 Acquire。
func TestRunImageAttemptsRetryableAttemptErrorSwitchesAccount(t *testing.T) {
	t.Run("sso rejection switches to the second account", func(t *testing.T) {
		fixture := newMediaAttemptLoopFixture(t, "image-attempt", "grok-image-attempt", modeldomain.CapabilityImage, account.AuthTypeSSO)
		executed := []uint64{}
		plan := imageExecutionPlan{
			requestID: "req-image-attempt", eventID: "evt-image-attempt", externalModel: "grok-image-attempt",
			key:    fixture.key,
			route:  modeldomain.Route{ID: 1, Provider: account.ProviderBuild, PublicID: "grok-image-attempt", UpstreamModel: "grok-image-attempt"},
			policy: newRoutingAttemptPolicy(3),
			execute: func(_ context.Context, _ account.Provider, credential account.Credential, _ string) (*provider.Response, error) {
				executed = append(executed, credential.ID)
				if credential.ID == fixture.first.ID {
					return nil, provider.ErrUnauthorized
				}
				return &provider.Response{
					StatusCode: http.StatusOK, Status: "200 OK",
					Header: make(http.Header), Body: io.NopCloser(strings.NewReader("ok")),
				}, nil
			},
		}
		outcome, err := fixture.service.runImageAttempts(fixture.ctx, plan)

		if err != nil {
			t.Fatalf("error = %v, want nil (第二个账号应被真正尝试并成功)", err)
		}
		if len(executed) != 2 || executed[0] != fixture.first.ID || executed[1] != fixture.second.ID {
			t.Fatalf("executed accounts = %v, want first then second", executed)
		}
		if outcome.response == nil || outcome.response.StatusCode != http.StatusOK {
			t.Fatalf("outcome response = %#v, want the second account's 200", outcome.response)
		}
		if outcome.credential.ID != fixture.second.ID {
			t.Fatalf("outcome credential = %d, want %d", outcome.credential.ID, fixture.second.ID)
		}
		// 关键证据：第二个账号被真正租用，说明下一轮确实执行了 Acquire。
		if grants := fixture.limiter.leaseGrants(fixture.second.ID); grants != 1 {
			t.Fatalf("second account lease grants = %d, want 1", grants)
		}
	})

	t.Run("transport failure stays terminal with 502", func(t *testing.T) {
		fixture := newMediaAttemptLoopFixture(t, "image-transport", "grok-image-transport", modeldomain.CapabilityImage, account.AuthTypeOAuth)
		executed := []uint64{}
		plan := imageExecutionPlan{
			requestID: "req-image-transport", eventID: "evt-image-transport", externalModel: "grok-image-transport",
			key:    fixture.key,
			route:  modeldomain.Route{ID: 1, Provider: account.ProviderBuild, PublicID: "grok-image-transport", UpstreamModel: "grok-image-transport"},
			policy: newRoutingAttemptPolicy(3),
			execute: func(_ context.Context, _ account.Provider, credential account.Credential, _ string) (*provider.Response, error) {
				executed = append(executed, credential.ID)
				return nil, mediaAttemptLoopTransportError{}
			},
		}
		outcome, err := fixture.service.runImageAttempts(fixture.ctx, plan)

		if len(executed) != 1 || executed[0] != fixture.first.ID {
			t.Fatalf("executed accounts = %v, want only the first account %d", executed, fixture.first.ID)
		}
		// transport 失败是终态：返回上游错误本身，而不是「账号池耗尽」。
		if err == nil {
			t.Fatal("error = nil, want the terminal transport failure")
		}
		if errors.Is(err, ErrNoAvailableAccount) {
			t.Fatalf("error = %v, want a terminal transport failure rather than pool exhaustion", err)
		}
		if outcome.failureStatus != http.StatusBadGateway || outcome.failureCode != "upstream_unavailable" {
			t.Fatalf("failure = (%d, %q), want (%d, %q)", outcome.failureStatus, outcome.failureCode, http.StatusBadGateway, "upstream_unavailable")
		}
		if outcome.response != nil {
			t.Fatalf("outcome response = %#v, want none", outcome.response)
		}
	})
}
