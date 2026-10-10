package web

// benchmark_test.go 覆盖 internal/infra/provider/web 的纯 CPU 热点：
// 上游帧切分、单帧解析、入参归一化、流式工具协议脱敏、响应体组装与配额解码。
//
// 选取标准：每次请求/每个流分片都会执行、无 I/O、无网络、无 time.Now、
// 无 crypto/rand。输入取自同包 *_test.go 中真实观测到的上游报文形状
// （chat 流、streamingImageGenerationResponse、gRPC-Web 周额度抓包），
// 规模与生产量级一致，不使用空输入或 1 字节输入。
//
// 计时边界：所有 fixture 构造、JSON marshal、hex 解码都在 b.ResetTimer()
// 之前完成，不计入测量；stub 仅为一个丢弃输出的 emit 回调，不参与计时。

import (
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
)

// benchmarkSyncedAt 是固定观测时间，避免被测路径读取真实时钟。
var benchmarkSyncedAt = time.Date(2026, 8, 17, 4, 0, 0, 0, time.UTC)

// benchmarkStreamFixture 是一段真实形状的 Grok Web 上游流：
// conversation → 思考 token → 正文 token → tool_usage_card → modelResponse 终帧。
// 每帧 120~420 字节，共 200+ 帧，总量与一次真实长回答的流式响应同量级；
// 正文 token 帧同时携带 webSearchResults，覆盖 appendSearchSource 的 URL 归一化。
func benchmarkStreamFixture(tb testing.TB) []byte {
	tb.Helper()
	tokens := []string{
		"Grok Web 的流式响应会逐 token 下发，",
		"每次 token 事件都携带完整的 JSON envelope，",
		"因此解析器必须在热路径上尽量避免重复扫描与拷贝。",
		"下面这段文本用于模拟一个中等长度的回答内容。",
	}
	var builder strings.Builder
	builder.WriteString(`{"result":{"conversation":{"conversationId":"conv_bench_1"}}}`)
	builder.WriteString(`{"result":{"response":{"userResponse":{"responseId":"up_bench_1"}}}}`)
	for index := 0; index < 200; index++ {
		if index%17 == 3 {
			builder.WriteString(`{"result":{"response":{"messageTag":"tool_usage_card","token":"<grok:render card_id=\"c` +
				strconv.Itoa(index) +
				`\" card_type=\"web_search_card\" type=\"render_searched_image\"><argument name=\"query\">golang benchmark 设计要点</argument></grok:render>"}}}`)
			continue
		}
		thinking := index%5 == 0
		tag := "final"
		if thinking {
			tag = "analysis"
		}
		envelope, err := json.Marshal(map[string]any{
			"result": map[string]any{
				"response": map[string]any{
					"token":      tokens[index%len(tokens)] + strconv.Itoa(index),
					"isThinking": thinking,
					"messageTag": tag,
					"webSearchResults": map[string]any{"results": []any{
						map[string]any{
							"url":   "https://example.com/reference/" + strconv.Itoa(index),
							"title": "Reference " + strconv.Itoa(index),
						},
					}},
				},
			},
		})
		if err != nil {
			tb.Fatalf("marshal frame: %v", err)
		}
		builder.Write(envelope)
	}
	builder.WriteString(`{"result":{"response":{"modelResponse":{"message":"Grok Web 的流式响应会逐 token 下发，每次 token 事件都携带完整的 JSON envelope，因此解析器必须在热路径上尽量避免重复扫描与拷贝。"}}}}`)
	return []byte(builder.String())
}

// benchmarkFrames 把同一段 fixture 切成独立帧，供单帧 benchmark 复用。
func benchmarkFrames(tb testing.TB) [][]byte {
	tb.Helper()
	frames := make([][]byte, 0, 256)
	if err := consumeJSONObjects(strings.NewReader(string(benchmarkStreamFixture(tb))), 8<<20, func(frame []byte) error {
		frames = append(frames, append([]byte(nil), frame...))
		return nil
	}); err != nil {
		tb.Fatalf("consumeJSONObjects: %v", err)
	}
	if len(frames) < 100 {
		tb.Fatalf("fixture 只切出 %d 帧，规模不足", len(frames))
	}
	return frames
}

// BenchmarkConsumeJSONObjects 测量 JSON 帧切分吞吐（chat_parse.go:86）。
// 这是所有上游流式路径的第一道热路径：bufio 逐字节读 + 手写深度/字符串扫描。
// 输入 ~46 KiB 的真实形状流，b.SetBytes 报告 MB/s。
func BenchmarkConsumeJSONObjects(b *testing.B) {
	data := benchmarkStreamFixture(b)
	b.SetBytes(int64(len(data)))
	b.ReportAllocs()
	b.ResetTimer()
	for index := 0; index < b.N; index++ {
		count := 0
		if err := consumeJSONObjects(strings.NewReader(string(data)), 8<<20, func([]byte) error {
			count++
			return nil
		}); err != nil {
			b.Fatalf("consumeJSONObjects: %v", err)
		}
		if count < 100 {
			b.Fatalf("帧数 = %d", count)
		}
	}
}

