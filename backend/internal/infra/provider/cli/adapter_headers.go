package cli

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
)

func (a *Adapter) applyHeaders(req *http.Request, credential account.Credential, accessToken, model, promptCacheKey string, trace bool) error {
	cfg := a.config()
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("X-XAI-Token-Auth", cfg.TokenAuth)
	req.Header.Set("x-grok-client-version", cfg.ClientVersion)
	req.Header.Set("x-grok-client-identifier", cfg.ClientIdentifier)
	req.Header.Set("x-grok-client-mode", "headless")

	if trace {
		requestID := uuid.NewString()
		// Set x-grok-conv-id and session-id only when a stable session exists.
		// Never generate a random UUID per request; it breaks xAI session affinity and keeps cached_tokens at zero.
		sessionID, err := grokSessionID(promptCacheKey)
		if err != nil {
			return err
		}
		req.Header.Set("x-authenticateresponse", "authenticate-response")
		req.Header.Set("x-grok-agent-id", a.agentID)
		if sessionID != "" {
			req.Header.Set("x-grok-session-id", sessionID)
			req.Header.Set("x-grok-conv-id", sessionID)
			// grok-build derives x-grok-conv-group-id from the root session so the
			// proxy can group a root conversation with its subagent descendants.
			req.Header.Set("x-grok-conv-group-id", grokConversationGroupID(sessionID))
		}
		req.Header.Set("x-grok-req-id", requestID)
		// The gateway cannot reliably recover the CLI prompt index from a stateless API request.
		// The field is optional in the official protocol, so do not fabricate x-grok-turn-idx.
		if credential.UserID != "" {
			req.Header.Set("x-grok-user-id", credential.UserID)
		}
		traceID, traceErr := randomHex(16)
		if traceErr != nil {
			return traceErr
		}
		spanID, spanErr := randomHex(8)
		if spanErr != nil {
			return spanErr
		}
		req.Header.Set("traceparent", "00-"+traceID+"-"+spanID+"-01")
	} else {
		if credential.UserID != "" {
			req.Header.Set("x-userid", credential.UserID)
		}
		if credential.Email != "" {
			req.Header.Set("x-email", credential.Email)
		}
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Accept-Encoding", "gzip")
	req.Header.Set("User-Agent", cfg.UserAgent)
	if model != "" {
		req.Header.Set("x-grok-model-override", model)
	}
	return nil
}

// grokSessionID converts a stable session key to the upstream x-grok-conv-id.
// An empty key returns an empty string; stateless requests never receive a random ID.
func grokSessionID(promptCacheKey string) (string, error) {
	key := strings.TrimSpace(promptCacheKey)
	if key == "" {
		return "", nil
	}
	if parsed, err := uuid.Parse(key); err == nil {
		return parsed.String(), nil
	}
	return uuid.NewHash(sha256.New(), uuid.NameSpaceURL, []byte("grok2api:session:"+key), 8).String(), nil
}

// grokConversationGroupIDNamespace mirrors xai-grok-shell `CONVERSATION_GROUP_NAMESPACE`.
const grokConversationGroupIDNamespace = "xai:grok-build:conversation-group:"

// grokConversationGroupID reproduces grok-build `derive_conversation_group_id`:
// UUIDv5(NAMESPACE_OID, namespace + root_session_id). The gateway treats each
// stable session as its own root conversation, so the group id derives from the
// same session id sent as x-grok-conv-id.
func grokConversationGroupID(rootSessionID string) string {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte(grokConversationGroupIDNamespace+rootSessionID)).String()
}

func injectPromptCacheKey(body []byte, clientKey string) ([]byte, error) {
	key := strings.TrimSpace(clientKey)
	if key == "" {
		return body, nil
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	if payload == nil {
		payload = make(map[string]json.RawMessage)
	}
	payload["prompt_cache_key"] = mustJSON(key)
	return json.Marshal(payload)
}

func randomHex(bytesLength int) (string, error) {
	value := make([]byte, bytesLength)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}
