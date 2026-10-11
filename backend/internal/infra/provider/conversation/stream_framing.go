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
			if lineErr := consumeSSELine(strings.TrimRight(line, "\r\n"), &event, &data, handle); lineErr != nil {
				return lineErr
			}
		}
		if err != nil {
			return finishSSEStream(err, event, &data, handle)
		}
	}
}

// consumeSSELine 解析单行 SSE 帧；空行表示事件结束，派发已缓冲的 event/data。
func consumeSSELine(line string, event *string, data *strings.Builder, handle func(string, []byte) error) error {
	switch {
	case strings.HasPrefix(line, "event:"):
		*event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
	case strings.HasPrefix(line, "data:"):
		if data.Len() > 0 {
			data.WriteByte('\n')
		}
		data.WriteString(strings.TrimSpace(strings.TrimPrefix(line, "data:")))
	case line == "":
		if data.Len() > 0 {
			if handleErr := handle(*event, []byte(data.String())); handleErr != nil {
				return handleErr
			}
		}
		*event = ""
		data.Reset()
	}
	return nil
}

// finishSSEStream 在读取结束时结算缓冲：EOF 且有未派发数据时补派发一次。
func finishSSEStream(err error, event string, data *strings.Builder, handle func(string, []byte) error) error {
	if err != io.EOF {
		return err
	}
	if data.Len() > 0 {
		return handle(event, []byte(data.String()))
	}
	return nil
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
