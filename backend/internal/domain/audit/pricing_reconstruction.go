package audit

import "strings"

// PricingBreakdown describes the exact rate components used to reconstruct a stored estimate.
type PricingBreakdown struct {
	Model          string
	CostInUSDTicks int64
	Tier           PricingTier
	Components     []PricingComponent
}

type PricingTier string

const (
	PricingTierStandard    PricingTier = "standard"
	PricingTierLongContext PricingTier = "long_context"
	PricingTierMedia       PricingTier = "media"
)

type PricingComponentKind string

const (
	PricingComponentUncachedInput PricingComponentKind = "uncached_input"
	PricingComponentCachedInput   PricingComponentKind = "cached_input"
	PricingComponentOutput        PricingComponentKind = "output"
	PricingComponentInputImage    PricingComponentKind = "input_image"
	PricingComponentOutputImage   PricingComponentKind = "output_image"
	PricingComponentOutputSecond  PricingComponentKind = "output_second"
)

type PricingUnit string

const (
	PricingUnitToken  PricingUnit = "token"
	PricingUnitImage  PricingUnit = "image"
	PricingUnitSecond PricingUnit = "second"
)

type PricingComponent struct {
	Kind                PricingComponentKind
	Unit                PricingUnit
	Quantity            int64
	UnitPriceInUSDTicks int64
	CostInUSDTicks      int64
}

// ReconstructOfficialCost builds an admin-facing formula without adding work to the request settlement path.
// 图片与视频标识符由各自的重建函数处理，其余模型名按 Token 计价重建。
func ReconstructOfficialCost(model string, inputTokens, cachedInputTokens, outputTokens, contextInputTokens, inputImages, outputImages, outputSeconds int64) (PricingBreakdown, bool) {
	normalized := normalizePricingModel(model)
	switch {
	case strings.HasPrefix(normalized, "grok-imagine-image"):
		return reconstructOfficialImageCost(normalized, inputImages, outputImages)
	case strings.HasPrefix(normalized, "grok-imagine-video"):
		return reconstructOfficialVideoCost(normalized, inputImages, outputSeconds)
	default:
		return reconstructTextCost(normalized, inputTokens, cachedInputTokens, outputTokens, contextInputTokens)
	}
}

// reconstructOfficialImageCost 重建图片类计价明细；未识别的图片标识符返回 false。
func reconstructOfficialImageCost(normalized string, inputImages, outputImages int64) (PricingBreakdown, bool) {
	switch normalized {
	case "grok-imagine-image":
		return reconstructImageCost(normalized, "", "", outputImages)
	case "grok-imagine-image-2.0":
		// Records written before the quality-aware pricing revision stored the
		// former flat $0.04 estimate under this identifier. Preserve an exact
		// reconstruction for those immutable audit rows.
		return reconstructLegacyImage20Cost(normalized, outputImages, 400_000_000)
	case "grok-imagine-image-2.0-low-1k":
		return reconstructImageCost("grok-imagine-image-2.0", "1k", "low", outputImages)
	case "grok-imagine-image-2.0-low-2k":
		return reconstructImageCost("grok-imagine-image-2.0", "2k", "low", outputImages)
	case "grok-imagine-image-2.0-medium-1k":
		return reconstructImageCost("grok-imagine-image-2.0", "1k", "medium", outputImages)
	case "grok-imagine-image-2.0-medium-2k":
		return reconstructImageCost("grok-imagine-image-2.0", "2k", "medium", outputImages)
	case "grok-imagine-image-quality-1k":
		return reconstructImageCost("grok-imagine-image-quality", "1k", "", outputImages)
	case "grok-imagine-image-quality-2k":
		return reconstructImageCost("grok-imagine-image-quality", "2k", "", outputImages)
	case "grok-imagine-image-edit-1k":
		return reconstructImageEditCost("grok-imagine-image-edit", "1k", "", inputImages, outputImages)
	case "grok-imagine-image-edit-2k":
		return reconstructImageEditCost("grok-imagine-image-edit", "2k", "", inputImages, outputImages)
	case "grok-imagine-image-2.0-edit-low-1k":
		return reconstructImageEditCost("grok-imagine-image-2.0", "1k", "low", inputImages, outputImages)
	case "grok-imagine-image-2.0-edit-low-2k":
		return reconstructImageEditCost("grok-imagine-image-2.0", "2k", "low", inputImages, outputImages)
	case "grok-imagine-image-2.0-edit-medium-1k":
		return reconstructImageEditCost("grok-imagine-image-2.0", "1k", "medium", inputImages, outputImages)
	case "grok-imagine-image-2.0-edit-medium-2k":
		return reconstructImageEditCost("grok-imagine-image-2.0", "2k", "medium", inputImages, outputImages)
	case "grok-imagine-image-2.0-edit-1k", "grok-imagine-image-2.0-edit-2k":
		return reconstructLegacyImage20EditCost(normalized, inputImages, outputImages)
	case "grok-imagine-image-quality-edit-1k":
		return reconstructImageEditCost("grok-imagine-image-quality", "1k", "", inputImages, outputImages)
	case "grok-imagine-image-quality-edit-2k":
		return reconstructImageEditCost("grok-imagine-image-quality", "2k", "", inputImages, outputImages)
	case "grok-imagine-image-edit-lite-1k":
		return reconstructImageEditCost("grok-imagine-image", "1k", "", inputImages, outputImages)
	case "grok-imagine-image-edit-lite-2k":
		return reconstructImageEditCost("grok-imagine-image", "2k", "", inputImages, outputImages)
	default:
		return PricingBreakdown{}, false
	}
}