// BenchmarkParseUpstreamFrame 测量单帧解析（chat_parse.go:178）：
// json.Unmarshal → conversation/response 分派 → token/messageTag 分类 →
// webSearchResults 登记（searchresult.NormalizeURL 含 url.Parse）与
// tool_usage_card 的 collectServerTool。SetBytes 为平均帧大小。
// fixture 不包含 card 渲染帧，因此不触及 newWebID(crypto/rand)，完全可复现。
func BenchmarkParseUpstreamFrame(b *testing.B) {
	frames := benchmarkFrames(b)
	total := 0
	for _, frame := range frames {
		total += len(frame)
	}
	b.SetBytes(int64(total / len(frames)))
	b.ReportAllocs()
	b.ResetTimer()
	for index := 0; index < b.N; index++ {
		parsed := parsedChat{}
		kind, _, err := parseUpstreamFrame(frames[index%len(frames)], &parsed)
		if err != nil {
			b.Fatalf("parseUpstreamFrame: %v", err)
		}
		if kind == "" && parsed.ConversationID == "" && parsed.ParentID == "" && parsed.ServerTools == 0 &&
			len(parsed.SearchSources) == 0 && parsed.Text.Len() == 0 {
			b.Fatalf("第 %d 帧未被任何分支消费", index%len(frames))
		}
	}
}

// BenchmarkNormalizeOpenAIInput 测量 OpenAI 兼容入参归一化（chat_request.go:41）：
// 32 条消息，含字符串 content、多模态 content 数组（input_text + input_file）、
// function_call 消息，覆盖 renderRequestMessages 的全部分支；
// input_file 恰好 8 个，触及 maxChatAttachments 上限校验但仍合法。
// 输入为已序列化好的 json.RawMessage，衡量的是解码与渲染而非 marshal。
func BenchmarkNormalizeOpenAIInput(b *testing.B) {
	raw, err := json.Marshal(benchmarkMessages(32))
	if err != nil {
		b.Fatalf("marshal messages: %v", err)
	}
	input := openAIRequest{Input: raw}
	b.SetBytes(int64(len(raw)))
	b.ReportAllocs()
	b.ResetTimer()
	for index := 0; index < b.N; index++ {
		result, err := normalizeOpenAIInput(input, "responses")
		if err != nil {
			b.Fatalf("normalizeOpenAIInput: %v", err)
		}
		if result.Prompt == "" {
			b.Fatal("prompt 为空")
		}
	}
}

// benchmarkMessages 构造真实请求形态的消息数组。
func benchmarkMessages(count int) []any {
	messages := make([]any, 0, count)
	for index := 0; index < count; index++ {
		switch index % 4 {
		case 0:
			messages = append(messages, map[string]any{
				"role": "user", "content": "第 " + strconv.Itoa(index) + " 轮：请解释 Grok Web 适配层的分层与职责边界。",
			})
		case 1:
			messages = append(messages, map[string]any{"role": "assistant", "content": []any{
				map[string]any{"type": "output_text", "text": "第 " + strconv.Itoa(index) + " 轮回答：传输层只做帧解析，领域层不做基础设施决策。"},
			}})
		case 2:
			messages = append(messages, map[string]any{"role": "user", "content": []any{
				map[string]any{"type": "input_text", "text": "第 " + strconv.Itoa(index) + " 轮：文本与文件附件混排。"},
				map[string]any{
					"type": "input_file", "filename": "bench-" + strconv.Itoa(index) + ".txt",
					"file_url": "https://files.example.com/bench/" + strconv.Itoa(index) + ".txt",
				},
			}})
		default:
			messages = append(messages, map[string]any{
				"type": "function_call", "name": "lookup_quota",
				"arguments": `{"account_id":` + strconv.Itoa(index) + `,"mode":"weekly"}`,
			})
		}
	}
	return messages
}

// BenchmarkBuildOpenAIChatResult 测量已完成会话 → Chat Completions 响应体组装
// （chat_response.go:32）：token 估算、40 条引用注解、8 个工具调用、
// 顶层 citations 与 server_side_tool_usage 去重。
// 输入为 ~8 KiB 正文 + ~4 KiB reasoning + 40 sources + 8 tool calls。
// fixture 的 DisableInlineCitations=false，finalizeXAIAnnotations 直接返回，
// 因此对本 fixture 无副作用、可重复迭代同一份 parsedChat。
// created 由参数传入（非 time.Now），无时钟依赖。
func BenchmarkBuildOpenAIChatResult(b *testing.B) {
	parsed := benchmarkParsedChat()
	const created = 1784000000
	b.ReportAllocs()
	b.ResetTimer()
	for index := 0; index < b.N; index++ {
		value := buildOpenAIChatResult("resp_bench_1", "grok-4-fast", &parsed, created, 4096, 1024)
		if value["object"] != "chat.completion" {
			b.Fatal("unexpected result shape")
		}
	}
}

