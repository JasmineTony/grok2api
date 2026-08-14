import type { ModelRouteDTO } from "@/entities/model/types";

export type ExampleLanguage = "curl" | "python" | "javascript";
export type ExampleView = "request" | "response";
export type Method = "GET" | "POST";
export type Capability = ModelRouteDTO["capability"];

export type FieldDefinition = {
  name: string;
  required?: boolean;
  descriptionKey: string;
};

export type EndpointDefinition = {
  key: string;
  category: string;
  title: string;
  method: Method;
  path: string;
  descriptionKey: string;
  capabilities: Capability[];
  fields: FieldDefinition[];
  noteKeys: string[];
  request: (model: string) => Record<string, unknown> | undefined;
  response: Record<string, unknown>;
};

export const exampleLanguages: ExampleLanguage[] = ["curl", "python", "javascript"];

export const endpoints: Record<string, EndpointDefinition> = {
  "chat/completions": {
    key: "chat/completions",
    category: "Chat",
    title: "Chat completions",
    method: "POST",
    path: "/chat/completions",
    descriptionKey: "docs.endpointChat",
    capabilities: ["chat", "responses"],
    fields: [
      { name: "model", required: true, descriptionKey: "docs.reference.fieldModel" },
      { name: "messages", required: true, descriptionKey: "docs.reference.fieldChatMessages" },
      { name: "stream", descriptionKey: "docs.reference.fieldStream" },
      { name: "max_completion_tokens", descriptionKey: "docs.reference.fieldMaxCompletionTokens" },
      { name: "tools", descriptionKey: "docs.reference.fieldTools" },
      { name: "tool_choice", descriptionKey: "docs.reference.fieldToolChoice" },
    ],
    noteKeys: ["docs.reference.noteChatImages", "docs.reference.noteChatTools"],
    request: (model) => ({
      model,
      messages: [
        { role: "system", content: "You are a concise assistant." },
        { role: "user", content: "Explain HTTP streaming." },
      ],
      stream: false,
    }),
    response: {
      id: "chatcmpl_example",
      object: "chat.completion",
      model: "grok-chat-fast",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "HTTP streaming sends response data incrementally.",
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 24, completion_tokens: 12, total_tokens: 36 },
    },
  },
  "chat/responses": {
    key: "chat/responses",
    category: "Chat",
    title: "Responses",
    method: "POST",
    path: "/responses",
    descriptionKey: "docs.endpointResponses",
    capabilities: ["chat", "responses"],
    fields: [
      { name: "model", required: true, descriptionKey: "docs.reference.fieldModel" },
      { name: "input", required: true, descriptionKey: "docs.reference.fieldInput" },
      { name: "instructions", descriptionKey: "docs.reference.fieldInstructions" },
      { name: "stream", descriptionKey: "docs.reference.fieldStream" },
      { name: "store", descriptionKey: "docs.reference.fieldStore" },
      { name: "previous_response_id", descriptionKey: "docs.reference.fieldPreviousResponse" },
      { name: "tools", descriptionKey: "docs.reference.fieldTools" },
    ],
    noteKeys: ["docs.reference.noteResponsesState", "docs.reference.noteResponsesCompact"],
    request: (model) => ({ model, input: "Explain HTTP streaming.", store: false, stream: false }),
    response: {
      id: "resp_example",
      object: "response",
      status: "completed",
      model: "grok-chat-fast",
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            { type: "output_text", text: "HTTP streaming sends response data incrementally." },
          ],
        },
      ],
      usage: { input_tokens: 18, output_tokens: 12, total_tokens: 30 },
    },
  },
  "chat/messages": {
    key: "chat/messages",
    category: "Chat",
    title: "Messages",
    method: "POST",
    path: "/messages",
    descriptionKey: "docs.endpointMessages",
    capabilities: ["chat", "responses"],
    fields: [
      { name: "model", required: true, descriptionKey: "docs.reference.fieldModel" },
      { name: "max_tokens", required: true, descriptionKey: "docs.reference.fieldMaxTokens" },
      { name: "messages", required: true, descriptionKey: "docs.reference.fieldMessages" },
      { name: "system", descriptionKey: "docs.reference.fieldSystem" },
      { name: "stream", descriptionKey: "docs.reference.fieldStream" },
      { name: "tools", descriptionKey: "docs.reference.fieldAnthropicTools" },
      { name: "tool_choice", descriptionKey: "docs.reference.fieldToolChoice" },
    ],
    noteKeys: ["docs.reference.noteMessagesEvents", "docs.reference.noteMessagesLimits"],
    request: (model) => ({
      model,
      max_tokens: 1024,
      system: "You are a concise assistant.",
      messages: [{ role: "user", content: "Explain HTTP streaming." }],
      stream: false,
    }),
    response: {
      id: "msg_example",
      type: "message",
      role: "assistant",
      model: "grok-chat-fast",
      content: [{ type: "text", text: "HTTP streaming sends response data incrementally." }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 18, output_tokens: 12 },
    },
  },
  "image/generations": {
    key: "image/generations",
    category: "Image",
    title: "Image generations",
    method: "POST",
    path: "/images/generations",
    descriptionKey: "docs.endpointImageGeneration",
    capabilities: ["image"],
    fields: [
      { name: "model", required: true, descriptionKey: "docs.reference.fieldModel" },
      { name: "prompt", required: true, descriptionKey: "docs.reference.fieldPrompt" },
      { name: "n", descriptionKey: "docs.reference.fieldImageCount" },
      { name: "aspect_ratio", descriptionKey: "docs.reference.fieldAspectRatio" },
      { name: "resolution", descriptionKey: "docs.reference.fieldImageResolution" },
      { name: "quality", descriptionKey: "docs.reference.fieldQuality" },
      { name: "response_format", descriptionKey: "docs.reference.fieldResponseFormat" },
      { name: "stream", descriptionKey: "docs.reference.fieldImageStream" },
    ],
    noteKeys: ["docs.reference.noteImageCount", "docs.reference.noteImageStorage"],
    request: (model) => ({
      model,
      prompt: "A minimal red chair in a bright studio",
      n: 1,
      response_format: "url",
    }),
    response: {
      created: 1783860000,
      data: [{ url: "http://127.0.0.1:8000/v1/media/images/example" }],
    },
  },
  "image/edits": {
    key: "image/edits",
    category: "Image",
    title: "Image edits",
    method: "POST",
    path: "/images/edits",
    descriptionKey: "docs.endpointImageEdit",
    capabilities: ["image_edit"],
    fields: [
      { name: "model", required: true, descriptionKey: "docs.reference.fieldModel" },
      { name: "prompt", required: true, descriptionKey: "docs.reference.fieldPrompt" },
      { name: "image / images", required: true, descriptionKey: "docs.reference.fieldEditImages" },
      { name: "n", descriptionKey: "docs.reference.fieldImageCount" },
      { name: "quality", descriptionKey: "docs.reference.fieldQuality" },
      { name: "response_format", descriptionKey: "docs.reference.fieldResponseFormat" },
    ],
    noteKeys: [
      "docs.reference.noteEditJSON",
      "docs.reference.noteEditSources",
      "docs.reference.noteImageStorage",
    ],
    request: (model) => ({
      model,
      prompt: "Change the chair to black",
      image: { url: "https://example.com/chair.png" },
      n: 1,
      response_format: "url",
    }),
    response: {
      created: 1783860000,
      data: [{ url: "http://127.0.0.1:8000/v1/media/images/example" }],
    },
  },
  "video/generations": {
    key: "video/generations",
    category: "Video",
    title: "Video generations",
    method: "POST",
    path: "/videos/generations",
    descriptionKey: "docs.endpointVideoCreate",
    capabilities: ["video"],
    fields: [
      { name: "model", required: true, descriptionKey: "docs.reference.fieldModel" },
      { name: "prompt", descriptionKey: "docs.reference.fieldVideoPrompt" },
      { name: "duration", descriptionKey: "docs.reference.fieldDuration" },
      { name: "aspect_ratio", descriptionKey: "docs.reference.fieldAspectRatio" },
      { name: "resolution", descriptionKey: "docs.reference.fieldVideoResolution" },
      { name: "image", descriptionKey: "docs.reference.fieldVideoImage" },
      { name: "reference_images", descriptionKey: "docs.reference.fieldReferenceImages" },
      { name: "reference_audios", descriptionKey: "docs.reference.fieldReferenceAudios" },
    ],
    noteKeys: [
      "docs.reference.noteVideoAsync",
      "docs.reference.noteVideoReference",
      "docs.reference.noteVideoStrict",
    ],
    request: (model) => ({
      model,
      prompt: "A paper airplane flying over a city",
      duration: 8,
      aspect_ratio: "16:9",
      resolution: "720p",
    }),
    response: { request_id: "video_example" },
  },
  "video/edits": {
    key: "video/edits",
    category: "Video",
    title: "Video edits",
    method: "POST",
    path: "/videos/edits",
    descriptionKey: "docs.endpointVideoEdit",
    capabilities: ["video"],
    fields: [
      { name: "model", required: true, descriptionKey: "docs.reference.fieldModel" },
      { name: "prompt", required: true, descriptionKey: "docs.reference.fieldVideoEditPrompt" },
      { name: "video", required: true, descriptionKey: "docs.reference.fieldVideoInput" },
    ],
    noteKeys: [
      "docs.reference.noteVideoAsync",
      "docs.reference.noteVideoEditModel",
      "docs.reference.noteVideoBilling",
      "docs.reference.noteVideoStrict",
    ],
    request: () => ({
      model: "grok-imagine-video",
      prompt: "Give the woman a silver necklace",
      video: { url: "https://example.com/source.mp4" },
    }),
    response: { request_id: "video_edit_example" },
  },
  "video/extensions": {
    key: "video/extensions",
    category: "Video",
    title: "Video extensions",
    method: "POST",
    path: "/videos/extensions",
    descriptionKey: "docs.endpointVideoExtend",
    capabilities: ["video"],
    fields: [
      { name: "model", required: true, descriptionKey: "docs.reference.fieldModel" },
      {
        name: "prompt",
        required: true,
        descriptionKey: "docs.reference.fieldVideoExtendPrompt",
      },
      { name: "video", required: true, descriptionKey: "docs.reference.fieldVideoInput" },
      {
        name: "duration",
        descriptionKey: "docs.reference.fieldVideoExtendDuration",
      },
    ],
    noteKeys: [
      "docs.reference.noteVideoAsync",
      "docs.reference.noteVideoEditModel",
      "docs.reference.noteVideoBilling",
      "docs.reference.noteVideoStrict",
    ],
    request: () => ({
      model: "grok-imagine-video",
      prompt: "The shot pans to an over the shoulder perspective.",
      duration: 6,
      video: { url: "https://example.com/source.mp4" },
    }),
    response: { request_id: "video_extend_example" },
  },
  "video/get": {
    key: "video/get",
    category: "Video",
    title: "Get video",
    method: "GET",
    path: "/videos/{request_id}",
    descriptionKey: "docs.endpointVideoGet",
    capabilities: ["video"],
    fields: [
      { name: "request_id", required: true, descriptionKey: "docs.reference.fieldRequestId" },
    ],
    noteKeys: ["docs.reference.noteVideoPolling", "docs.reference.noteVideoStatus"],
    request: () => undefined,
    response: {
      status: "done",
      model: "grok-imagine-video",
      progress: 100,
      video: { url: "https://example.com/generated.mp4", duration: 8, respect_moderation: true },
    },
  },
  "voice/tts": {
    key: "voice/tts",
    category: "Voice",
    title: "Text to speech",
    method: "POST",
    path: "/tts",
    descriptionKey: "docs.endpointTTS",
    capabilities: ["tts"],
    fields: [
      { name: "model", descriptionKey: "docs.reference.fieldVoiceModel" },
      { name: "text", required: true, descriptionKey: "docs.reference.fieldTTSText" },
      { name: "voice_id", descriptionKey: "docs.reference.fieldVoiceId" },
      {
        name: "language",
        required: true,
        descriptionKey: "docs.reference.fieldVoiceLanguage",
      },
      { name: "output_format", descriptionKey: "docs.reference.fieldTTSOutputFormat" },
      { name: "speed", descriptionKey: "docs.reference.fieldTTSSpeed" },
      { name: "with_timestamps", descriptionKey: "docs.reference.fieldTTSTimestamps" },
    ],
    noteKeys: [
      "docs.reference.noteTTSModels",
      "docs.reference.noteTTSBinary",
      "docs.reference.noteVoiceBilling",
    ],
    request: (model) => ({
      model,
      text: "Hello from Grok voice.",
      voice_id: "eve",
      language: "en",
      output_format: { codec: "mp3" },
    }),
    response: {
      content_type: "audio/mpeg",
      note: "Default responses return raw audio bytes. with_timestamps=true returns a JSON envelope.",
    },
  },
  "voice/audio-speech": {
    key: "voice/audio-speech",
    category: "Voice",
    title: "OpenAI speech",
    method: "POST",
    path: "/audio/speech",
    descriptionKey: "docs.endpointAudioSpeech",
    capabilities: ["tts"],
    fields: [
      { name: "model", descriptionKey: "docs.reference.fieldVoiceModel" },
      { name: "input", required: true, descriptionKey: "docs.reference.fieldAudioInput" },
      { name: "voice", descriptionKey: "docs.reference.fieldAudioVoice" },
      { name: "response_format", descriptionKey: "docs.reference.fieldAudioResponseFormat" },
      { name: "speed", descriptionKey: "docs.reference.fieldTTSSpeed" },
      { name: "language", descriptionKey: "docs.reference.fieldVoiceLanguageOptional" },
    ],
    noteKeys: [
      "docs.reference.noteAudioSpeechCompat",
      "docs.reference.noteTTSModels",
      "docs.reference.noteTTSBinary",
      "docs.reference.noteVoiceBilling",
    ],
    request: (model) => ({
      model,
      input: "Hello from Grok voice.",
      voice: "alloy",
      response_format: "mp3",
      speed: 1,
      language: "en",
    }),
    response: {
      content_type: "audio/mpeg",
      note: "Returns raw audio bytes compatible with OpenAI speech clients.",
    },
  },
  "voice/audio-tasks": {
    key: "voice/audio-tasks",
    category: "Voice",
    title: "OpenAI audio tasks",
    method: "POST",
    path: "/audio/tasks",
    descriptionKey: "docs.endpointAudioTasks",
    capabilities: ["tts"],
    fields: [
      { name: "model", descriptionKey: "docs.reference.fieldVoiceModel" },
      { name: "input", required: true, descriptionKey: "docs.reference.fieldAudioInput" },
      { name: "voice", descriptionKey: "docs.reference.fieldAudioVoice" },
      { name: "response_format", descriptionKey: "docs.reference.fieldAudioResponseFormat" },
      { name: "speed", descriptionKey: "docs.reference.fieldTTSSpeed" },
      { name: "language", descriptionKey: "docs.reference.fieldVoiceLanguageOptional" },
    ],
    noteKeys: [
      "docs.reference.noteAudioTasksCompat",
      "docs.reference.noteTTSModels",
      "docs.reference.noteVoiceBilling",
    ],
    request: (model) => ({
      model,
      input: "Hello from Grok voice.",
      voice: "alloy",
      response_format: "mp3",
      language: "en",
    }),
    response: {
      content_type: "audio/mpeg",
      note: "Compatibility path that returns raw audio bytes by default.",
    },
  },
  "voice/audio-transcriptions": {
    key: "voice/audio-transcriptions",
    category: "Voice",
    title: "OpenAI transcriptions",
    method: "POST",
    path: "/audio/transcriptions",
    descriptionKey: "docs.endpointAudioTranscriptions",
    capabilities: ["stt"],
    fields: [
      { name: "model", descriptionKey: "docs.reference.fieldSTTModel" },
      { name: "file", descriptionKey: "docs.reference.fieldSTTFile" },
      { name: "url", descriptionKey: "docs.reference.fieldSTTUrl" },
      { name: "language", descriptionKey: "docs.reference.fieldVoiceLanguage" },
      { name: "response_format", descriptionKey: "docs.reference.fieldSTTResponseFormat" },
    ],
    noteKeys: [
      "docs.reference.noteAudioTranscriptionsCompat",
      "docs.reference.noteSTTInput",
      "docs.reference.noteSTTModels",
      "docs.reference.noteVoiceBilling",
    ],
    request: (model) => ({
      model,
      url: "https://example.com/sample.wav",
      language: "en",
    }),
    response: { text: "Hello from Grok voice." },
  },
  "voice/voices": {
    key: "voice/voices",
    category: "Voice",
    title: "List voices",
    method: "GET",
    path: "/tts/voices",
    descriptionKey: "docs.endpointTTSVoices",
    capabilities: ["tts"],
    fields: [{ name: "model", descriptionKey: "docs.reference.fieldVoiceModelQuery" }],
    noteKeys: ["docs.reference.noteTTSVoices"],
    request: () => undefined,
    response: {
      voices: [
        { voice_id: "eve", name: "Eve", language: "en" },
        { voice_id: "ara", name: "Ara", language: "en" },
      ],
    },
  },
  "voice/voice": {
    key: "voice/voice",
    category: "Voice",
    title: "Get voice",
    method: "GET",
    path: "/tts/voices/{voice_id}",
    descriptionKey: "docs.endpointTTSVoice",
    capabilities: ["tts"],
    fields: [
      { name: "voice_id", required: true, descriptionKey: "docs.reference.fieldVoiceId" },
      { name: "model", descriptionKey: "docs.reference.fieldVoiceModelQuery" },
    ],
    noteKeys: ["docs.reference.noteTTSVoices"],
    request: () => undefined,
    response: { voice_id: "eve", name: "Eve", language: "en" },
  },
  "voice/stt": {
    key: "voice/stt",
    category: "Voice",
    title: "Speech to text",
    method: "POST",
    path: "/stt",
    descriptionKey: "docs.endpointSTT",
    capabilities: ["stt"],
    fields: [
      { name: "model", descriptionKey: "docs.reference.fieldSTTModel" },
      { name: "file", descriptionKey: "docs.reference.fieldSTTFile" },
      { name: "url", descriptionKey: "docs.reference.fieldSTTUrl" },
      { name: "language", descriptionKey: "docs.reference.fieldVoiceLanguage" },
      { name: "format", descriptionKey: "docs.reference.fieldSTTFormat" },
      { name: "diarize", descriptionKey: "docs.reference.fieldSTTDiarize" },
      { name: "keyterm", descriptionKey: "docs.reference.fieldSTTKeyterm" },
    ],
    noteKeys: [
      "docs.reference.noteSTTInput",
      "docs.reference.noteSTTStream",
      "docs.reference.noteSTTModels",
      "docs.reference.noteVoiceBilling",
    ],
    request: (model) => ({
      model,
      url: "https://example.com/sample.wav",
      language: "en",
      format: true,
    }),
    response: {
      text: "Hello from Grok voice.",
      language: "en",
      duration: 1.84,
      words: [{ text: "Hello", start: 0, end: 0.42 }],
    },
  },
  "voice/stt-stream": {
    key: "voice/stt-stream",
    category: "Voice",
    title: "Streaming speech to text",
    method: "GET",
    path: "/stt",
    descriptionKey: "docs.endpointSTTStream",
    capabilities: ["stt"],
    fields: [
      { name: "model", descriptionKey: "docs.reference.fieldSTTModel" },
      { name: "Upgrade", required: true, descriptionKey: "docs.reference.fieldWSUpgrade" },
    ],
    noteKeys: [
      "docs.reference.noteSTTStream",
      "docs.reference.noteSTTModels",
      "docs.reference.noteVoiceBilling",
    ],
    request: () => undefined,
    response: { type: "transcript.done", text: "Hello from Grok voice.", duration: 1.84 },
  },
  "voice/realtime": {
    key: "voice/realtime",
    category: "Voice",
    title: "Realtime websocket",
    method: "GET",
    path: "/realtime",
    descriptionKey: "docs.endpointRealtime",
    capabilities: ["realtime"],
    fields: [
      { name: "model", descriptionKey: "docs.reference.fieldRealtimeModelQuery" },
      { name: "Upgrade", required: true, descriptionKey: "docs.reference.fieldWSUpgrade" },
    ],
    noteKeys: [
      "docs.reference.noteRealtimeEvents",
      "docs.reference.noteRealtimeProxy",
      "docs.reference.noteRealtimeAuth",
      "docs.reference.noteVoiceBilling",
    ],
    request: () => undefined,
    response: { type: "session.created", session: { model: "grok-voice-latest" } },
  },
};

