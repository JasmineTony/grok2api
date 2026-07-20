package requestpolicy

import (
	"errors"
	"net"
	"strconv"

	policyapp "github.com/chenyme/grok2api/backend/internal/application/requestpolicy"
	policydomain "github.com/chenyme/grok2api/backend/internal/domain/requestpolicy"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"github.com/chenyme/grok2api/backend/internal/shared/response"
	"github.com/gin-gonic/gin"
)

type Handler struct{ service *policyapp.Service }

func NewHandler(service *policyapp.Service) *Handler { return &Handler{service: service} }
func (h *Handler) Register(router *gin.RouterGroup) {
	router.GET("/request-policies", h.list)
	router.POST("/request-policies", h.create)
	router.POST("/request-policies/evaluate", h.evaluate)
	router.GET("/request-policies/:id", h.get)
	router.PUT("/request-policies/:id", h.update)
	router.DELETE("/request-policies/:id", h.delete)
}
func (h *Handler) list(c *gin.Context) {
	values, err := h.service.List(c.Request.Context())
	if err != nil {
		response.Error(c, 500, "requestPolicyListFailed", "failed to list request policies")
		return
	}
	response.Success(c, 200, gin.H{"items": values})
}
func (h *Handler) get(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	value, err := h.service.Get(c.Request.Context(), id)
	if err != nil {
		h.writeError(c, err)
		return
	}
	response.Success(c, 200, value)
}
func (h *Handler) create(c *gin.Context) {
	var value policydomain.Rule
	if c.ShouldBindJSON(&value) != nil {
		response.Error(c, 400, "invalidRequest", "invalid request policy")
		return
	}
	value.ID = 0
	created, err := h.service.Create(c.Request.Context(), value)
	if err != nil {
		h.writeError(c, err)
		return
	}
	response.Success(c, 201, created)
}
func (h *Handler) update(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	var value policydomain.Rule
	if c.ShouldBindJSON(&value) != nil {
		response.Error(c, 400, "invalidRequest", "invalid request policy")
		return
	}
	value.ID = id
	updated, err := h.service.Update(c.Request.Context(), value)
	if err != nil {
		h.writeError(c, err)
		return
	}
	response.Success(c, 200, updated)
}
func (h *Handler) delete(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	if err := h.service.Delete(c.Request.Context(), id); err != nil {
		h.writeError(c, err)
		return
	}
	response.Success(c, 200, gin.H{"deleted": true})
}

type evaluateRequest struct {
	ClientKeyID uint64 `json:"clientKeyId"`
	Model       string `json:"model"`
	Provider    string `json:"provider"`
	Operation   string `json:"operation"`
	SourceIP    string `json:"sourceIp"`
	Media       bool   `json:"media"`
	MediaCount  int    `json:"mediaCount"`
	Tokens      int    `json:"tokens"`
}

func (h *Handler) evaluate(c *gin.Context) {
	var raw evaluateRequest
	if c.ShouldBindJSON(&raw) != nil {
		response.Error(c, 400, "invalidRequest", "invalid policy evaluation request")
		return
	}
	ip := net.ParseIP(raw.SourceIP)
	if raw.SourceIP != "" && ip == nil {
		response.Error(c, 400, "invalidSourceIP", "sourceIp is invalid")
		return
	}
	value, err := h.service.Evaluate(c.Request.Context(), policydomain.Request{ClientKeyID: raw.ClientKeyID, Model: raw.Model, Provider: raw.Provider, Operation: raw.Operation, SourceIP: ip, Media: raw.Media, MediaCount: raw.MediaCount, Tokens: raw.Tokens})
	if err != nil {
		response.Error(c, 500, "requestPolicyEvaluationFailed", "failed to evaluate policy")
		return
	}
	response.Success(c, 200, value)
}
func parseID(c *gin.Context) (uint64, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		response.Error(c, 400, "invalidRequestPolicyId", "request policy id is invalid")
		return 0, false
	}
	return id, true
}
func (h *Handler) writeError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, repository.ErrNotFound):
		response.Error(c, 404, "requestPolicyNotFound", "request policy not found")
	case errors.Is(err, repository.ErrConflict):
		response.Error(c, 409, "requestPolicyConflict", "request policy conflicts with another resource")
	default:
		response.Error(c, 400, "invalidRequestPolicy", err.Error())
	}
}
