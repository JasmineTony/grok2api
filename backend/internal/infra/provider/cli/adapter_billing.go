package cli

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
)

func (a *Adapter) GetBilling(ctx context.Context, credential account.Credential) (account.Billing, error) {
	ctx, cancel := context.WithTimeout(ctx, buildControlTimeout)
	defer cancel()
	accessToken, err := a.cipher.Decrypt(credential.EncryptedAccessToken)
	if err != nil {
		return account.Billing{}, err
	}
	billing, err := a.getBilling(ctx, credential, accessToken, "format=credits")
	if err != nil {
		return account.Billing{}, err
	}
	// A weekly quota at 0% usage cannot distinguish Free from a newly activated paid plan.
	// The official CLI uses /user?include=subscription for the live subscription tier, then falls back to the JWT tier.
	if tier, tierErr := a.getSubscriptionTier(ctx, credential, accessToken); tierErr == nil && tier != "" {
		billing.PlanName = tier
	} else if billing.PlanCode == "" && billing.PlanName == "" {
		billing.PlanName = subscriptionTierFromJWT(accessToken)
	}
	billing.AccountID = credential.ID
	billing.SyncedAt = time.Now().UTC()
	return billing, nil
}

func (a *Adapter) url(path string) string {
	return strings.TrimRight(a.config().BaseURL, "/") + "/" + strings.TrimLeft(path, "/")
}

func (a *Adapter) getBilling(ctx context.Context, credential account.Credential, accessToken, query string) (account.Billing, error) {
	endpoint := a.url("/billing")
	if query != "" {
		endpoint += "?" + query
	}
	requestCtx := infraegress.WithCredential(ctx, credential)
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return account.Billing{}, err
	}
	if err := a.applyHeaders(req, credential, accessToken, "", "", false); err != nil {
		return account.Billing{}, err
	}
	resp, err := a.http.Do(req)
	if err != nil {
		return account.Billing{}, err
	}
	if err := normalizeGzipResponse(resp); err != nil {
		return account.Billing{}, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return account.Billing{}, err
	}
	if resp.StatusCode != http.StatusOK {
		return account.Billing{}, fmt.Errorf("上游 Billing 接口返回 %d", resp.StatusCode)
	}
	return parseBilling(body)
}

func (a *Adapter) getSubscriptionTier(ctx context.Context, credential account.Credential, accessToken string) (string, error) {
	endpoint := a.url("/user") + "?include=subscription"
	requestCtx, cancel := context.WithTimeout(infraegress.WithCredential(ctx, credential), subscriptionTierTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	if err := a.applyHeaders(req, credential, accessToken, "", "", false); err != nil {
		return "", err
	}
	resp, err := a.http.Do(req)
	if err != nil {
		return "", err
	}
	if err := normalizeGzipResponse(resp); err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("上游订阅接口返回 %d", resp.StatusCode)
	}
	return parseSubscriptionTier(body)
}
