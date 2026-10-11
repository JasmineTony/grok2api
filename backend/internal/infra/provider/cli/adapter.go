package cli

import (
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/infra/provider/conversation"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	"github.com/chenyme/grok2api/backend/internal/pkg/reasoningreplay"
)

type Config struct {
	BaseURL               string
	FallbackBaseURL       string
	ClientVersion         string
	ClientIdentifier      string
	TokenAuth             string
	UserAgent             string
	ResponseHeaderTimeout time.Duration
	StreamIdleTimeout     time.Duration
}

const (
	subscriptionTierTimeout = 10 * time.Second
	buildControlTimeout     = 30 * time.Second
	buildGrok45Model        = "grok-4.5"
	buildGrok46Model        = "grok-4.6"
)

// Adapter implements the Grok Build CLI Responses, model, Billing, and OAuth protocols.
type Adapter struct {
	cfgMu          sync.RWMutex
	cfg            Config
	http           *http.Client
	oauth          *oauthClient
	cipher         *security.Cipher
	base           *buildDirectTransport
	agentID        string
	modelsMu       sync.Mutex
	modelsETags    map[uint64]string
	fallbackMarker FallbackMarker
	uploadIssuer   VideoUploadIssuer
	replay         *reasoningreplay.ReasoningReplay
	// conversationReasoningCache bridges Chat/Messages tool calls to the
	// upstream Responses reasoning proof. It is deliberately separate from
	// the persistent native Responses replay, and its keys never contain an
	// account ID: encrypted reasoning is portable across Build accounts.
	conversationReasoningCache *conversation.ReasoningCache
	compaction                 *gatewayCompactionCodec
	logger                     *slog.Logger
}

func NewAdapter(cfg Config, cipher *security.Cipher) *Adapter {
	cfg.ResponseHeaderTimeout = normalizeBuildResponseHeaderTimeout(cfg.ResponseHeaderTimeout)
	cfg.StreamIdleTimeout = normalizeBuildStreamIdleTimeout(cfg.StreamIdleTimeout)
	transport := newBuildDirectTransport(cfg.ResponseHeaderTimeout)
	httpClient := &http.Client{Transport: transport}
	// The official CLI uses a persistent machine identity. The gateway does not collect machine fingerprints;
	// instead each backend process generates one random UUID for its lifetime as the Agent identity.
	agentID := uuid.NewString()
	adapter := &Adapter{
		cfg: cfg, http: httpClient, cipher: cipher, base: transport,
		agentID: agentID, modelsETags: make(map[uint64]string),
		conversationReasoningCache: conversation.NewReasoningCache(0, 0),
		compaction:                 newGatewayCompactionCodec(cipher), logger: slog.Default(),
	}
	adapter.oauth = newOAuthClient(httpClient, func() string { return adapter.config().ClientVersion })
	return adapter
}

func (a *Adapter) SetLogger(logger *slog.Logger) {
	if logger != nil {
		a.logger = logger
	}
}

func (a *Adapter) SetEgress(manager *infraegress.Manager) {
	if manager != nil {
		a.http.Transport = &egressTransport{manager: manager, fallback: a.base}
	}
}

// SetReasoningReplay injects the optional server-side reasoning replay cache.
func (a *Adapter) SetReasoningReplay(replay *reasoningreplay.ReasoningReplay) {
	a.replay = replay
}

func (a *Adapter) Provider() account.Provider { return account.ProviderBuild }

func (a *Adapter) UpdateConfig(cfg Config) {
	cfg.ResponseHeaderTimeout = normalizeBuildResponseHeaderTimeout(cfg.ResponseHeaderTimeout)
	cfg.StreamIdleTimeout = normalizeBuildStreamIdleTimeout(cfg.StreamIdleTimeout)
	a.cfgMu.Lock()
	previousTimeout := a.cfg.ResponseHeaderTimeout
	a.cfg = cfg
	a.cfgMu.Unlock()
	if previousTimeout != cfg.ResponseHeaderTimeout && a.base != nil {
		a.base.UpdateResponseHeaderTimeout(cfg.ResponseHeaderTimeout)
	}
}

func (a *Adapter) config() Config {
	a.cfgMu.RLock()
	defer a.cfgMu.RUnlock()
	return a.cfg
}