// benchmarkParsedChat 构造规模真实的已完成会话。
func benchmarkParsedChat() parsedChat {
	parsed := parsedChat{ResponseID: "resp_bench_1", ConversationID: "conv_bench_1"}
	var text strings.Builder
	for index := 0; index < 128; index++ {
		text.WriteString("这是第 ")
		text.WriteString(strconv.Itoa(index))
		text.WriteString(" 段回答内容，用于模拟真实长度的模型输出，包含中英文混排 mixed content 与标点。\n")
	}
	parsed.Text.WriteString(text.String())
	for index := 0; index < 64; index++ {
		parsed.Reasoning.WriteString("reasoning step ")
		parsed.Reasoning.WriteString(strconv.Itoa(index))
		parsed.Reasoning.WriteString(": 检查限额、权限与状态流转是否一致。\n")
	}
	parsed.SearchSources = make([]map[string]any, 0, 40)
	for index := 0; index < 40; index++ {
		parsed.SearchSources = append(parsed.SearchSources, map[string]any{
			"url":   "https://example.com/source/" + strconv.Itoa(index),
			"title": "Benchmark 参考资料 " + strconv.Itoa(index),
			"type":  "web",
		})
	}
	for index := 0; index < 8; index++ {
		parsed.ToolCalls = append(parsed.ToolCalls, parsedToolCall{
			ID: "call_" + strconv.Itoa(index), Name: "bench_tool_" + strconv.Itoa(index) + "_lookup",
			Arguments: `{"account_id":` + strconv.Itoa(index) + `,"mode":"weekly"}`,
		})
	}
	parsed.Tools = []any{map[string]any{"type": "web_search"}}
	parsed.ToolChoice = "auto"
	parsed.WebSearchTools = 3
	parsed.ServerTools = 3
	parsed.InputTokens = 4096
	return parsed
}

// BenchmarkParseWeeklyCreditsResponse 测量周额度 gRPC-Web + protobuf 全链路解码
// （quota.go:648）：帧切分 → gRPC 状态校验 → 目标字段提取 → 字段遍历 →
// 时间戳解析 → 产品分解 → 周期校验。body 是 quota_test.go 中真实抓包的
// gRPC-Web 响应（含 grpc-status trailer），共 111 字节。
func BenchmarkParseWeeklyCreditsResponse(b *testing.B) {
	const capturedWeeklyCreditsHex = "00000000630a610d0000304112001a00220c089abbccd2061080f2d1fc012a0c089ab0f1d2061080f2d1fc013a07080515000020413a070804150000803f3a020802421e0802120c089abbccd2061080f2d1fc011a0c089ab0f1d2061080f2d1fc01580162006801800000000f677270632d7374617475733a300d0a"
	body, err := hex.DecodeString(capturedWeeklyCreditsHex)
	if err != nil {
		b.Fatalf("decode hex: %v", err)
	}
	syncedAt := benchmarkSyncedAt
	b.SetBytes(int64(len(body)))
	b.ReportAllocs()
	b.ResetTimer()
	for index := 0; index < b.N; index++ {
		window, err := parseWeeklyCreditsResponse(body, 42, syncedAt)
		if err != nil {
			b.Fatalf("parseWeeklyCreditsResponse: %v", err)
		}
		if window.Mode != weeklyQuotaMode || len(window.Breakdown) != 3 {
			b.Fatalf("window = %#v", window)
		}
	}
}

// BenchmarkInferWebTierFromQuota 测量额度窗口 → 套餐等级判定（quota.go:219）。
// 输入使用该函数真实依赖的 /rest/rate-limits 形态：auto/fast/heavy + 周额度，
// Total 取已登记的真实档位值（auto 150 / fast 400 → Heavy），并同时提供
// 窗口总数 6 个（5 个模式 + 周额度），覆盖 rank 比较与候选收敛。
// 每次额度同步与路由前置判定都会执行，纯 map 构造与标量比较。
func BenchmarkInferWebTierFromQuota(b *testing.B) {
	now := benchmarkSyncedAt
	windows := []account.QuotaWindow{
		{AccountID: 42, Mode: "auto", Remaining: 120, Total: 150, WindowSeconds: 7200},
		{AccountID: 42, Mode: "fast", Remaining: 380, Total: 400, WindowSeconds: 7200},
		{AccountID: 42, Mode: "heavy", Remaining: 18, Total: 20, WindowSeconds: 7200},
		{AccountID: 42, Mode: account.QuotaModeWebImagePro, Remaining: 2, Total: 0, WindowSeconds: 86400},
		{AccountID: 42, Mode: account.QuotaModeWebVideo720p, Remaining: 0, Total: 0, WindowSeconds: 86400},
		{
			AccountID: 42, Mode: weeklyQuotaMode, Remaining: 8900, Total: 10000,
			UsagePercent: 11, WindowSeconds: 7 * 24 * 60 * 60,
		},
	}
	for index := range windows {
		windows[index].ResetAt = &now
		windows[index].SyncedAt = &now
		windows[index].Source = account.QuotaSourceUpstream
		windows[index].UpdatedAt = now
	}
	b.ReportAllocs()
	b.ResetTimer()
	for index := 0; index < b.N; index++ {
		tier, known := inferWebTierFromQuota(windows)
		if !known || tier != account.WebTierHeavy {
			b.Fatalf("tier = %q known = %v，want heavy/true", tier, known)
		}
	}
}
