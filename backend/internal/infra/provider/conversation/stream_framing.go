package conversation

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"strings"
)

func consumeSSE(source io.Reader, handle func(string, []byte) error) error {
	reader := bufio.NewReaderSize(source, 64<<10)
	var event string
	var data strings.Builder
	for {
		line, err := reader.ReadString('\n')
		if line != "" {
			line = strings.TrimRight(line, "\r\n")
			switch {
			case strings.HasPrefix(line, "event:"):
				event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			case strings.HasPrefix(line, "data:"):
				if data.Len() > 0 {
					data.WriteByte('\n')
				}
				data.WriteString(strings.TrimSpace(strings.TrimPrefix(line, "data:")))
			case line == "":
				if data.Len() > 0 {
					if handleErr := handle(event, []byte(data.String())); handleErr != nil {
						return handleErr
					}
				}
				event = ""
				data.Reset()
			}
		}
		if err != nil {
			if err == io.EOF {
				if data.Len() > 0 {
					return handle(event, []byte(data.String()))
				}
				return nil
			}
			return err
		}
	}
}

func parseSSEEvent(event string, data []byte) (string, map[string]json.RawMessage, bool) {
	if bytes.Equal(bytes.TrimSpace(data), []byte("[DONE]")) {
		return "", nil, false
	}
	var root map[string]json.RawMessage
	if json.Unmarshal(data, &root) != nil {
		return "", nil, false
	}
	typeName := event
	if typeName == "" {
		_ = json.Unmarshal(root["type"], &typeName)
	}
	return typeName, root, true
}
