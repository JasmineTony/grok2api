package provider

import (
	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/domain/media"
)

type ImageGenerationRequest struct {
	Credential     account.Credential
	Model          string
	Prompt         string
	Count          int
	Size           string
	AspectRatio    string
	Resolution     string
	Quality        string
	ResponseFormat string
	Streaming      bool
	PartialImages  int
}

type ImageInput struct {
	Filename string
	MIMEType string
	Data     []byte
}

type ImageEditRequest struct {
	Credential     account.Credential
	Model          string
	Prompt         string
	ImageURLs      []string
	Count          int
	Size           string
	AspectRatio    string
	Resolution     string
	Quality        string
	ResponseFormat string
	Streaming      bool
	PartialImages  int
}

// VideoOperation selects the official xAI video endpoint family.
type VideoOperation = media.VideoOperation

const (
	VideoOperationGenerate = media.VideoOperationGenerate
	VideoOperationEdit     = media.VideoOperationEdit
	VideoOperationExtend   = media.VideoOperationExtend
)

// ConsoleVideoMaxReferenceImages and ConsoleVideoMaxReferenceDurationSeconds
// describe the Console reference-to-video contract enforced by the upstream.
// They are shared by admission control and the Console adapter so invalid
// asynchronous jobs are rejected before enqueueing without weakening the
// adapter's final request-boundary validation.
const (
	ConsoleVideoMaxReferenceImages          = 7
	ConsoleVideoMaxReferenceDurationSeconds = 10
)

type VideoRequest struct {
	Credential account.Credential
	// Billing is used only to determine XAI eligibility in Build auto mode; nil means the account tier is unknown.
	Billing *account.Billing
	// JobID binds the local video job to XAI ZDR upload tickets and result assets.
	JobID string
	// Model is the selected upstream video model when the Provider supports more than one.
	Model string
	// Operation defaults to generate when empty.
	Operation   VideoOperation
	Prompt      string
	Duration    int
	AspectRatio string
	Resolution  string
	// ImageURL is the optional first-frame image (official "image" field).
	ImageURL string
	// ReferenceURLs are style/content references (official "reference_images").
	// A single reference must stay in reference_images and must not be coerced to image.
	// Official docs forbid combining image with reference_images.
	ReferenceURLs []string
	// ReferenceAudios are preset voice_ids for reference-to-video (official "reference_audios").
	// At most 3 entries; may be used alone or with reference_images.
	ReferenceAudios []string
	// VideoURL is required for edit/extend (official "video" field).
	VideoURL string
	Progress func(int)
}

type VideoResult struct {
	URL         string
	ContentType string
	// A non-empty AssetID means the result is stored as a local media asset; content reads must use MediaObjectStorage.
	AssetID string
}

type TTSOutputFormat struct {
	Codec      string
	SampleRate int
	BitRate    int
}

type TTSRequest struct {
	Credential               account.Credential
	Model                    string
	Text                     string
	VoiceID                  string
	Language                 string
	OutputFormat             TTSOutputFormat
	Speed                    float64
	OptimizeStreamingLatency int
	TextNormalization        bool
	WithTimestamps           bool
}

type TTSTimestampSpan struct {
	Start float64
	End   float64
}

type TTSTimestamps struct {
	GraphChars []string
	GraphTimes []TTSTimestampSpan
}

type TTSResult struct {
	Audio        []byte
	ContentType  string
	Duration     float64
	Base64Audio  string
	Timestamps   *TTSTimestamps
	JSONEnvelope bool
}

type STTRequest struct {
	Credential   account.Credential
	Model        string
	FileName     string
	FileMIME     string
	FileData     []byte
	URL          string
	AudioFormat  string
	SampleRate   string
	Language     string
	Format       bool
	Multichannel bool
	Channels     int
	Diarize      bool
	KeyTerms     []string
	FillerWords  bool
	VADThreshold *float64
}

type STTWord struct {
	Text    string
	Start   float64
	End     float64
	Speaker *int
}

type STTChannel struct {
	Index int
	Text  string
	Words []STTWord
}

type STTResult struct {
	Text     string
	Language string
	Duration float64
	Words    []STTWord
	Channels []STTChannel
	RawJSON  []byte
}

type VoiceInfo struct {
	VoiceID  string
	Name     string
	Language string
}