export function uniqueModelsByPublicID(models: ModelRouteDTO[]): ModelRouteDTO[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.publicId)) return false;
    seen.add(model.publicId);
    return true;
  });
}

export function withExampleModel(
  response: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  return "model" in response ? { ...response, model } : response;
}

export function fallbackModel(key: string): string {
  if (key.startsWith("image/"))
    return key === "image/edits" ? "grok-imagine-image-edit" : "grok-imagine-image-lite";
  if (key.startsWith("video/")) return "grok-imagine-video";
  if (key.startsWith("voice/")) {
    if (key.startsWith("voice/stt") || key === "voice/audio-transcriptions") return "grok-stt";
    return "grok-voice-latest";
  }
  return "your-enabled-model";
}

export function createExamples(
  definition: EndpointDefinition,
  baseUrl: string,
  model: string,
): Record<ExampleLanguage, string> {
  const request = definition.request(model);
  const path = definition.path
    .replace("{request_id}", "video_example")
    .replace("{voice_id}", "eve");
  const modelQueryKeys = new Set([
    "voice/realtime",
    "voice/stt-stream",
    "voice/voices",
    "voice/voice",
  ]);
  const url = modelQueryKeys.has(definition.key)
    ? `${baseUrl}${path}?model=${encodeURIComponent(model)}`
    : `${baseUrl}${path}`;
  const websocket = definition.key === "voice/realtime" || definition.key === "voice/stt-stream";
  if (websocket) {
    const websocketURL = url.replace(/^http/, "ws");
    return {
      curl: `export GROK2API_API_KEY="g2a_your_api_key"\n\nnpx wscat -c "${websocketURL}" \\\n  -H "Authorization: Bearer $GROK2API_API_KEY"`,
      python: `import websocket\n\nws = websocket.create_connection(\n    "${websocketURL}",\n    header=["Authorization: Bearer g2a_your_api_key"]\n)\nprint(ws.recv())\nws.close()`,
      javascript: `import WebSocket from "ws";\n\nconst socket = new WebSocket("${websocketURL}", {\n  headers: { Authorization: "Bearer g2a_your_api_key" }\n});\n\nsocket.on("message", (data) => console.log(data.toString()));`,
    };
  }

  const messageHeaders = definition.key === "chat/messages";
  const curlHeaders = messageHeaders
    ? [
        '  -H "x-api-key: $GROK2API_API_KEY"',
        '  -H "anthropic-version: 2023-06-01"',
        '  -H "Content-Type: application/json"',
      ].join(" \\\n")
    : [
        '  -H "Authorization: Bearer $GROK2API_API_KEY"',
        '  -H "Content-Type: application/json"',
      ].join(" \\\n");
  const curlBody = request ? ` \\\n  -d '${JSON.stringify(request, null, 2)}'` : "";
  const binaryResponse = new Set(["voice/tts", "voice/audio-speech", "voice/audio-tasks"]).has(
    definition.key,
  );
  const curlOutput = binaryResponse ? ` \\\n  --output speech.mp3` : "";
  const headers = messageHeaders
    ? {
        "x-api-key": "g2a_your_api_key",
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      }
    : { Authorization: "Bearer g2a_your_api_key", "Content-Type": "application/json" };
  const pythonImports = request ? "import json\nimport requests" : "import requests";
  const pythonPayload = request
    ? `\n\npayload = json.loads(r'''${JSON.stringify(request, null, 2)}''')`
    : "";
  const pythonBody = request ? ",\n    json=payload" : "";
  const pythonResult = binaryResponse
    ? '\nwith open("speech.mp3", "wb") as output:\n    output.write(response.content)'
    : "\nprint(response.json())";
  const javascriptBody = request
    ? `,\n  body: JSON.stringify(${JSON.stringify(request, null, 2)})`
    : "";
  const javascriptResult = binaryResponse
    ? "const audio = await response.arrayBuffer();\nconsole.log(`Received ${audio.byteLength} audio bytes`);"
    : "console.log(await response.json());";
  return {
    curl: `export GROK2API_API_KEY="g2a_your_api_key"\n\ncurl -X ${definition.method} "${url}" \\\n${curlHeaders}${curlBody}${curlOutput}`,
    python: `${pythonImports}${pythonPayload}\n\nresponse = requests.${definition.method.toLowerCase()}(\n    "${url}",\n    headers=${JSON.stringify(headers, null, 2)}${pythonBody}\n)\nresponse.raise_for_status()${pythonResult}`,
    javascript: `const response = await fetch("${url}", {\n  method: "${definition.method}",\n  headers: ${JSON.stringify(headers, null, 2)}${javascriptBody}\n});\n\nif (!response.ok) throw new Error(await response.text());\n${javascriptResult}`,
  };
}
