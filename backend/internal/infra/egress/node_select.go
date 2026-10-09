package egress

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	application "github.com/chenyme/grok2api/backend/internal/application/egress"
	domain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

func clearanceCacheKey(nodeID uint64, proxyURL string, sticky bool) string {
	if nodeID == 0 {
		return "direct"
	}
	base := "node:" + strconv.FormatUint(nodeID, 10)
	if !sticky {
		return base
	}
	digest := sha256.Sum256([]byte(proxyURL))
	return base + ":account:" + fmt.Sprintf("%x", digest[:16])
}

func renderAccountProxyURL(template, accountKey string) (string, error) {
	if !strings.Contains(template, application.ProxyAccountPlaceholder) {
		return template, nil
	}
	accountKey = normalizeProxyAccount(accountKey)
	if accountKey == "" {
		return "", errors.New("粘性代理需要有效的账号身份")
	}
	return strings.ReplaceAll(template, application.ProxyAccountPlaceholder, accountKey), nil
}

func normalizeProxyAccount(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	value = strings.Map(func(character rune) rune {
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') || character == '_' || character == '-' {
			return character
		}
		return '_'
	}, value)
	if len(value) <= 128 {
		return value
	}
	digest := sha256.Sum256([]byte(value))
	return value[:95] + "_" + fmt.Sprintf("%x", digest[:16])
}

func (m *Manager) listNodes(ctx context.Context, scope domain.Scope, now time.Time) ([]domain.Node, error) {
	for {
		m.nodeMu.RLock()
		if snapshot, ok := m.nodes[scope]; ok && now.Before(snapshot.expiresAt) {
			// Node snapshots are replaced with a copied slice and treated as immutable
			// by callers. Returning the shared read-only slice avoids a per-request copy.
			values := snapshot.values
			m.nodeMu.RUnlock()
			return values, nil
		}
		m.nodeMu.RUnlock()
		loaded, err, _ := m.nodeLoads.Do(string(scope), func() (any, error) {
			checkTime := time.Now().UTC()
			m.nodeMu.RLock()
			if snapshot, ok := m.nodes[scope]; ok && checkTime.Before(snapshot.expiresAt) {
				values := snapshot.values
				m.nodeMu.RUnlock()
				return values, nil
			}
			version := m.nodeVersions[scope]
			m.nodeMu.RUnlock()
			values, err := m.repository.ListEgressNodes(ctx, scope, repository.SortQuery{})
			if err != nil {
				return nil, err
			}
			m.nodeMu.Lock()
			if m.nodeVersions[scope] != version {
				m.nodeMu.Unlock()
				return nil, errNodeSnapshotInvalidated
			}
			m.replaceNodeSnapshotLocked(scope, values, checkTime.Add(nodeSnapshotTTL))
			values = m.nodes[scope].values
			m.nodeMu.Unlock()
			return values, nil
		})
		if err != nil {
			if errors.Is(err, errNodeSnapshotInvalidated) && ctx.Err() == nil {
				now = time.Now().UTC()
				continue
			}
			return nil, err
		}
		return loaded.([]domain.Node), nil
	}
}

func (m *Manager) invalidateNodes(scope domain.Scope) {
	m.nodeMu.Lock()
	m.nodeVersions[scope]++
	snapshot, ok := m.nodes[scope]
	if ok {
		delete(m.nodes, scope)
	}
	for _, node := range snapshot.values {
		delete(m.healthyNodes, node.ID)
	}
	m.nodeMu.Unlock()
}

func (m *Manager) replaceNodeSnapshotLocked(scope domain.Scope, values []domain.Node, expiresAt time.Time) {
	for _, node := range m.nodes[scope].values {
		delete(m.healthyNodes, node.ID)
	}
	for _, node := range values {
		if nodeIsHealthy(node) {
			m.healthyNodes[node.ID] = expiresAt
		} else {
			delete(m.healthyNodes, node.ID)
		}
	}
	m.nodes[scope] = cachedNodeSnapshot{values: append([]domain.Node(nil), values...), expiresAt: expiresAt}
}

func (m *Manager) selectNode(nodes []domain.Node, affinity string) domain.Node {
	if affinity != "" {
		digest := sha256.Sum256([]byte(affinity))
		selected := nodes[int(binary.BigEndian.Uint64(digest[:8])%uint64(len(nodes)))]
		if selected.Health >= 0.8 || len(nodes) == 1 {
			return selected
		}
		for _, node := range nodes {
			if node.Health > selected.Health {
				selected = node
			}
		}
		return selected
	}
	best := nodes[0]
	bestCurrent := m.inflightCount(best.ID)
	for _, node := range nodes[1:] {
		current := m.inflightCount(node.ID)
		if current < bestCurrent || (current == bestCurrent && node.Health > best.Health) {
			best = node
			bestCurrent = current
		}
	}
	return best
}
