/**
 * en 文案 · 文档。
 * 命名空间：docs。
 */
export default {
  docs: {
    title: "API documentation",
    description: "OpenAI Responses compatibility, account routing, and conversation-state behavior for this gateway.",
    quickstart: "Connection",
    baseUrl: "Base URL",
    authentication: "Authentication header",
    alternateAuthentication: "Alternative authentication header",
    defaultMode: "Default response mode",
    defaultModeValue: "Non-streaming (stream defaults to false)",
    authDescription:
      "Use a client API key created on the Client keys page. Authorization Bearer is recommended. Admin session tokens cannot call the /v1 inference API.",
    availableModels: "Available models",
    availableModelsDescription:
      "Examples use a public model that is enabled and currently serviceable by the account pool.",
    exampleModel: "Example model",
    modelLoadFailed: "Unable to load available models",
    noAvailableModels:
      "No model is currently available. Confirm that an account is enabled and wait for automatic model synchronization to complete.",
    modelDiscovery: "Model discovery",
    modelDiscoveryDescription:
      "Call the model list with a client API key to receive public models that are enabled and currently serviceable by the account pool.",
    firstRequest: "First request",
    exampleLanguage: "Example language",
    endpoints: "Endpoints",
    method: "Method",
    path: "Path",
    purpose: "Purpose",
    endpointModels: "List public models currently serviceable by the account pool.",
    endpointResponses: "Create text, tool-calling, structured-output, or streaming Responses requests.",
    endpointCompact: "Compact context and return a non-streaming result.",
    endpointRetrieve: "Retrieve a stored Response from its original upstream account.",
    endpointDelete: "Delete a stored Response and its local account ownership.",
    endpointChat: "Build / Web Chat Completions with streaming, image inputs, and function tools.",
    endpointMessages: "Build / Web Anthropic Messages with streaming, images, and tool use.",
    endpointImageGeneration:
      "Generate Grok Web images with n, aspect ratio, 1k/2k, URL, Base64, or extension streaming.",
    endpointImageEdit: "Edit Grok Web images with the official JSON image URL protocol.",
    endpointMediaImage: "Read an immutable generated image archived in local media storage.",
    endpointVideoCreate: "Create an asynchronous video generation request using the official xAI protocol.",
    endpointVideoEdit: "Edit an existing video using the official xAI protocol and return a request_id.",
    endpointVideoExtend: "Extend an existing video using the official xAI protocol and return a request_id.",
    endpointVideoGet: "Poll pending, done, or failed status and the generated video by request_id.",
    endpointTTS: "Console text-to-speech that returns raw audio bytes or a timestamped JSON envelope.",
    endpointAudioSpeech:
      "OpenAI-compatible text-to-speech endpoint that accepts input/voice/response_format and returns audio bytes.",
    endpointAudioTasks: "OpenAI-style audio task compatibility path that returns audio bytes by default.",
    endpointAudioTranscriptions: "OpenAI-compatible speech-to-text endpoint backed by the existing STT pipeline.",
    endpointTTSVoices: "List the built-in voices currently available from Console.",
    endpointSTT: "Console speech-to-text for uploaded files or audio URLs, with optional word timestamps.",
    endpointRealtime: "Realtime voice WebSocket proxied by the gateway with Console account authentication.",
    streaming: "Streaming",
    streamingDescription:
      "With stream: true, upstream SSE chunks are written and flushed immediately instead of buffering a complete response and simulating output. Account failover occurs only before streaming begins.",
    streamingProxyNote:
      "Disable response buffering in Nginx or your CDN; otherwise a genuinely streaming application may still deliver events in batches. Client disconnects cancel the upstream request and release concurrency leases.",
    conversation: "Conversation state",
    conversationDescription:
      "Use store: true and previous_response_id for native stateful continuation. The response chain remains pinned to its original account.",
    conversationPinning:
      "If the owning account is unavailable, the gateway returns upstream_pinned_account_unavailable instead of switching accounts and corrupting the state chain. Stateless replay can request reasoning.encrypted_content and pass it back in later input.",
    gatewayBehavior: "Gateway behavior",
    routingBehavior: "Model-aware routing",
    routingBehaviorDescription:
      "Public model IDs map to upstream models, and requests use only available accounts confirmed to support that model. Priority, concurrency, quota, and cooldown state all participate in scheduling.",
    failoverBehavior: "Pre-response failover",
    failoverBehaviorDescription:
      "Before a usable response is returned, credential expiry, rate limits, and retryable upstream errors can trigger credential refresh or account failover. SSE streams are never spliced across accounts.",
    privacyBehavior: "Minimal auditing",
    privacyBehaviorDescription:
      "Successful requests normally store routing, status, latency, and usage metadata only. When an adapter internally recovers an upstream failure, the audit also retains a redacted, size-limited failure diagnostic. Request bodies are not written directly, and encrypted reasoning or opaque compaction state is removed.",
    requestFields: "Common fields",
    fieldModel: "A public model ID that is enabled and currently available on the Models page.",
    fieldInstructions: "Optional system-level instructions forwarded as a standard Responses field.",
    fieldInput: "A string or standard Responses input item array.",
    fieldStream: "Defaults to false. Set to true for genuine incremental SSE output.",
    fieldStore: "Build and Web can store a Response for retrieval or continuation; Console is stateless.",
    fieldPreviousResponse:
      "The previous Response ID used by Build or Web for stateful continuation; Console does not support it.",
    fieldPromptCache:
      "Official cache and account-stickiness key. Reusing it prefers the original account, but it does not replace previous_response_id.",
    fieldInclude: 'Use include: ["reasoning.encrypted_content"] when encrypted reasoning must be replayed statelessly.',
    fieldTools:
      "Standard Responses tool definitions forwarded or converted according to the selected Provider's capabilities.",
    fieldToolChoice: "Controls tool selection; available modes depend on the selected Provider's tool capabilities.",
    fieldReasoning:
      "Reasoning configuration, including standard fields such as effort when accepted by the upstream model.",
    fieldMaxOutputTokens: "Limits generated output tokens according to upstream model capabilities.",
    fieldTextFormat: "Structured output configuration supporting json_object and json_schema.",
    usageAndErrors: "Usage and errors",
    usage: "Usage metadata",
    usageDescription:
      "Responses preserve standard token counts plus cost, source, server-tool, and context details returned by Grok Build. Request audits use the same upstream data.",
    errorsTitle: "Error format",
    errorsDescription:
      "Authentication, rate-limit, model, account-pool, and upstream failures use an OpenAI-style error object and can be handled by stable HTTP status and code values.",
    openAIReference: "OpenAI Responses API parameter reference",
    reference: {
      providerBoth: "Grok Build / Grok Web / Grok Console",
      providerWeb: "Grok Web",
      provider: "Provider",
      supported: "Supported",
      unsupported: "Unsupported",
      connection: "Connection",
      contentType: "Content-Type",
      exampleModel: "Example model",
      requestExample: "Request example",
      request: "Request",
      response: "Response",
      example: "Example",
      parameter: "Parameter",
      description: "Description",
      pathParameters: "Path parameters",
      requestBody: "Request body",
      responseExample: "Response example",
      notes: "Implementation notes",
      required: "Required",
      optional: "Optional",
      fieldModel: "A public model name that is enabled and currently supported by an available account.",
      fieldChatMessages: "OpenAI Chat Completions messages with text, image inputs, and tool results.",
      fieldStream: "Return incremental SSE events when true. Defaults to false.",
      fieldMaxCompletionTokens: "Maximum number of completion tokens the request may generate.",
      fieldTools: "Standard function tool definitions forwarded or converted for the selected provider.",
      fieldToolChoice: "Controls tool selection with auto, none, required, or a specific function.",
      fieldInput: "A string or standard Responses input item array.",
      fieldInstructions: "System-level instructions separate from input.",
      fieldStore: "Build and Web can store Response state for retrieval or continuation; Console is stateless.",
      fieldPreviousResponse:
        "The previous Response ID used by Build or Web to continue a stateful chain; Console does not support it.",
      fieldMaxTokens: "Maximum output token count required by Anthropic Messages.",
      fieldMessages: "Anthropic Messages input supporting text, images, and tool_result blocks.",
      fieldSystem: "System prompt as a string or standard text content block array.",
      fieldAnthropicTools: "Anthropic-format tools converted to the selected provider's function-calling capability.",
      fieldPrompt: "Natural-language instructions for image generation or editing.",
      fieldImageCount: "Number of images to return. Web forwards it directly as upstream num_generations.",
      fieldAspectRatio: "Output aspect ratio such as 1:1, 2:3, or 16:9.",
      fieldImageResolution:
        "Console images support 1k and 2k. Web image-generation routes ignore resolution/quality and select the upstream product by model name.",
      fieldVideoResolution:
        "Video output resolution. Supported values are 480p and 720p; only the upstream grok-imagine-video-1.5 model supports 1080p, and only without reference images.",
      fieldQuality:
        "Generation quality for Console Image 2.0: low or medium, defaulting to medium. Web image-generation routes ignore this field.",
      fieldResponseFormat: "Image response format: url or b64_json.",
      fieldImageStream: "Enable the image-generation SSE extension. Defaults to false.",
      fieldEditImages: "Source image or images supplied as URLs, data URLs, or another supported image reference.",
      fieldVideoPrompt: "Video description, or motion and camera instructions when an image is supplied.",
      fieldDuration:
        "Video duration in seconds, from 1 to 15. On Console routes, reference-to-video is limited to 10s with grok-imagine-video and 15s with grok-imagine-video-1.5.",
      fieldVideoImage:
        "Optional first-frame image reference for image-to-video generation. At most one image, and it cannot be combined with reference_images.",
      fieldVideoEditPrompt: "Describe how the source video should change.",
      fieldVideoExtendPrompt: "Describe what should happen next in the video.",
      fieldVideoInput: "Source video input. Provide either url or an uploaded file_id.",
      fieldVideoExtendDuration: "Extension length in seconds. Allowed range is 2 to 10; defaults to 6.",
      fieldReferenceImages:
        "Optional reference image array for reference-to-video. The gateway accepts up to 8 items, while Console routes accept up to 7. Each item uses url or file_id and cannot be combined with image.",
      fieldReferenceAudios:
        "Optional reference audio array of up to 3 built-in voice_id values. It can be used alone or with reference_images and may require upstream team entitlement; Console returns an upstream 403 when the capability is not enabled.",
      fieldRequestId: "The request_id returned when the video job is created.",
      noteChatProviders:
        "Build, Web, and Console use separate account pools and upstream protocols while returning the same Chat Completions shape.",
      noteChatImages:
        "Conversation images are validated and uploaded before being bound to the selected account. Accounts never switch after streaming begins.",
      noteChatTools:
        "Tool calls are normalized as OpenAI tool_calls. Unsupported combinations return an explicit parameter error.",
      noteResponsesNative:
        "Grok Build and Grok Console forward Responses natively; Grok Web uses a local converter for standard Response objects and events.",
      noteResponsesState:
        "store and previous_response_id pin a state chain to its original account so upstream state is not corrupted by failover.",
      noteResponsesCompact:
        "Only Grok Build supports /responses/compact; Grok Web and Grok Console return an explicit unsupported error.",
      noteMessagesAuth: "Messages uses x-api-key with anthropic-version: 2023-06-01.",
      noteMessagesEvents: "Streaming emits Anthropic Messages events rather than OpenAI SSE event names.",
      noteMessagesLimits:
        "Only the common Messages capabilities of the current chat models are adapted; unsupported provider extensions are rejected.",
      noteImageModels:
        "Web generates images with grok-imagine-image-lite, grok-imagine-image, and grok-imagine-image-2.0. The latter two map to enable_pro=false/true and use the separate grok-imagine-image-edit model for edits. Each of the three Console image models groups generation and edit capabilities.",
      noteImageCount: "Clients select the image count with n; Web forwards it directly as upstream num_generations.",
      noteImageStorage:
        "Generated images are archived in media storage. url returns a gateway asset URL; b64_json returns encoded image data.",
      noteEditJSON: "Image edits use a JSON request body and do not provide a multipart compatibility layer.",
      noteEditSources: "Remote images pass SSRF, size, and content-type checks before upload to the upstream service.",
      noteVideoAsync: "Creation returns only request_id. Generation runs asynchronously with persistent job state.",
      noteVideoDuration:
        "Duration, aspect ratio, resolution, and image inputs are validated against the selected video model.",
      noteVideoReference:
        "Reference-to-video uses /videos/generations with reference_images. A single item keeps reference semantics and is not promoted to a first frame. The gateway accepts up to 8 items and Console routes up to 7; do not combine them with image. Reference mode tops out at 720p. On Console, grok-imagine-video reference mode is limited to 10s and reference_audios also requires the corresponding team entitlement.",
      noteVideoStrict: "Video endpoints use the current official fields without non-standard aliases.",
      noteVideoEditModel:
        "The resolved route for video edits and extensions must target Console/grok-imagine-video; the public model name may be customized.",
      noteVideoBilling:
        "Video edits and extensions do not yet expose a reliably billable input-video duration. They remain callable, are audited as unpriced, and do not consume the API key spend limit.",
      noteVideoPolling: "Poll the job with the request_id returned by the creation endpoint.",
      noteVideoStatus: "Status is pending, done, or failed. Completed responses include result details in video.",
      noteVideoBoundAccount:
        "Media jobs remain bound to their creating account; status and asset reads never splice across accounts.",
      fieldVoiceModel: "Public voice model ID such as grok-voice-latest or grok-voice-think-fast-2.0.",
      fieldVoiceModelQuery: "Optional model query parameter used when listing voices for a voice model.",
      fieldSTTModel: "Public transcription model ID, usually grok-stt.",
      fieldRealtimeModel: "Realtime session model such as grok-voice-latest.",
      fieldRealtimeModelQuery: "model query parameter for the WebSocket connection.",
      fieldTTSText: "Text content to synthesize.",
      fieldAudioInput: "OpenAI-style text to synthesize. Maps to the native text field.",
      fieldAudioVoice: "OpenAI voice name or a Console voice_id. Common OpenAI voices are mapped automatically.",
      fieldAudioResponseFormat: "Output format such as mp3, opus, aac, flac, wav, or pcm.",
      fieldVoiceId: "Voice ID from built-in voices or a custom voice_id.",
      fieldVoiceLanguage: "Language code such as en or zh. Required for TTS.",
      fieldVoiceLanguageOptional:
        "Language code such as en or zh. OpenAI-compatible endpoints default to en when omitted.",
      fieldTTSOutputFormat: "Output format object with optional codec, sample_rate, and bit_rate.",
      fieldTTSSpeed: "Speech rate multiplier validated against upstream limits.",
      fieldTTSTimestamps: "When true, return a JSON envelope with base64 audio and timestamps instead of raw audio.",
      fieldSTTFile: "Multipart audio upload field named file.",
      fieldSTTUrl: "Publicly reachable audio URL. Provide either file or url.",
      fieldSTTResponseFormat:
        "Response format: json (default), verbose_json, or text. Unsupported srt/vtt formats are rejected explicitly.",
      fieldSTTFormat: "Whether to return formatted text and word-level timestamps.",
      fieldSTTDiarize: "Enable speaker diarization.",
      fieldSTTKeyterm: "Priority keywords; the field may be repeated.",
      fieldWSUpgrade: "Requires a standard WebSocket Upgrade header. Plain HTTP GET is rejected.",
      noteTTSModels:
        "Console voice models include grok-voice-latest, grok-voice-think-fast-2.0, and grok-voice-think-fast-1.0.",
      noteAudioSpeechCompat:
        "Compatible with OpenAI /v1/audio/speech: input→text, voice→voice_id, response_format→codec. Extra fields such as language remain accepted.",
      noteAudioTasksCompat:
        "Some clients call /v1/audio/tasks. This gateway handles it synchronously like speech and returns audio bytes by default.",
      noteAudioTranscriptionsCompat:
        "Compatible with OpenAI /v1/audio/transcriptions with json, verbose_json, and text responses, backed by /v1/stt. prompt, non-zero temperature, and timestamp_granularities are rejected because Console STT cannot preserve their semantics.",
      noteTTSBinary: "Default responses are raw audio bytes such as audio/mpeg. with_timestamps=true switches to JSON.",
      noteTTSVoices: "GET /v1/tts/voices lists built-in voices; GET /v1/tts/voices/{voice_id} returns one voice.",
      noteVoiceBilling:
        "TTS is reserved and settled by input characters. REST and streaming STT are settled from the actual duration returned on success. Realtime is currently unbilled and does not consume the API key spend limit.",
      noteSTTInput: "Accepts multipart file uploads or a JSON url reference; at least one audio input is required.",
      noteSTTStream:
        "Upgrade /v1/stt to a WebSocket for realtime transcription; clients stream audio frames and receive JSON events.",
      noteSTTModels: "Transcription uses grok-stt. Word timestamps and diarization follow the request parameters.",
      noteRealtimeProxy:
        "Prefer the gateway /v1/realtime WebSocket proxy so Console DPoP authentication stays server-side.",
      noteRealtimeEvents:
        "After connect, exchange official Realtime events for session setup, audio buffers, and responses.",
      noteRealtimeAuth:
        "Server-side WebSocket clients must send Authorization Bearer or X-API-Key with the Upgrade request; the gateway never exposes upstream Console credentials.",
    },
  },
} as const;
