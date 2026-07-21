package notification

import (
	"context"
	"net/http"
	"strconv"
	"time"

	notificationapp "github.com/chenyme/grok2api/backend/internal/application/notification"
	notificationdomain "github.com/chenyme/grok2api/backend/internal/domain/notification"
	"github.com/chenyme/grok2api/backend/internal/shared/response"
	"github.com/gin-gonic/gin"
)

type Handler struct{ service *notificationapp.Service }
func NewHandler(service *notificationapp.Service) *Handler { return &Handler{service: service} }
func (h *Handler) Register(router *gin.RouterGroup) {
	router.GET("/notifications", h.list)
	router.POST("/notifications/:id/read", h.markRead)
	router.POST("/notifications/:id/acknowledge", h.acknowledge)
}

type eventDTO struct {
	ID             string     `json:"id"`
	EventKey       string     `json:"eventKey"`
	Severity       string     `json:"severity"`
	Title          string     `json:"title"`
	Body           string     `json:"body"`
	Status         string     `json:"status"`
	CreatedAt      time.Time  `json:"createdAt"`
	ReadAt         *time.Time `json:"readAt,omitempty"`
	AcknowledgedAt *time.Time `json:"acknowledgedAt,omitempty"`
	ExpiresAt      *time.Time `json:"expiresAt,omitempty"`
}

func (h *Handler) list(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1")); if page < 1 { page = 1 }
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "50")); if pageSize < 1 { pageSize = 50 }; if pageSize > 200 { pageSize = 200 }
	items, total, err := h.service.List(c.Request.Context(), (page-1)*pageSize, pageSize, false)
	if err != nil { response.Error(c, http.StatusInternalServerError, "notificationListFailed", "读取通知失败"); return }
	values := make([]eventDTO, 0, len(items)); for _, item := range items { values = append(values, toDTO(item)) }
	response.Success(c, http.StatusOK, gin.H{"items": values, "page": page, "pageSize": pageSize, "total": total})
}

func (h *Handler) markRead(c *gin.Context) { h.update(c, h.service.MarkRead) }
func (h *Handler) acknowledge(c *gin.Context) { h.update(c, h.service.Acknowledge) }
func (h *Handler) update(c *gin.Context, operation func(context.Context, uint64) error) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64); if err != nil || id == 0 { response.Error(c, http.StatusBadRequest, "invalidNotificationId", "通知 ID 无效"); return }
	if err := operation(c.Request.Context(), id); err != nil { response.Error(c, http.StatusInternalServerError, "notificationUpdateFailed", "更新通知失败"); return }
	response.Success(c, http.StatusOK, gin.H{"updated": true})
}

func toDTO(value notificationdomain.Event) eventDTO { return eventDTO{ID: strconv.FormatUint(value.ID, 10), EventKey: value.EventKey, Severity: string(value.Severity), Title: value.Title, Body: value.Body, Status: string(value.Status), CreatedAt: value.CreatedAt, ReadAt: value.ReadAt, AcknowledgedAt: value.AcknowledgedAt, ExpiresAt: value.ExpiresAt} }
