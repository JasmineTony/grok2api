package protocolgolden

import (
	"bufio"
	"bytes"
	"encoding/json"
	"strings"
)

// NormalizeJSON removes volatile identifiers and recursively sorts object keys.
// It intentionally keeps protocol fields and array order unchanged.
func NormalizeJSON(input []byte) ([]byte, error) {
	var value any
	if err := json.Unmarshal(input, &value); err != nil {
		return nil, err
	}
	normalized := normalizeValue(value)
	var output bytes.Buffer
	encoder := json.NewEncoder(&output)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(normalized); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(output.Bytes(), []byte("\n")), nil
}

func normalizeValue(value any) any {
	switch current := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(current))
		for key, value := range current {
			switch strings.ToLower(key) {
			case "id", "request_id", "created", "created_at", "timestamp":
				result[key] = "<normalized>"
			default:
				result[key] = normalizeValue(value)
			}
		}
		return orderedObject(result)
	case []any:
		for i := range current {
			current[i] = normalizeValue(current[i])
		}
	}
	return value
}

// orderedObject returns a map with stable JSON encoding by using a custom value.
// encoding/json sorts string map keys, so the map is enough after normalization.
func orderedObject(value map[string]any) map[string]any { return value }

// NormalizeSSE normalizes each non-empty SSE data JSON event and leaves event names intact.
func NormalizeSSE(input []byte) ([]byte, error) {
	var output bytes.Buffer
	scanner := bufio.NewScanner(bytes.NewReader(input))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "data:") {
			payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if payload != "" && payload != "[DONE]" {
				normalized, err := NormalizeJSON([]byte(payload))
				if err != nil {
					return nil, err
				}
				line = "data: " + string(normalized)
			}
		}
		output.WriteString(line)
		output.WriteByte('\n')
	}
	return output.Bytes(), scanner.Err()
}

// StableJSONEqual compares normalized JSON documents.
func StableJSONEqual(left, right []byte) (bool, error) {
	l, err := NormalizeJSON(left)
	if err != nil {
		return false, err
	}
	r, err := NormalizeJSON(right)
	if err != nil {
		return false, err
	}
	return bytes.Equal(l, r), nil
}
