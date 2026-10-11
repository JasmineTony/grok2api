package egress

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	domain "github.com/chenyme/grok2api/backend/internal/domain/egress"
)

var ErrSubscriptionSync = errors.New("代理订阅同步失败")

func (s *Service) syncSource(ctx context.Context, operations OperationsRepository, source domain.SubscriptionSource) (ImportResult, error) {
	now := time.Now().UTC()
	nextSyncAt := sourceNextSyncAt(source, now)
	recordFailure := func() {
		// The source URL and any transport detail are deliberately omitted from
		// persisted status and API errors; they may contain subscription tokens.
		_ = operations.UpdateEgressSourceSync(context.WithoutCancel(ctx), source.ID, now, nextSyncAt, 0, "订阅拉取或解析失败")
	}
	entries, skipped, err := s.pullSourceEntries(ctx, source)
	if err != nil {
		recordFailure()
		return ImportResult{}, err
	}
	nodes, err := s.buildSourceNodes(source, entries)
	if err != nil {
		recordFailure()
		return ImportResult{}, fmt.Errorf("%w: 加密导入节点", ErrSubscriptionSync)
	}
	imported, err := operations.UpsertEgressNodesFromSource(ctx, source.ID, nodes)
	if err != nil {
		recordFailure()
		return ImportResult{}, ErrSubscriptionSync
	}
	s.invalidateOperationsConfig()
	if err := operations.UpdateEgressSourceSync(ctx, source.ID, now, nextSyncAt, imported, ""); err != nil {
		return ImportResult{}, err
	}
	return ImportResult{Imported: imported, Skipped: skipped}, nil
}

func (s *Service) pullSourceEntries(ctx context.Context, source domain.SubscriptionSource) ([]subscriptionEntry, int, error) {
	if strings.TrimSpace(source.EncryptedURL) == "" {
		return nil, 0, ErrSubscriptionSync
	}
	urlValue, err := s.cipher.Decrypt(source.EncryptedURL)
	if err != nil {
		return nil, 0, ErrSubscriptionSync
	}
	fetchProxy, err := s.subscriptionFetchProxy(source)
	if err != nil {
		return nil, 0, ErrSubscriptionSync
	}
	content, err := fetchProxySubscription(ctx, urlValue, fetchProxy)
	if err != nil {
		return nil, 0, ErrSubscriptionSync
	}
	entries, skipped, err := parseProxySubscription(string(content))
	if err != nil {
		return nil, 0, ErrSubscriptionSync
	}
	return entries, skipped, nil
}

func (s *Service) buildSourceNodes(source domain.SubscriptionSource, entries []subscriptionEntry) ([]domain.Node, error) {
	userAgent := ""
	if source.Scope != domain.ScopeBuild {
		s.mu.RLock()
		userAgent = s.browserUA
		s.mu.RUnlock()
	}
	nodes := make([]domain.Node, 0, len(entries))
	for index, entry := range entries {
		encryptedProxy, err := s.cipher.Encrypt(entry.ProxyURL)
		if err != nil {
			return nil, err
		}
		nodes = append(nodes, domain.Node{
			Name: sourceNodeName(source.Name, index), Scope: source.Scope, Enabled: true,
			SourceID: source.ID, SourceKey: entry.Key, AccountCapacity: source.DefaultAccountCapacity,
			EncryptedProxyURL: encryptedProxy, UserAgent: userAgent, Health: 1, ProbeStatus: domain.ProbeStatusUnknown,
		})
	}
	return nodes, nil
}

func sourceNextSyncAt(source domain.SubscriptionSource, now time.Time) time.Time {
	if source.RefreshIntervalSeconds < 60 {
		return now.Add(defaultProbeIntervalSeconds * time.Second)
	}
	return now.Add(time.Duration(source.RefreshIntervalSeconds) * time.Second)
}

func (s *Service) subscriptionFetchProxy(source domain.SubscriptionSource) (string, error) {
	encrypted := strings.TrimSpace(source.EncryptedProxyURL)
	if encrypted == "" {
		return "", nil
	}
	decrypted, err := s.cipher.Decrypt(encrypted)
	if err != nil {
		return "", err
	}
	normalized, err := NormalizeProxyURL(decrypted)
	if err != nil || normalized == "" || strings.Contains(normalized, ProxyAccountPlaceholder) {
		return "", errors.New("订阅拉取代理配置无效")
	}
	return normalized, nil
}
