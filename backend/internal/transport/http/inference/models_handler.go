package inference

import (
	"net/http"
	"strings"

	clientkeydomain "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	"github.com/chenyme/grok2api/backend/internal/transport/http/middleware"
	"github.com/gin-gonic/gin"
)

func (h *Handler) listModels(c *gin.Context) {
	allowAliases := false
	var clientKey clientkeydomain.Key
	hasClientKey := false
	if clientValue, exists := c.Get(middleware.ClientKey); exists {
		if value, ok := clientValue.(clientkeydomain.Key); ok {
			clientKey = value
			hasClientKey = true
			allowAliases = clientKey.AllowModelAliases
		}
	}
	var values []modeldomain.Route
	var err error
	if hasClientKey {
		values, err = h.models.ListEnabledForClientKey(c.Request.Context(), clientKey)
	} else {
		values, err = h.models.ListEnabled(c.Request.Context())
	}
	if err != nil {
		writeOpenAIError(c, http.StatusInternalServerError, "model_list_failed", "读取模型列表失败")
		return
	}
	if hasClientKey {
		values = filterModelRoutesForClientKey(values, clientKey)
	}
	items := newModelListItems(values)
	if allowAliases {
		items = appendReasoningModelAliases(items)
	}
	if clientVersion := strings.TrimSpace(c.Query("client_version")); clientVersion != "" {
		writeCodexModelCatalog(c, newCodexModelCatalog(items))
		return
	}
	c.JSON(http.StatusOK, gin.H{"object": "list", "data": items})
}

func filterModelRoutesForClientKey(values []modeldomain.Route, key clientkeydomain.Key) []modeldomain.Route {
	filtered := make([]modeldomain.Route, 0, len(values))
	scope := key.AccountScope()
	for _, value := range values {
		if scope.AllowsProvider(value.Provider) && key.AllowsModel(value.ID) {
			filtered = append(filtered, value)
		}
	}
	return filtered
}

// newModelListItems deduplicates by downstream public name and hides Provider prefixes used only for internal routing.
func newModelListItems(values []modeldomain.Route) []modelListItem {
	data := make([]modelListItem, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		publicID := modeldomain.ExternalPublicID(value.Provider, value.PublicID)
		if seen[publicID] {
			continue
		}
		seen[publicID] = true
		data = append(data, modelListItem{ID: publicID, Object: "model", Created: value.CreatedAt.Unix(), OwnedBy: "grok2api", Provider: value.Provider, Capability: value.Capability})
	}
	return data
}

// appendReasoningModelAliases expands base models into effort-suffixed aliases using only
// levels each model actually supports (never a blanket none/low/medium/high/xhigh/max template).
func appendReasoningModelAliases(items []modelListItem) []modelListItem {
	if len(items) == 0 {
		return items
	}
	seen := make(map[string]bool, len(items)*2)
	result := make([]modelListItem, 0, len(items)*2)
	for _, item := range items {
		seen[item.ID] = true
		result = append(result, item)
	}
	for _, item := range items {
		for _, aliasID := range modeldomain.ReasoningAliasPublicIDsForProvider(item.Provider, item.ID) {
			if seen[aliasID] {
				continue
			}
			seen[aliasID] = true
			result = append(result, modelListItem{
				ID: aliasID, Object: "model", Created: item.Created, OwnedBy: item.OwnedBy,
				Provider: item.Provider, Capability: item.Capability,
			})
		}
	}
	return result
}
