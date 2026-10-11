package web

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"math"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"google.golang.org/protobuf/encoding/protowire"
)

func firstGRPCWebMessage(body []byte) ([]byte, error) {
	message, grpcStatus, err := parseGRPCWebFrames(body)
	if err != nil {
		return nil, err
	}
	if grpcStatus != "" && grpcStatus != "0" {
		return nil, fmt.Errorf("Grok Web 周额度 gRPC 状态为 %s", grpcStatus)
	}
	if message == nil {
		return nil, fmt.Errorf("Grok Web 周额度响应缺少消息帧")
	}
	return message, nil
}

func parseGRPCWebFrames(body []byte) ([]byte, string, error) {
	var message []byte
	grpcStatus := ""
	for len(body) > 0 {
		if len(body) < 5 {
			return nil, "", fmt.Errorf("gRPC-Web 响应包含不完整帧头")
		}
		flag := body[0]
		length := int(binary.BigEndian.Uint32(body[1:5]))
		body = body[5:]
		if length < 0 || length > len(body) {
			return nil, "", fmt.Errorf("gRPC-Web 帧长度无效")
		}
		payload := body[:length]
		body = body[length:]
		if flag&0x80 == 0 {
			if flag != 0 {
				return nil, "", fmt.Errorf("不支持压缩的 gRPC-Web 响应")
			}
			if message == nil {
				message = append([]byte(nil), payload...)
			}
			continue
		}
		for _, line := range bytes.Split(payload, []byte{'\n'}) {
			name, value, ok := bytes.Cut(bytes.TrimSpace(line), []byte{':'})
			if ok && string(bytes.ToLower(bytes.TrimSpace(name))) == "grpc-status" {
				grpcStatus = string(bytes.TrimSpace(value))
			}
		}
	}
	return message, grpcStatus, nil
}

func protobufMessageField(message []byte, target protowire.Number) ([]byte, error) {
	for len(message) > 0 {
		number, fieldType, n := protowire.ConsumeTag(message)
		if n < 0 {
			return nil, fmt.Errorf("protobuf tag 无效")
		}
		message = message[n:]
		if number == target && fieldType == protowire.BytesType {
			value, consumed := protowire.ConsumeBytes(message)
			if consumed < 0 {
				return nil, fmt.Errorf("protobuf message 无效")
			}
			return value, nil
		}
		consumed := protowire.ConsumeFieldValue(number, fieldType, message)
		if consumed < 0 {
			return nil, fmt.Errorf("protobuf 字段无效")
		}
		message = message[consumed:]
	}
	return nil, fmt.Errorf("protobuf 缺少字段 %d", target)
}

func parseProtoTimestamp(message []byte) (time.Time, error) {
	var seconds int64
	var nanos int32
	for len(message) > 0 {
		number, fieldType, n := protowire.ConsumeTag(message)
		if n < 0 {
			return time.Time{}, fmt.Errorf("protobuf timestamp tag 无效")
		}
		message = message[n:]
		if fieldType == protowire.VarintType && (number == 1 || number == 2) {
			value, consumed := protowire.ConsumeVarint(message)
			if consumed < 0 {
				return time.Time{}, fmt.Errorf("protobuf timestamp 值无效")
			}
			if number == 1 {
				seconds = int64(value)
			} else {
				nanos = int32(value)
			}
			message = message[consumed:]
			continue
		}
		consumed := protowire.ConsumeFieldValue(number, fieldType, message)
		if consumed < 0 {
			return time.Time{}, fmt.Errorf("protobuf timestamp 字段无效")
		}
		message = message[consumed:]
	}
	if seconds <= 0 || nanos < 0 || nanos >= int32(time.Second) {
		return time.Time{}, fmt.Errorf("protobuf timestamp 范围无效")
	}
	return time.Unix(seconds, int64(nanos)).UTC(), nil
}

func parseQuotaBreakdown(message []byte) (account.QuotaBreakdown, bool) {
	var result account.QuotaBreakdown
	var codePresent bool
	for len(message) > 0 {
		number, fieldType, n := protowire.ConsumeTag(message)
		if n < 0 {
			return account.QuotaBreakdown{}, false
		}
		message = message[n:]
		switch {
		case number == 1 && fieldType == protowire.VarintType:
			value, consumed := protowire.ConsumeVarint(message)
			if consumed < 0 {
				return account.QuotaBreakdown{}, false
			}
			result.ProductCode = int(value)
			codePresent = true
			message = message[consumed:]
		case number == 2 && fieldType == protowire.Fixed32Type:
			value, consumed := protowire.ConsumeFixed32(message)
			if consumed < 0 {
				return account.QuotaBreakdown{}, false
			}
			result.UsagePercent = float64(math.Float32frombits(value))
			message = message[consumed:]
		default:
			consumed := protowire.ConsumeFieldValue(number, fieldType, message)
			if consumed < 0 {
				return account.QuotaBreakdown{}, false
			}
			message = message[consumed:]
		}
	}
	if !codePresent || result.ProductCode < 0 || result.UsagePercent < 0 || result.UsagePercent > 100 || math.IsNaN(result.UsagePercent) || math.IsInf(result.UsagePercent, 0) {
		return account.QuotaBreakdown{}, false
	}
	return result, true
}
