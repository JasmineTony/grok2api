package web

import (
	"encoding/json"
	"sort"
)

type imagineModelConfig struct {
	Pro            bool
	ExpectedCount  int
	MaxReturnCount int
}

type imagineImageValue struct {
	ID       string
	URL      string
	Blob     string
	Position int
	Width    int
	Height   int
	position bool
}

type imagineSlot struct {
	image          imagineImageValue
	preview        imagineImageValue
	final          bool
	previewReady   bool
	previewEmitted bool
	completed      bool
	moderated      bool
	emitted        bool
}

type imagineCollector struct {
	slots         map[string]*imagineSlot
	terminalCount int
}

func resolveImagineModel(model string, pro bool, count int) (imagineModelConfig, bool) {
	if model != "imagine" {
		return imagineModelConfig{}, false
	}
	return imagineModelConfig{Pro: pro, ExpectedCount: count, MaxReturnCount: 10}, true
}

func newImagineCollector() *imagineCollector {
	return &imagineCollector{slots: make(map[string]*imagineSlot)}
}

func (c *imagineCollector) Accept(message map[string]any) {
	typeName, _ := message["type"].(string)
	if typeName != "image" && typeName != "json" {
		return
	}
	rawURL, _ := message["url"].(string)
	imageID := firstString(message, "image_id", "job_id", "id")
	if imageID == "" && rawURL != "" {
		imageID = imageIDFromURL(rawURL)
	}
	if imageID == "" {
		return
	}
	slot := c.slotFor(imageID)
	if typeName == "image" {
		acceptImagineImageEvent(slot, message, imageID, rawURL)
		return
	}
	c.acceptImagineJSONEvent(slot, message, rawURL)
}

// slotFor 返回 imageID 对应的槽位，不存在时创建。
func (c *imagineCollector) slotFor(imageID string) *imagineSlot {
	slot := c.slots[imageID]
	if slot == nil {
		slot = &imagineSlot{image: imagineImageValue{ID: imageID}}
		c.slots[imageID] = slot
	}
	return slot
}

// acceptImagineImageEvent 处理 type=image 事件：进度未满 100 时只登记预览图，否则标记为终稿。
func acceptImagineImageEvent(slot *imagineSlot, message map[string]any, imageID, rawURL string) {
	if position, ok := firstInt(message, "side_by_side_index", "order", "grid_index"); ok {
		slot.image.Position = position
		slot.image.position = true
	}
	width, _ := numberAsInt(message["width"])
	height, _ := numberAsInt(message["height"])
	progress, hasProgress := numberAsInt(message["percentage_complete"])
	if hasProgress && progress < 100 {
		slot.preview = imagineImageValue{
			ID: imageID, URL: absoluteAssetURL(rawURL), Position: slot.image.Position,
			Width: width, Height: height, position: slot.image.position,
		}
		slot.preview.Blob, _ = message["blob"].(string)
		slot.previewReady = true
		return
	}
	slot.image.URL = absoluteAssetURL(rawURL)
	slot.image.Blob, _ = message["blob"].(string)
	slot.image.Width = width
	slot.image.Height = height
	slot.final = true
}

// acceptImagineJSONEvent 处理 type=json 事件：登记顺序与尺寸，completed 时推进终态计数。
func (c *imagineCollector) acceptImagineJSONEvent(slot *imagineSlot, message map[string]any, rawURL string) {
	status, _ := message["current_status"].(string)
	if position, ok := numberAsInt(message["order"]); ok && !slot.image.position {
		slot.image.Position = position
		slot.image.position = true
	}
	if width, ok := numberAsInt(message["width"]); ok && slot.image.Width == 0 {
		slot.image.Width = width
	}
	if height, ok := numberAsInt(message["height"]); ok && slot.image.Height == 0 {
		slot.image.Height = height
	}
	if status != "completed" {
		return
	}
	if rawURL != "" && !slot.final {
		slot.image.URL = absoluteAssetURL(rawURL)
		slot.image.Blob, _ = message["blob"].(string)
		slot.final = true
	}
	if !slot.completed {
		slot.completed = true
		c.terminalCount++
	}
	slot.moderated, _ = message["moderated"].(bool)
}

func (c *imagineCollector) Done(expected int) bool {
	if expected <= 0 || c.terminalCount < expected {
		return false
	}
	for _, slot := range c.slots {
		if slot.completed && !slot.moderated && (!slot.final || (slot.image.URL == "" && slot.image.Blob == "")) {
			return false
		}
	}
	return true
}

func (c *imagineCollector) Images() []imagineImageValue {
	values := make([]imagineImageValue, 0, len(c.slots))
	for _, slot := range c.slots {
		if slot.completed && !slot.moderated && slot.final && (slot.image.URL != "" || slot.image.Blob != "") {
			values = append(values, slot.image)
		}
	}
	sortImagineImages(values)
	return values
}

func (c *imagineCollector) ReadyImages() []imagineImageValue {
	values := make([]imagineImageValue, 0, len(c.slots))
	for _, slot := range c.slots {
		if slot.completed && !slot.moderated && slot.final && !slot.emitted && (slot.image.URL != "" || slot.image.Blob != "") {
			slot.emitted = true
			values = append(values, slot.image)
		}
	}
	sortImagineImages(values)
	return values
}

func (c *imagineCollector) ReadyPreviews() []imagineImageValue {
	values := make([]imagineImageValue, 0)
	for _, slot := range c.slots {
		if slot.previewReady && !slot.previewEmitted {
			slot.previewEmitted = true
			values = append(values, slot.preview)
		}
	}
	sortImagineImages(values)
	return values
}

func sortImagineImages(values []imagineImageValue) {
	sort.SliceStable(values, func(i, j int) bool {
		if values[i].position != values[j].position {
			return values[i].position
		}
		if values[i].Position != values[j].Position {
			return values[i].Position < values[j].Position
		}
		return values[i].ID < values[j].ID
	})
}

func (c *imagineCollector) UsableCount() int {
	count := 0
	for _, slot := range c.slots {
		if slot.completed && !slot.moderated && slot.final && (slot.image.URL != "" || slot.image.Blob != "") {
			count++
		}
	}
	return count
}

func firstString(value map[string]any, keys ...string) string {
	for _, key := range keys {
		if result, _ := value[key].(string); result != "" {
			return result
		}
	}
	return ""
}

func firstInt(value map[string]any, keys ...string) (int, bool) {
	for _, key := range keys {
		if result, ok := numberAsInt(value[key]); ok {
			return result, true
		}
	}
	return 0, false
}

func numberAsInt(value any) (int, bool) {
	switch number := value.(type) {
	case float64:
		return int(number), true
	case int:
		return number, true
	case json.Number:
		parsed, err := number.Int64()
		return int(parsed), err == nil
	default:
		return 0, false
	}
}
