package web

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	inferencedomain "github.com/chenyme/grok2api/backend/internal/domain/inference"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/infra/provider/conversation"
)

func (a *Adapter) streamOpenAIResponse(ctx context.Context, source io.ReadCloser, lease *infraegress.Lease, credential account.Credential, responseID, model, operation, prompt string, previous *inferencedomain.WebResponseState, tools toolConfiguration, parallelTools bool, options conversation.ResponseOptions) io.ReadCloser {
	reader, writer := io.Pipe()
	go func() {
		defer source.Close()
		defer lease.Release()
		sink, sieve := newOpenAIStreamSink(writer, operation, responseID, model, prompt, tools, parallelTools, previous, options)
		if operation != conversation.OperationMessages {
			writeStreamStart(writer, operation, responseID, model, sink.parsed.InputTokens)
		}
		err := consumeUpstreamInto(source, sink.parsed, func(kind, delta string) error {
			if len(sink.parsed.ToolCalls) > 0 && kind != "reasoning" {
				return sink.flushSideChannel()
			}
			if kind == "image" {
				archived, imageErr := a.archiveStreamImage(ctx, credential, sink.parsed, sink.archivedImages, delta)
				if imageErr != nil {
					return imageErr
				}
				delta, kind = archived, "text"
			}
			if kind == "text" && sieve != nil {
				return applyToolStreamSieve(sieve, delta, &sink.clientText, sink.parsed, sink.delta, sink.toolCalls, sink.flushSideChannel)
			}
			return writeStreamDeltaDirect(kind, delta, &sink.clientText, sink.delta, sink.flushSideChannel)
		})
		if err != nil {
			a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, 0, err)
			_ = writer.CloseWithError(err)
			return
		}
		if sieve != nil && len(sink.parsed.ToolCalls) == 0 {
			if flushErr := finishToolStreamSieve(sieve, sink.parsed, &sink.clientText, sink.delta, sink.toolCalls); flushErr != nil {
				_ = writer.CloseWithError(flushErr)
				return
			}
		}
		if len(sink.parsed.ToolCalls) == 0 {
			if imageErr := a.streamRemainingArchivedImages(ctx, credential, sink.parsed, sink.archivedImages, &sink.clientText, sink.delta); imageErr != nil {
				_ = writer.CloseWithError(imageErr)
				return
			}
		}
		if finishErr := a.finalizeOpenAIStream(ctx, writer, lease, credential, sink, &sink.clientText, options); finishErr != nil {
			_ = writer.CloseWithError(finishErr)
			return
		}
		_ = writer.Close()
	}()
	return reader
}

// openAIStreamSink 持有 OpenAI 兼容流式输出的可变状态，仅由所属 goroutine 使用。
type openAIStreamSink struct {
	writer              io.Writer
	operation           string
	responseID          string
	model               string
	parsed              *parsedChat
	messagesStream      *webMessagesStream
	responsesStream     *webResponsesStream
	visiblePhase        webVisibleStreamPhase
	annotationCursor    int
	hostedSearchEmitted map[string]struct{}
	clientText          strings.Builder
	archivedImages      map[string]struct{}
}

// newOpenAIStreamSink 按原始顺序装配流式解析状态与首次输出所需的下游流。
func newOpenAIStreamSink(writer io.Writer, operation, responseID, model, prompt string, tools toolConfiguration, parallelTools bool, previous *inferencedomain.WebResponseState, options conversation.ResponseOptions) (*openAIStreamSink, *toolStreamSieve) {
	parsed := &parsedChat{
		ResponseID: responseID, InputTokens: estimateTokens(prompt), Tools: tools.ResponseTools,
		ToolChoice: tools.ResponseChoice, ParallelTools: parallelTools,
		DisableInlineCitations: !options.InlineCitationsEnabled(),
	}
	if previous != nil {
		parsed.ConversationID = previous.ConversationID
	}
	var sieve *toolStreamSieve
	if len(tools.Functions) > 0 && tools.Choice != "none" {
		sieve = newToolStreamSieve(tools.available)
	}
	sink := &openAIStreamSink{
		writer: writer, operation: operation, responseID: responseID, model: model, parsed: parsed,
		messagesStream:      newWebMessagesStream(writer, responseID, model, parsed.InputTokens, options),
		hostedSearchEmitted: make(map[string]struct{}),
		archivedImages:      make(map[string]struct{}),
	}
	if operation == conversation.OperationResponses {
		sink.responsesStream = newWebResponsesStream(writer, responseID)
	}
	return sink, sieve
}

