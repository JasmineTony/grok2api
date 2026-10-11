package audit

import (
	"encoding/json"
	"sort"
	"strings"

	auditdomain "github.com/chenyme/grok2api/backend/internal/domain/audit"
)

func sanitizeRequestMetadata(value auditdomain.Record) auditdomain.Record {
	// Query strings can contain credentials or signed resource URLs. Endpoint
	// identity only needs the path.
	value.RequestMethod = truncateRequestMetadata(strings.ToUpper(strings.TrimSpace(value.RequestMethod)), requestMethodLimit)
	value.RequestPath = truncateRequestMetadata(strings.SplitN(value.RequestPath, "?", 2)[0], requestPathLimit)
	if len(value.RequestHeaders) == 0 {
		value.RequestHeaders = nil
		return value
	}
	names := make([]string, 0, len(value.RequestHeaders))
	for name := range value.RequestHeaders {
		names = append(names, name)
	}
	sort.Strings(names)
	result := make(map[string][]string, len(value.RequestHeaders))
	for _, originalName := range names {
		if len(result) >= requestHeaderCountLimit {
			break
		}
		name := truncateRequestMetadata(strings.TrimSpace(originalName), requestHeaderNameLimit)
		if name == "" {
			continue
		}
		values := value.RequestHeaders[originalName]
		cloned := make([]string, 0, len(values))
		if isSensitiveRequestHeader(name) {
			cloned = []string{"[REDACTED]"}
		} else {
			for _, item := range values[:min(len(values), requestHeaderValuesLimit)] {
				cloned = append(cloned, truncateRequestMetadata(item, requestHeaderValueLimit))
			}
		}
		result[name] = cloned
		encoded, err := json.Marshal(result)
		if err != nil || len(encoded) > requestHeadersLimit {
			delete(result, name)
			break
		}
	}
	value.RequestHeaders = result
	return value
}

func truncateRequestMetadata(value string, limit int) string {
	value = strings.ToValidUTF8(value, "�")
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func isSensitiveRequestHeader(name string) bool {
	name = strings.ToLower(strings.TrimSpace(name))
	for _, marker := range []string{
		"auth", "cookie", "credential", "dpop", "jwt", "key", "password", "secret", "session", "signature", "token",
	} {
		if strings.Contains(name, marker) {
			return true
		}
	}
	return false
}
