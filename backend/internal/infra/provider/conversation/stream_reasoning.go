package conversation

import (
	"fmt"
	"strings"
)

// markReasoningEvidence preserves the upstream encrypted_content byte length
// for the request-path quality scanner after protocol conversion. SSE clients
// ignore comments, so Chat and Messages public event payloads remain unchanged.
func (c *streamConverter) markReasoningEvidence(encrypted string) error {
	byteCount := len(strings.TrimSpace(encrypted))
	if byteCount <= c.reasoningEvidenceBytes {
		return nil
	}
	if err := c.start(); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(c.writer, ": grok2api-reasoning-evidence %d\n\n", byteCount); err != nil {
		return err
	}
	c.reasoningEvidenceBytes = byteCount
	return nil
}

func (c *streamConverter) reasoningOutputEnabled() bool {
	return c.operation == OperationChat || (c.operation == OperationMessages && c.options.AnthropicThinking)
}

func (c *streamConverter) ensureReasoningState(itemID string) (string, *reasoningStreamState) {
	key := itemID
	if key != "" {
		if state, exists := c.reasoningItems[key]; exists {
			c.activeReasoningID = key
			return key, state
		}
		// Some compatible upstreams omit item_id on the first delta. Once the
		// real item arrives, attach that anonymous state instead of creating a
		// second source that could later replay the first-wins choice.
		if state, adopted := c.adoptAnonymousReasoningState(key); adopted {
			return key, state
		}
	}
	if key == "" {
		key = c.activeReasoningID
	}
	anonymous := false
	if key == "" {
		key = fmt.Sprintf("#reasoning-%d", len(c.reasoningOrder)+1)
		anonymous = true
	}
	state, exists := c.reasoningItems[key]
	if !exists {
		state = &reasoningStreamState{anonymous: anonymous}
		c.reasoningItems[key] = state
		c.reasoningOrder = append(c.reasoningOrder, key)
	}
	c.activeReasoningID = key
	return key, state
}

// adoptAnonymousReasoningState 把尚未完成的匿名 reasoning 状态迁移到真实 item id 上。
func (c *streamConverter) adoptAnonymousReasoningState(key string) (*reasoningStreamState, bool) {
	anonymous := c.activeReasoningID
	if anonymous == "" {
		return nil, false
	}
	state := c.reasoningItems[anonymous]
	if state == nil || !state.anonymous || state.done {
		return nil, false
	}
	delete(c.reasoningItems, anonymous)
	state.anonymous = false
	c.reasoningItems[key] = state
	c.renameReasoningOrder(anonymous, key)
	c.activeReasoningID = key
	return state, true
}

// renameReasoningOrder 把 reasoning 顺序表中的匿名 key 替换为真实 item id。
func (c *streamConverter) renameReasoningOrder(from, to string) {
	for index, existing := range c.reasoningOrder {
		if existing == from {
			c.reasoningOrder[index] = to
			return
		}
	}
}

func (c *streamConverter) reasoningSummaryDelta(itemID, delta string) error {
	return c.reasoningLiveDelta(itemID, delta, "summary")
}

func (c *streamConverter) reasoningTextDelta(itemID, delta string) error {
	return c.reasoningLiveDelta(itemID, delta, "raw")
}

// reasoningLiveDelta emits the first reasoning source in real time and drops
// the other. Build currently streams summary only; Console may also send raw.
func (c *streamConverter) reasoningLiveDelta(itemID, delta, source string) error {
	if delta == "" || !c.reasoningOutputEnabled() {
		return nil
	}
	_, state := c.ensureReasoningState(itemID)
	if state.done {
		return nil
	}
	if state.chosen == "" {
		state.chosen = source
	}
	if state.chosen != source {
		return nil
	}
	return c.emitReasoningDelta(delta)
}

func (c *streamConverter) emitReasoningDelta(delta string) error {
	if c.operation == OperationChat {
		return c.chatDelta(map[string]any{"reasoning_content": delta})
	}
	if c.operation == OperationMessages {
		return c.thinkingDelta(delta)
	}
	return nil
}

func (c *streamConverter) emitEncrypted(item responseItem) error {
	if strings.TrimSpace(item.Encrypted) == "" {
		return nil
	}
	// Record richer late payloads for the quality scanner even after the public
	// signature delta has already been emitted for this reasoning item.
	if err := c.markReasoningEvidence(item.Encrypted); err != nil {
		return err
	}
	if c.operation != OperationMessages || !c.options.AnthropicThinking {
		return nil
	}
	_, state := c.ensureReasoningState(item.ID)
	if state.signatureEmitted {
		return nil
	}
	if err := c.thinkingStart(item.ID); err != nil {
		return err
	}
	if c.thinkingClosed {
		return nil
	}
	if err := c.writeEvent("content_block_delta", map[string]any{
		"type": "content_block_delta", "index": c.thinkingIndex,
		"delta": map[string]any{"type": "signature_delta", "signature": item.Encrypted},
	}); err != nil {
		return err
	}
	state.signatureEmitted = true
	return nil
}

func (c *streamConverter) reasoningDone(item responseItem) error {
	key, state := c.ensureReasoningState(item.ID)
	if state.done {
		return nil
	}
	state.done = true
	if c.activeReasoningID == key {
		c.activeReasoningID = ""
	}
	return nil
}

func (c *streamConverter) flushPendingReasoning() error {
	for _, key := range c.reasoningOrder {
		state := c.reasoningItems[key]
		if state.done {
			continue
		}
		state.done = true
	}
	c.activeReasoningID = ""
	return nil
}