// delta 是可见分片写出闸门：先经可见阶段过滤，再按协议选择 Responses 或 Messages 通道。
func (s *openAIStreamSink) delta(kind, delta string) error {
	if !s.visiblePhase.Allow(kind, delta) {
		return nil
	}
	if s.responsesStream != nil {
		return s.responsesStream.Delta(kind, delta)
	}
	return writeWebStreamDelta(s.writer, s.messagesStream, s.operation, s.responseID, s.model, kind, delta)
}

func (s *openAIStreamSink) toolCalls(calls []parsedToolCall) error {
	if s.responsesStream != nil {
		return s.responsesStream.ToolCalls(calls)
	}
	return writeWebStreamToolCalls(s.writer, s.messagesStream, s.operation, s.responseID, s.model, calls)
}

// flushAnnotations 只补写游标之后新增的注解，保持原有游标推进顺序。
func (s *openAIStreamSink) flushAnnotations() error {
	if s.annotationCursor >= len(s.parsed.Annotations) {
		return nil
	}
	newOnes := s.parsed.Annotations[s.annotationCursor:]
	s.annotationCursor = len(s.parsed.Annotations)
	if s.responsesStream != nil {
		return s.responsesStream.Annotations(newOnes, s.annotationCursor-len(newOnes))
	}
	return writeStreamAnnotations(s.writer, s.operation, s.responseID, s.model, newOnes, s.annotationCursor-len(newOnes))
}

func (s *openAIStreamSink) flushHostedSearch() error {
	if s.operation != conversation.OperationResponses {
		return nil
	}
	for _, call := range s.parsed.HostedSearchCalls {
		// Wait until the tool_result arrives (completed / has sources).
		if call.Status != "completed" && len(call.Sources) == 0 {
			continue
		}
		if _, emitted := s.hostedSearchEmitted[call.ID]; emitted {
			continue
		}
		if err := s.responsesStream.HostedSearch(call); err != nil {
			return err
		}
		s.hostedSearchEmitted[call.ID] = struct{}{}
	}
	return nil
}

func (s *openAIStreamSink) flushSideChannel() error {
	if err := s.flushHostedSearch(); err != nil {
		return err
	}
	return s.flushAnnotations()
}

// archiveStreamImage 把流内联图片落盘为归档项并返回追加到正文的分片。
func (a *Adapter) archiveStreamImage(ctx context.Context, credential account.Credential, parsed *parsedChat, archivedImages map[string]struct{}, rawURL string) (string, error) {
	item, err := a.imageDataItem(ctx, credential, imagineImageValue{URL: rawURL}, "url")
	if err != nil {
		return "", err
	}
	delta := liteImageMarkdown(item)
	if parsed.Text.Len() > 0 {
		delta = "\n\n" + delta
	}
	parsed.appendText(delta)
	archivedImages[rawURL] = struct{}{}
	return delta, nil
}

