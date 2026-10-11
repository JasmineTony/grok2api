package audit

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	auditdomain "github.com/chenyme/grok2api/backend/internal/domain/audit"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

func (s *Service) List(ctx context.Context, page, pageSize int) ([]auditdomain.Record, int64, error) {
	page, pageSize = repository.NormalizePage(page, pageSize, repository.DefaultPageSize)
	return s.audits.List(ctx, (page-1)*pageSize, pageSize)
}

func (s *Service) Get(ctx context.Context, id uint64) (auditdomain.Record, error) {
	return s.audits.Get(ctx, id)
}

// PurgeOutdated 清理超过指定保留天数的历史审计记录。
func (s *Service) PurgeOutdated(ctx context.Context, retentionDays int) (int64, error) {
	if retentionDays <= 0 {
		return 0, nil
	}
	cutoff := time.Now().UTC().AddDate(0, 0, -retentionDays)
	return s.audits.PurgeOlderThan(ctx, cutoff)
}

// CursorResult 表示按递减 ID 游标读取的一页审计记录。
type CursorResult struct {
	Items      []auditdomain.Record
	NextCursor string
	HasMore    bool
}

type ListFilter struct {
	Model   string
	Status  string
	Mode    string
	Key     string
	Account string
	Sort    repository.SortQuery
}

type auditCursorPayload struct {
	Version   int                      `json:"v"`
	Field     string                   `json:"field"`
	Direction repository.SortDirection `json:"direction"`
	ID        uint64                   `json:"id"`
	Value     string                   `json:"value"`
}

// ListCursor 使用复合游标读取审计，适合持续增长且支持多字段排序的大数据列表。
func (s *Service) ListCursor(ctx context.Context, rawCursor string, pageSize int, search, rawPeriod string, filter ListFilter) (CursorResult, error) {
	_, pageSize = repository.NormalizePage(1, pageSize, repository.DefaultCursorPageSize)
	if filter.Sort.Field == "" && filter.Sort.Direction == "" {
		filter.Sort = repository.SortQuery{Field: "createdAt", Direction: repository.SortDescending}
	}
	if !validAuditFilter(filter.Status, "", "success", "clientError", "serverError", "2xx", "4xx", "5xx", "other") || !validAuditFilter(filter.Mode, "", "stream", "nonStream") || !repository.IsValidSort(filter.Sort, "request", "model", "billing", "tokens", "status", "mode", "duration", "createdAt") {
		return CursorResult{}, ErrInvalidFilter
	}
	cursor, err := decodeAuditCursor(rawCursor, filter.Sort)
	if err != nil {
		return CursorResult{}, err
	}
	_, start, end, err := s.resolvePeriod(rawPeriod)
	if err != nil {
		return CursorResult{}, err
	}
	items, hasMore, err := s.audits.ListCursor(ctx, repository.AuditCursorQuery{Cursor: cursor, Limit: pageSize, Search: search, Start: start, End: end, Sort: filter.Sort, Filter: repository.AuditListFilter{
		Model: filter.Model, Status: filter.Status, Mode: filter.Mode, Key: filter.Key, Account: filter.Account,
	}})
	if err != nil {
		return CursorResult{}, err
	}
	result := CursorResult{Items: items, HasMore: hasMore}
	if hasMore && len(items) > 0 {
		result.NextCursor, err = encodeAuditCursor(items[len(items)-1], filter.Sort)
		if err != nil {
			return CursorResult{}, err
		}
	}
	return result, nil
}

func decodeAuditCursor(raw string, sort repository.SortQuery) (*repository.SortCursor, error) {
	if raw == "" {
		return nil, nil
	}
	encoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, ErrInvalidCursor
	}
	var payload auditCursorPayload
	if json.Unmarshal(encoded, &payload) != nil || payload.Version != 1 || payload.ID == 0 || payload.Field != sort.Field || payload.Direction != sort.Direction {
		return nil, ErrInvalidCursor
	}
	value, err := parseAuditCursorValue(payload.Field, payload.Value)
	if err != nil {
		return nil, ErrInvalidCursor
	}
	return &repository.SortCursor{ID: payload.ID, Value: value}, nil
}

func encodeAuditCursor(value auditdomain.Record, sort repository.SortQuery) (string, error) {
	payload := auditCursorPayload{Version: 1, Field: sort.Field, Direction: sort.Direction, ID: value.ID, Value: formatAuditCursorValue(value, sort.Field)}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(encoded), nil
}

func parseAuditCursorValue(field, value string) (any, error) {
	switch field {
	case "request", "model":
		return value, nil
	case "billing", "tokens", "status", "mode", "duration":
		return strconv.ParseInt(value, 10, 64)
	case "createdAt":
		return time.Parse(time.RFC3339Nano, value)
	default:
		return nil, ErrInvalidCursor
	}
}

func formatAuditCursorValue(value auditdomain.Record, field string) string {
	switch field {
	case "request":
		return value.RequestID
	case "model":
		return strings.ToLower(value.ModelPublicID)
	case "billing":
		amount := value.CostInUSDTicks
		if amount == 0 {
			amount = value.EstimatedCostInUSDTicks
		}
		return strconv.FormatInt(amount, 10)
	case "tokens":
		return strconv.FormatInt(value.TotalTokens, 10)
	case "status":
		return strconv.Itoa(value.StatusCode)
	case "mode":
		if value.Streaming {
			return "1"
		}
		return "0"
	case "duration":
		return strconv.FormatInt(value.DurationMS, 10)
	default:
		return value.CreatedAt.UTC().Format(time.RFC3339Nano)
	}
}
