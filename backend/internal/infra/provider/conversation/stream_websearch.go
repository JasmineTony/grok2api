package conversation

import "fmt"

// noteWebSearch records a Build web_search_call. Emission is deferred to doneMessages
// so we always use the completed action.sources payload from the final envelope when available.
// For progressive UI we still emit server_tool_use as soon as we see the call.
func (c *streamConverter) noteWebSearch(call webSearchCall, final bool) error {
	filtered := dedupeWebSearchCalls([]webSearchCall{call})
	if len(filtered) == 0 {
		return nil
	}
	call = filtered[0]
	replaced := false
	for i, existing := range c.webSearch {
		if existing.ID == call.ID {
			// Prefer richer final payload.
			if final || len(call.Hits) >= len(existing.Hits) {
				c.webSearch[i] = call
			}
			replaced = true
			break
		}
	}
	if !replaced {
		if len(c.webSearch) >= maxWebSearchCalls {
			return nil
		}
		c.webSearch = append(c.webSearch, call)
	}
	if !c.textStarted {
		c.deferSearchText = true
	}
	if c.textStarted || (c.thinkingStarted && !c.thinkingClosed) {
		return nil
	}
	// Emit server_tool_use promptly so Claude Code can show "Searching: …".
	return c.emitWebSearchUse(call)
}

func (c *streamConverter) emitWebSearchUse(call webSearchCall) error {
	if err := c.start(); err != nil {
		return err
	}
	if c.webSearchEmitted[call.ID+"#use"] {
		return nil
	}
	index := c.nextIndex
	c.nextIndex++
	c.webSearchEmitted[call.ID+"#use"] = true
	if err := c.writeEvent("content_block_start", map[string]any{
		"type": "content_block_start", "index": index,
		"content_block": map[string]any{"type": "server_tool_use", "id": call.ID, "name": "web_search", "input": map[string]any{}},
	}); err != nil {
		return err
	}
	if call.Query != "" {
		if err := c.writeEvent("content_block_delta", map[string]any{
			"type": "content_block_delta", "index": index,
			"delta": map[string]any{"type": "input_json_delta", "partial_json": queryJSONPartial(call.Query)},
		}); err != nil {
			return err
		}
	}
	if err := c.writeEvent("content_block_stop", map[string]any{"type": "content_block_stop", "index": index}); err != nil {
		return err
	}
	return nil
}

func (c *streamConverter) emitPendingWebSearchResults() error {
	c.webSearch = dedupeWebSearchCalls(c.webSearch)
	for _, call := range c.webSearch {
		if c.webSearchEmitted[call.ID+"#result"] {
			continue
		}
		if !c.webSearchEmitted[call.ID+"#use"] {
			if err := c.emitWebSearchUse(call); err != nil {
				return err
			}
		}
		if err := c.start(); err != nil {
			return err
		}
		index := c.nextIndex
		c.nextIndex++
		c.webSearchEmitted[call.ID+"#result"] = true
		var content any
		if call.Failed {
			code := call.Code
			if code == "" {
				code = "unavailable"
			}
			content = map[string]any{"type": "web_search_tool_result_error", "error_code": code}
		} else {
			hits := make([]any, 0, len(call.Hits))
			for _, hit := range call.Hits {
				hits = append(hits, map[string]any{"type": "web_search_result", "title": hit.Title, "url": hit.URL})
			}
			content = hits
		}
		if err := c.writeEvent("content_block_start", map[string]any{
			"type": "content_block_start", "index": index,
			"content_block": map[string]any{
				"type": "web_search_tool_result", "tool_use_id": call.ID, "content": content,
			},
		}); err != nil {
			return err
		}
		if err := c.writeEvent("content_block_stop", map[string]any{"type": "content_block_stop", "index": index}); err != nil {
			return err
		}
	}
	return nil
}

func (c *streamConverter) bufferSearchText(delta string) error {
	pending := c.pendingSearchText.Len()
	if pending >= maxDeferredSearchTextBytes || len(delta) > maxDeferredSearchTextBytes-pending {
		return fmt.Errorf("WebSearch 延迟文本缓冲超过 %d MiB", maxDeferredSearchTextBytes>>20)
	}
	c.pendingSearchText.WriteString(delta)
	return nil
}