// applyToolStreamSieve 消费一个文本分片，命中工具调用时改写 parsed.ToolCalls。
func applyToolStreamSieve(sieve *toolStreamSieve, delta string, clientText *strings.Builder, parsed *parsedChat, writeDelta func(kind, delta string) error, writeToolCalls func([]parsedToolCall) error, flushSideChannel func() error) error {
	result := sieve.Feed(delta)
	if result.SafeText != "" {
		clientText.WriteString(result.SafeText)
		if err := writeDelta("text", result.SafeText); err != nil {
			return err
		}
	}
	if result.Complete {
		if len(result.Calls) == 0 {
			clientText.WriteString(result.Raw)
			if err := writeDelta("text", result.Raw); err != nil {
				return err
			}
			return flushSideChannel()
		}
		parsed.ToolCalls = result.Calls
		return writeToolCalls(result.Calls)
	}
	return flushSideChannel()
}

// writeStreamDeltaDirect 处理未启用工具筛子时的直通分片写出。
func writeStreamDeltaDirect(kind, delta string, clientText *strings.Builder, writeDelta func(kind, delta string) error, flushSideChannel func() error) error {
	if kind == "text" && delta != "" {
		clientText.WriteString(delta)
	}
	if delta != "" {
		if err := writeDelta(kind, delta); err != nil {
			return err
		}
	}
	return flushSideChannel()
}

// finishToolStreamSieve 在流结束时冲刷筛子中残留的安全文本与工具调用。
func finishToolStreamSieve(sieve *toolStreamSieve, parsed *parsedChat, clientText *strings.Builder, writeDelta func(kind, delta string) error, writeToolCalls func([]parsedToolCall) error) error {
	result := sieve.Flush()
	if result.SafeText != "" {
		clientText.WriteString(result.SafeText)
		if err := writeDelta("text", result.SafeText); err != nil {
			return err
		}
	}
	if len(result.Calls) > 0 {
		parsed.ToolCalls = result.Calls
		return writeToolCalls(result.Calls)
	}
	return nil
}

// streamRemainingArchivedImages 归档此前未随分片写出的图片（仅在无工具调用时执行）。
func (a *Adapter) streamRemainingArchivedImages(ctx context.Context, credential account.Credential, parsed *parsedChat, archivedImages map[string]struct{}, clientText *strings.Builder, writeDelta func(kind, delta string) error) error {
	for _, rawURL := range parsed.Images {
		if _, exists := archivedImages[rawURL]; exists {
			continue
		}
		item, imageErr := a.imageDataItem(ctx, credential, imagineImageValue{URL: rawURL}, "url")
		if imageErr != nil {
			return imageErr
		}
		delta := liteImageMarkdown(item)
		if clientText.Len() > 0 {
			delta = "\n\n" + delta
		}
		clientText.WriteString(delta)
		if err := writeDelta("text", delta); err != nil {
			return err
		}
	}
	return nil
}

// finalizeOpenAIStream 按协议收尾：回写反馈、保存响应状态并写出终止事件。
func (a *Adapter) finalizeOpenAIStream(ctx context.Context, writer io.Writer, lease *infraegress.Lease, credential account.Credential, sink *openAIStreamSink, clientText *strings.Builder, options conversation.ResponseOptions) error {
	parsed := sink.parsed
	parsed.resetText(clientText.String())
	if sink.operation == conversation.OperationResponses {
		finalizeXAIAnnotations(parsed)
		if finishErr := sink.responsesStream.Finish(parsed); finishErr != nil {
			return finishErr
		}
	}
	a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, http.StatusOK, nil)
	payload := buildOpenAIResult(sink.operation, sink.responseID, sink.model, *parsed, false, options)
	data, _ := json.Marshal(payload)
	if sink.operation == conversation.OperationResponses {
		a.saveResponseState(context.WithoutCancel(ctx), credential.ID, sink.responseID, *parsed, data)
	}
	if sink.operation == conversation.OperationMessages {
		if finishErr := sink.messagesStream.Finish(*parsed, payload); finishErr != nil {
			return finishErr
		}
		return nil
	}
	writeStreamDone(writer, sink.operation, sink.responseID, sink.model, *parsed, payload)
	return nil
}
