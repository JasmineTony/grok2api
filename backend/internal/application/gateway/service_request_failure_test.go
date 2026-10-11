package gateway

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	accountapp "github.com/chenyme/grok2api/backend/internal/application/account"
	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	providerregistry "github.com/chenyme/grok2api/backend/internal/infra/provider"
	"github.com/chenyme/grok2api/backend/internal/infra/runtime/memory"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// markRetryableAccountStateCase 描述一次失败分类输入与期望的「是否已处理」结果。
type markRetryableAccountStateCase struct {
	name                 string
	failure              UpstreamFailure
	buildForbiddenReauth bool
	quotaBlockErr        error
	reauthWriteErr       error
	want                 bool
}

// scriptedAccountRepository 复用既有 repository.AccountRepository 契约，只覆写
// markRetryableAccountState 直接依赖的持久化方法，不另造一套 mock 框架。
type scriptedAccountRepository struct {
	repository.AccountRepository
	credential     accountdomain.Credential
	quotaBlockErr  error
	reauthWriteErr error
}

func (r *scriptedAccountRepository) Get(_ context.Context, id uint64) (accountdomain.Credential, error) {
	if id != r.credential.ID {
		return accountdomain.Credential{}, repository.ErrNotFound
	}
	return r.credential, nil
}

func (r *scriptedAccountRepository) Update(_ context.Context, value accountdomain.Credential) (accountdomain.Credential, error) {
	if r.reauthWriteErr != nil {
		return accountdomain.Credential{}, r.reauthWriteErr
	}
	r.credential = value
	return value, nil
}

func (r *scriptedAccountRepository) UpsertModelQuotaBlock(context.Context, accountdomain.ModelQuotaBlock) error {
	return r.quotaBlockErr
}

func TestMarkRetryableAccountStateCoversEverySignalBranch(t *testing.T) {
	for _, testCase := range markRetryableAccountStateCases() {
		t.Run(testCase.name, func(t *testing.T) {
			state, lease := newMarkRetryableAccountState(t, testCase.quotaBlockErr, testCase.reauthWriteErr)
			state.lastFailure = &testCase.failure
			response := &provider.Response{StatusCode: testCase.failure.HTTPStatus, Header: make(http.Header)}
			got := state.markRetryableAccountState(lease, lease.Credential, response, time.Minute, nil, testCase.buildForbiddenReauth)
			if got != testCase.want {
				t.Fatalf("markRetryableAccountState = %t, want %t (failure=%+v)", got, testCase.want, testCase.failure)
			}
		})
	}
}

func markRetryableAccountStateCases() []markRetryableAccountStateCase {
	return []markRetryableAccountStateCase{
		{
			// 拆分前该分支用自身结果「覆盖」额度链结果，而不是与额度链结果合并。
			// 若该行改回 `|| failureHandled`，本用例是唯一会失败的断言。
			name: "permanent denial discards a handled quota chain when the model block write fails",
			failure: UpstreamFailure{
				HTTPStatus: http.StatusForbidden, AccountScoped: true, UpstreamCode: "permission_denied",
				PermanentAccountDenial: true, ModelQuotaExhausted: true,
			},
			quotaBlockErr: errors.New("simulated model quota block write failure"),
			want:          false,
		},
		{
			name:    "quota chain result is returned when no later signal matches",
			failure: UpstreamFailure{HTTPStatus: http.StatusTooManyRequests, AccountScoped: true, ModelQuotaExhausted: true},
			want:    true,
		},
		{
			name:    "blocked account marks reauth",
			failure: UpstreamFailure{HTTPStatus: http.StatusForbidden, AccountScoped: true, AccountBlocked: true},
			want:    true,
		},
		{
			name:           "blocked account reauth write failure is reported as unhandled",
			failure:        UpstreamFailure{HTTPStatus: http.StatusForbidden, AccountScoped: true, AccountBlocked: true},
			reauthWriteErr: errors.New("simulated reauth write failure"),
			want:           false,
		},
		{
			name:                 "build forbidden policy match marks reauth",
			failure:              UpstreamFailure{HTTPStatus: http.StatusForbidden, AccountScoped: true, UpstreamCode: "account_access_denied"},
			buildForbiddenReauth: true,
			want:                 true,
		},
		{
			name:    "rejected credential marks reauth",
			failure: UpstreamFailure{HTTPStatus: http.StatusUnauthorized, AccountScoped: true, CredentialRejected: true},
			want:    true,
		},
		{
			name:    "unclassified failure keeps the empty quota chain result",
			failure: UpstreamFailure{HTTPStatus: http.StatusInternalServerError},
			want:    false,
		},
	}
}

func newMarkRetryableAccountState(t *testing.T, quotaBlockErr, reauthWriteErr error) (*responseRequestState, *accountLease) {
	t.Helper()
	credential := accountdomain.Credential{
		ID: 42, Name: "build-account", Provider: accountdomain.ProviderBuild, AuthType: accountdomain.AuthTypeOAuth,
	}
	accountRepo := &scriptedAccountRepository{credential: credential, quotaBlockErr: quotaBlockErr, reauthWriteErr: reauthWriteErr}
	registry := providerregistry.NewRegistry(&credentialFailureImageAdapter{})
	sticky := memory.NewStickyStore()
	accountService := accountapp.NewService(accountRepo, nil, memory.NewDeviceSessionStore(), sticky, registry, nil, nil)
	selector := NewSelector(accountRepo, memory.NewConcurrencyLimiter(), sticky, registry, time.Hour, time.Second, time.Minute)
	service := NewService(nil, nil, accountService, nil, registry, selector, nil, 1)
	state := &responseRequestState{
		service: service,
		ctx:     context.Background(),
		input:   Input{RequestID: "req-mark-retryable-account-state"},
		route:   modeldomain.Route{Provider: accountdomain.ProviderBuild, PublicID: "grok-test", UpstreamModel: "grok-test-build-free"},
	}
	return state, &accountLease{Credential: credential}
}