// reconstructOfficialVideoCost 重建视频类计价明细；未识别的视频标识符返回 false。
func reconstructOfficialVideoCost(normalized string, inputImages, outputSeconds int64) (PricingBreakdown, bool) {
	switch normalized {
	case "grok-imagine-video-480p":
		return reconstructVideoCost("grok-imagine-video", "480p", inputImages, outputSeconds)
	case "grok-imagine-video-720p":
		return reconstructVideoCost("grok-imagine-video", "720p", inputImages, outputSeconds)
	case "grok-imagine-video-1.5-480p":
		return reconstructVideoCost("grok-imagine-video-1.5", "480p", inputImages, outputSeconds)
	case "grok-imagine-video-1.5-720p":
		return reconstructVideoCost("grok-imagine-video-1.5", "720p", inputImages, outputSeconds)
	case "grok-imagine-video-1.5-1080p":
		return reconstructVideoCost("grok-imagine-video-1.5", "1080p", inputImages, outputSeconds)
	default:
		return PricingBreakdown{}, false
	}
}

func reconstructLegacyImage20Cost(model string, outputCount, outputTicks int64) (PricingBreakdown, bool) {
	if outputCount <= 0 {
		return PricingBreakdown{}, false
	}
	return newPricingBreakdown(model, PricingTierMedia,
		newPricingComponent(PricingComponentOutputImage, PricingUnitImage, outputCount, outputTicks),
	), true
}

func reconstructLegacyImage20EditCost(model string, inputCount, outputCount int64) (PricingBreakdown, bool) {
	if inputCount <= 0 || outputCount <= 0 {
		return PricingBreakdown{}, false
	}
	return newPricingBreakdown(model, PricingTierMedia,
		newPricingComponent(PricingComponentOutputImage, PricingUnitImage, outputCount, 400_000_000),
		newPricingComponent(PricingComponentInputImage, PricingUnitImage, inputCount, officialImageEditInputTicks),
	), true
}

func reconstructTextCost(model string, inputTokens, cachedInputTokens, outputTokens, contextInputTokens int64) (PricingBreakdown, bool) {
	price, ok := resolveOfficialTokenPrice(model)
	if !ok {
		return PricingBreakdown{}, false
	}
	inputPrice, cachedPrice, outputPrice := price.InputTicks, price.CachedInputTicks, price.OutputTicks
	tier := PricingTierStandard
	contextTokens := contextInputTokens
	if contextTokens <= 0 {
		contextTokens = inputTokens
	}
	if price.LongContextTokens > 0 && contextTokens > price.LongContextTokens {
		inputPrice, cachedPrice, outputPrice = price.LongInputTicks, price.LongCachedTicks, price.LongOutputTicks
		tier = PricingTierLongContext
	}
	cachedTokens := max(int64(0), min(cachedInputTokens, inputTokens))
	return newPricingBreakdown(price.CanonicalModel, tier,
		newPricingComponent(PricingComponentUncachedInput, PricingUnitToken, max(int64(0), inputTokens-cachedTokens), inputPrice),
		newPricingComponent(PricingComponentOutput, PricingUnitToken, outputTokens, outputPrice),
		newPricingComponent(PricingComponentCachedInput, PricingUnitToken, cachedTokens, cachedPrice),
	), true
}

