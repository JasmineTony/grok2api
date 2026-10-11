package conversation

func (c *streamConverter) setResponse(value responseEnvelope) {
	if value.ID != "" {
		c.id = value.ID
	}
	if value.Model != "" {
		c.model = value.Model
	}
	if value.CreatedAt != 0 {
		c.created = value.CreatedAt
	}
	c.usage = mergeResponseUsage(c.usage, value.Usage)
}

func mergeResponseUsage(current, update responseUsage) responseUsage {
	if update.InputTokens != 0 {
		current.InputTokens = update.InputTokens
	}
	if update.OutputTokens != 0 {
		current.OutputTokens = update.OutputTokens
	}
	if update.TotalTokens != 0 {
		current.TotalTokens = update.TotalTokens
	}
	if update.CostInUSDTicks != 0 {
		current.CostInUSDTicks = update.CostInUSDTicks
	}
	if update.NumSourcesUsed != 0 {
		current.NumSourcesUsed = update.NumSourcesUsed
	}
	if update.NumServerSideToolsUsed != 0 {
		current.NumServerSideToolsUsed = update.NumServerSideToolsUsed
	}
	if update.InputTokensDetails.CachedTokens != 0 {
		current.InputTokensDetails.CachedTokens = update.InputTokensDetails.CachedTokens
	}
	if update.OutputTokensDetails.ReasoningTokens != 0 {
		current.OutputTokensDetails.ReasoningTokens = update.OutputTokensDetails.ReasoningTokens
	}
	if update.ContextDetails.InputTokens != 0 {
		current.ContextDetails.InputTokens = update.ContextDetails.InputTokens
	}
	if update.ContextDetails.OutputTokens != 0 {
		current.ContextDetails.OutputTokens = update.ContextDetails.OutputTokens
	}
	return current
}
