package gateway

import (
	"context"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	accountapp "github.com/chenyme/grok2api/backend/internal/application/account"
	clientkeyapp "github.com/chenyme/grok2api/backend/internal/application/clientkey"
	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	"github.com/chenyme/grok2api/backend/internal/domain/media"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	"github.com/chenyme/grok2api/backend/internal/infra/persistence/relational"
	"github.com/chenyme/grok2api/backend/internal/infra/provider"
	"github.com/chenyme/grok2api/backend/internal/infra/runtime/memory"
)

// videoScopeHarness 是「视频任务重试必须留在 client key 账号范围内」用例的公共装配。
type videoScopeHarness struct {
	service   *Service
	mediaRepo *relational.MediaJobRepository
	route     modeldomain.Route
	adapter   *videoCreateFailoverAdapter
	super     account.Credential
	free      account.Credential
	key       clientkey.Key
}

func newVideoScopeHarness(t *testing.T, keyScope clientkey.AccountScope) *videoScopeHarness {
	t.Helper()
	ctx := context.Background()
	database, err := relational.OpenSQLite(ctx, filepath.Join(t.TempDir(), "video-account-scope.db"))
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
	mediaRepo := relational.NewMediaJobRepository(database)
	keyRepo := relational.NewClientKeyRepository(database)
	createAccount := func(name string, tier account.WebTier, priority int) account.Credential {
		credential, _, createErr := accountRepo.UpsertByIdentity(ctx, account.Credential{
			Provider: account.ProviderWeb, AuthType: account.AuthTypeSSO, WebTier: tier,
			Name: name, SourceKey: name, EncryptedAccessToken: name + "-token", ExpiresAt: time.Now().Add(time.Hour),
			Enabled: true, AuthStatus: account.AuthStatusActive, Priority: priority, MaxConcurrent: 1,
		})
		if createErr != nil {
			t.Fatal(createErr)
		}
		return credential
	}
	super := createAccount("scope-super", account.WebTierSuper, 200)
	free := createAccount("scope-free", account.WebTierBasic, 100)
	if err := modelRepo.UpsertDiscovered(ctx, account.ProviderWeb, []string{"grok-imagine-video"}); err != nil {
		t.Fatal(err)
	}
	for _, accountID := range []uint64{super.ID, free.ID} {
		if err := modelRepo.ReplaceAccountCapabilities(ctx, accountID, []string{"grok-imagine-video"}, time.Now().UTC()); err != nil {
			t.Fatal(err)
		}
	}
	route, err := modelRepo.GetByProviderUpstream(ctx, account.ProviderWeb, "grok-imagine-video")
	if err != nil {
		t.Fatal(err)
	}
	key, err := keyRepo.Create(ctx, clientkey.Key{
		Name: "video-scope-key", Prefix: "vscope", SecretHash: strings.Repeat("d", 64), EncryptedSecret: "encrypted",
		Enabled: true, RPMLimit: 60, MaxConcurrent: 4,
		ProviderScope: keyScope.Providers, TierScope: keyScope.Tiers,
	})
	if err != nil {
		t.Fatal(err)
	}

	adapter := &videoCreateFailoverAdapter{failures: map[uint64]int{}, status: http.StatusForbidden}
	registry := provider.NewRegistry(adapter)
	sticky := memory.NewStickyStore()
	accountService := accountapp.NewService(accountRepo, auditRepo, memory.NewDeviceSessionStore(), sticky, registry, testCipher(t), nil)
	selector := NewSelector(accountRepo, memory.NewConcurrencyLimiter(), sticky, registry, time.Hour, time.Second, time.Minute)
	service := NewService(modelRepo, auditRepo, accountService, clientkeyapp.NewService(keyRepo, nil, nil, 60, 4, nil), registry, selector, nil, 3)
	service.ConfigureMedia(mediaRepo, 1)
	service.UpdateVideoMaxAttempts(10)
	return &videoScopeHarness{
		service: service, mediaRepo: mediaRepo, route: route, adapter: adapter,
		super: super, free: free, key: key,
	}
}