func reconstructImageCost(model, resolution, quality string, count int64) (PricingBreakdown, bool) {
	if count <= 0 || int64(int(count)) != count {
		return PricingBreakdown{}, false
	}
	result, ok := EstimateOfficialImageCost(model, resolution, quality, int(count))
	if !ok {
		return PricingBreakdown{}, false
	}
	return newPricingBreakdown(result.Model, PricingTierMedia,
		newPricingComponent(PricingComponentOutputImage, PricingUnitImage, count, result.CostInUSDTicks/count),
	), true
}

func reconstructImageEditCost(model, resolution, quality string, inputCount, outputCount int64) (PricingBreakdown, bool) {
	if inputCount <= 0 || outputCount <= 0 || int64(int(inputCount)) != inputCount || int64(int(outputCount)) != outputCount {
		return PricingBreakdown{}, false
	}
	result, ok := EstimateOfficialImageEditCost(model, resolution, quality, int(outputCount), int(inputCount))
	if !ok {
		return PricingBreakdown{}, false
	}
	inputTicks := officialImageEditInputTicks
	if normalizePricingModel(model) == "grok-imagine-image" {
		inputTicks = officialLiteImageInputTicks
	}
	outputCost := result.CostInUSDTicks - inputCount*inputTicks
	if outputCost < 0 || outputCost%outputCount != 0 {
		return PricingBreakdown{}, false
	}
	return newPricingBreakdown(result.Model, PricingTierMedia,
		newPricingComponent(PricingComponentOutputImage, PricingUnitImage, outputCount, outputCost/outputCount),
		newPricingComponent(PricingComponentInputImage, PricingUnitImage, inputCount, inputTicks),
	), true
}

func reconstructVideoCost(model, resolution string, inputImages, seconds int64) (PricingBreakdown, bool) {
	if seconds <= 0 || inputImages < 0 || int64(int(seconds)) != seconds || int64(int(inputImages)) != inputImages {
		return PricingBreakdown{}, false
	}
	result, ok := EstimateOfficialVideoCost(model, resolution, int(seconds), int(inputImages))
	if !ok {
		return PricingBreakdown{}, false
	}
	inputTicks := officialLiteImageInputTicks
	if normalizePricingModel(model) == "grok-imagine-video-1.5" {
		inputTicks = officialImageEditInputTicks
	}
	outputCost := result.CostInUSDTicks - inputImages*inputTicks
	if outputCost < 0 || outputCost%seconds != 0 {
		return PricingBreakdown{}, false
	}
	return newPricingBreakdown(result.Model, PricingTierMedia,
		newPricingComponent(PricingComponentOutputSecond, PricingUnitSecond, seconds, outputCost/seconds),
		newPricingComponent(PricingComponentInputImage, PricingUnitImage, inputImages, inputTicks),
	), true
}

func newPricingComponent(kind PricingComponentKind, unit PricingUnit, quantity, unitPriceInUSDTicks int64) PricingComponent {
	quantity = max(int64(0), quantity)
	unitPriceInUSDTicks = max(int64(0), unitPriceInUSDTicks)
	return PricingComponent{
		Kind: kind, Unit: unit, Quantity: quantity, UnitPriceInUSDTicks: unitPriceInUSDTicks,
		CostInUSDTicks: quantity * unitPriceInUSDTicks,
	}
}

func newPricingBreakdown(model string, tier PricingTier, components ...PricingComponent) PricingBreakdown {
	result := PricingBreakdown{Model: model, Tier: tier, Components: components}
	for _, component := range components {
		result.CostInUSDTicks += component.CostInUSDTicks
	}
	return result
}
