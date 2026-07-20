package system

import (
	"net/http"
	"strings"

	backupapp "github.com/chenyme/grok2api/backend/internal/application/backup"
	updatecheckapp "github.com/chenyme/grok2api/backend/internal/application/updatecheck"
	"github.com/chenyme/grok2api/backend/internal/shared/response"
	"github.com/gin-gonic/gin"
)

type Handler struct {
	publicAPIBaseURL func() string
	updates          *updatecheckapp.Service
	backup           *backupapp.Service
}

func NewHandler(publicAPIBaseURL func() string, updates *updatecheckapp.Service, backups ...*backupapp.Service) *Handler {
	if publicAPIBaseURL == nil {
		publicAPIBaseURL = func() string { return "" }
	}
	if updates == nil {
		updates = updatecheckapp.NewService("dev", nil)
	}
	var backupService *backupapp.Service
	if len(backups) > 0 {
		backupService = backups[0]
	}
	return &Handler{publicAPIBaseURL: publicAPIBaseURL, updates: updates, backup: backupService}
}

func (h *Handler) Register(router *gin.RouterGroup) {
	router.GET("/system", h.get)
	router.GET("/system/version", h.version)
	router.POST("/system/update/check", h.checkUpdate)
	router.GET("/system/upgrade/preflight", h.preflight)
}

func (h *Handler) version(c *gin.Context) {
	response.Success(c, http.StatusOK, h.updates.Snapshot())
}

func (h *Handler) checkUpdate(c *gin.Context) {
	h.updates.Check(c.Request.Context())
	response.Success(c, http.StatusOK, h.updates.CheckUpstream(c.Request.Context()))
}

func (h *Handler) get(c *gin.Context) {
	response.Success(c, http.StatusOK, gin.H{"publicApiBaseURL": strings.TrimRight(strings.TrimSpace(h.publicAPIBaseURL()), "/")})
}

func (h *Handler) preflight(c *gin.Context) {
	if h.backup == nil {
		response.Error(c, http.StatusNotImplemented, "upgradePreflightUnavailable", "upgrade preflight is not configured")
		return
	}
	report := h.backup.Preflight(c.Request.Context(), strings.TrimSpace(c.Query("backupRoot")))
	status := http.StatusOK
	if !report.Ready {
		status = http.StatusPreconditionFailed
	}
	response.Success(c, status, report)
}