func (h *videoScopeHarness) newJob(t *testing.T, id string, pinned account.Credential) media.Job {
	t.Helper()
	now := time.Now().UTC()
	job := media.Job{
		ID: id, RequestID: "request-" + id, ClientKeyID: h.key.ID, ClientKeyName: h.key.Name,
		AccountID: pinned.ID, AccountName: pinned.Name, Provider: string(account.ProviderWeb),
		Model: h.route.PublicID, ModelRouteID: h.route.ID, UpstreamModel: h.route.UpstreamModel,
		Operation: provider.VideoOperationGenerate, Prompt: "test", Seconds: 5, Quality: "720p",
		Status: media.StatusInProgress, InputJSON: `{}`, CreatedAt: now, UpdatedAt: now,
	}
	if err := h.mediaRepo.CreateMediaJob(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	return job
}

func (h *videoScopeHarness) storedJob(t *testing.T, job media.Job) media.Job {
	t.Helper()
	stored, err := h.mediaRepo.GetMediaJob(context.Background(), job.ID, job.ClientKeyID)
	if err != nil {
		t.Fatal(err)
	}
	return stored
}

// TestVideoRetryNeverEscapesClientKeyAccountScope 覆盖 issue #1066 的回退路径：
// key 只允许 Super 层 Web 账号时，pin 账号失败后的换号不得借用 Free 层账号。
func TestVideoRetryNeverEscapesClientKeyAccountScope(t *testing.T) {
	t.Parallel()
	harness := newVideoScopeHarness(t, clientkey.AccountScope{
		Providers: clientkey.ProviderScopeWeb, Tiers: clientkey.TierScopeSuper,
	})
	// pin 账号（Super）持续失败，且 Free 账号是唯一可回退目标。
	harness.adapter.failures = map[uint64]int{harness.super.ID: 100}
	harness.adapter.status = http.StatusForbidden
	job := harness.newJob(t, "video_scope_retry", harness.super)

	harness.service.runVideoJob(context.Background(), job, harness.route)

	attempts := harness.adapter.Attempts()
	for _, accountID := range attempts {
		if accountID == harness.free.ID {
			t.Fatalf("越界账号被使用: attempts=%#v", attempts)
		}
	}
	if len(attempts) == 0 || attempts[0] != harness.super.ID {
		t.Fatalf("attempts=%#v, want 首次使用 pin 的 Super 账号 %d", attempts, harness.super.ID)
	}
	stored := harness.storedJob(t, job)
	if stored.Status != media.StatusFailed || stored.ErrorCode != "account_unavailable" {
		t.Fatalf("终态 = status %q error %q, want failed/account_unavailable", stored.Status, stored.ErrorCode)
	}
	if stored.AccountID != harness.super.ID {
		t.Fatalf("失败终态账号 = %d, want pin 账号 %d", stored.AccountID, harness.super.ID)
	}
}

// TestVideoPinnedAccountOutsideClientKeyScopeIsSkipped 覆盖 issue #1066 的 pin 路径：
// key 范围收紧后，越界的 job.AccountID 不得被使用，只能换到范围内账号。
func TestVideoPinnedAccountOutsideClientKeyScopeIsSkipped(t *testing.T) {
	t.Parallel()
	harness := newVideoScopeHarness(t, clientkey.AccountScope{
		Providers: clientkey.ProviderScopeWeb, Tiers: clientkey.TierScopeSuper,
	})
	// job 记录的 pin 账号是 Free 层，已越出 key 的 Super 范围。
	job := harness.newJob(t, "video_scope_pinned", harness.free)

	harness.service.runVideoJob(context.Background(), job, harness.route)

	attempts := harness.adapter.Attempts()
	if len(attempts) != 1 || attempts[0] != harness.super.ID {
		t.Fatalf("attempts=%#v, want 仅使用范围内的 Super 账号 %d", attempts, harness.super.ID)
	}
	stored := harness.storedJob(t, job)
	if stored.Status != media.StatusCompleted || stored.AccountID != harness.super.ID {
		t.Fatalf("终态 = %#v, want completed/%d", stored, harness.super.ID)
	}
}
