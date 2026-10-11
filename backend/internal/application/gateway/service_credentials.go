package gateway

import (
	"context"
	"fmt"
	"time"

	json "encoding/json"
	audit "github.com/chenyme/grok2api/backend/internal/domain/audit"
	clientkey "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	security "github.com/chenyme/grok2api/backend/internal/infra/security"
	http "net/http"
)

func rewriteAliasedModel(body []byte, publicModel, reasoningEffort string, operation audit.Operation) ([]byte, error) {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("解析兼容模型请求: %w", err)
	}
	payload["model"] = publicModel
	if reasoningEffort != "" {
		switch operation {
		case audit.OperationChat:
			payload["reasoning_effort"] = reasoningEffort
		case audit.OperationMessages:
			applyMessagesReasoningEffort(payload, reasoningEffort)
		default:
			reasoning, _ := payload["reasoning"].(map[string]any)
			if reasoning == nil {
				reasoning = make(map[string]any)
			}
			reasoning["effort"] = reasoningEffort
			payload["reasoning"] = reasoning
		}
	}
	return json.Marshal(payload)
}

// applyMessagesReasoningEffort 按 Messages 兼容契约写入 output_config 与 thinking；effort 为 none 时关闭思考。
func applyMessagesReasoningEffort(payload map[string]any, reasoningEffort string) {
	config, _ := payload["output_config"].(map[string]any)
	if reasoningEffort == modeldomain.ReasoningEffortNone {
		if config != nil {
			delete(config, "effort")
		}
		if len(config) == 0 {
			delete(payload, "output_config")
		} else {
			payload["output_config"] = config
		}
		payload["thinking"] = map[string]any{"type": "disabled"}
		return
	}
	if config == nil {
		config = make(map[string]any)
	}
	config["effort"] = reasoningEffort
	payload["output_config"] = config
	payload["thinking"] = map[string]any{"type": "adaptive"}
}

type ResourceInput struct {
	ClientKey  clientkey.Key
	ResponseID string
	RawQuery   string
}

func (s *Service) cancelBillingReservation(eventID string) {
	ctx, cancel := context.WithTimeout(context.Background(), finalizationTimeout)
	defer cancel()
	if err := s.clientKeys.CancelBilling(ctx, eventID); err != nil {
		s.logger.Error("billing_reservation_cancel_failed", "event_id", eventID, "error", err)
	}
}

func newAuditEventID() string {
	value, err := security.NewOpaqueToken(18)
	if err != nil || value == "" {
		return fmt.Sprintf("evt_%d", time.Now().UnixNano())
	}
	return "evt_" + value
}

func (s *Service) GetResponse(ctx context.Context, input ResourceInput) (*Result, error) {
	return s.forwardOwnedResponse(ctx, input, http.MethodGet)
}

func (s *Service) DeleteResponse(ctx context.Context, input ResourceInput) (*Result, error) {
	return s.forwardOwnedResponse(ctx, input, http.MethodDelete)
}
