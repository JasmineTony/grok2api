package protocolview
import("encoding/json";"net/http";app "github.com/chenyme/grok2api/backend/internal/application/protocolview";"github.com/chenyme/grok2api/backend/internal/shared/response";"github.com/gin-gonic/gin")
type Handler struct{}
func NewHandler()*Handler{return &Handler{}}
func(h *Handler)Register(router *gin.RouterGroup){router.POST("/protocol/conversions/preview",h.preview)}
type request struct{Source string `json:"source"`;Target string `json:"target"`;Payload json.RawMessage `json:"payload"`}
func(h *Handler)preview(c *gin.Context){var value request;if c.ShouldBindJSON(&value)!=nil{response.Error(c,http.StatusBadRequest,"invalidProtocolPreview","invalid preview request");return};preview,err:=app.Convert(value.Source,value.Target,value.Payload);if err!=nil{response.Error(c,http.StatusBadRequest,"protocolPreviewFailed",err.Error());return};response.Success(c,http.StatusOK,preview)}
