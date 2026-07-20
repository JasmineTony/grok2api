package requestsnapshot

import (
	"encoding/json"
	app "github.com/chenyme/grok2api/backend/internal/application/requestsnapshot"
	"github.com/chenyme/grok2api/backend/internal/shared/response"
	"github.com/gin-gonic/gin"
	"net/http"
)

type Handler struct{ service *app.Service }

func NewHandler(service *app.Service) *Handler { return &Handler{service: service} }
func (h *Handler) Register(router *gin.RouterGroup) {
	router.POST("/request-snapshots", h.capture)
	router.GET("/request-snapshots/:id", h.view)
	router.POST("/request-snapshots/:id/replay", h.replay)
}

type captureRequest struct {
	RequestID string          `json:"requestId"`
	Protocol  string          `json:"protocol"`
	Operation string          `json:"operation"`
	Model     string          `json:"model"`
	Payload   json.RawMessage `json:"payload"`
}

func (h *Handler) capture(c *gin.Context) {
	var value captureRequest
	if c.ShouldBindJSON(&value) != nil {
		response.Error(c, 400, "invalidRequestSnapshot", "invalid snapshot request")
		return
	}
	snapshot, err := h.service.Capture(c.Request.Context(), value.RequestID, value.Protocol, value.Operation, value.Model, value.Payload)
	if err != nil {
		response.Error(c, http.StatusBadRequest, "requestSnapshotCaptureFailed", err.Error())
		return
	}
	response.Success(c, http.StatusCreated, snapshot)
}
func (h *Handler) view(c *gin.Context) {
	value, err := h.service.View(c.Request.Context(), c.Param("id"))
	if err != nil {
		response.Error(c, http.StatusNotFound, "requestSnapshotNotFound", "request snapshot not found or expired")
		return
	}
	response.Success(c, http.StatusOK, value)
}

type replayRequest struct {
	Confirm      bool   `json:"confirm"`
	ClientAPIKey string `json:"clientApiKey,omitempty"`
}

func (h *Handler) replay(c *gin.Context) {
	var value replayRequest
	if c.ShouldBindJSON(&value) != nil {
		response.Error(c, 400, "invalidReplayRequest", "invalid replay request")
		return
	}
	preview, err := h.service.Replay(c.Request.Context(), c.Param("id"), value.Confirm, value.ClientAPIKey)
	if err != nil {
		response.Error(c, http.StatusForbidden, "requestReplayDisabled", err.Error())
		return
	}
	response.Success(c, http.StatusOK, preview)
}
