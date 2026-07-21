# Protocol golden fixtures

These fixtures are offline inputs for JSON/SSE compatibility tests. Volatile IDs, timestamps and unordered JSON object keys are normalized before comparison. Tests never access the network.

Coverage includes OpenAI Responses, Chat Completions, streamed chunks, tool calls, Anthropic Messages, usage/cache accounting, image/video metadata, 401/403/429 errors and malformed responses.

Golden files are immutable during normal tests. Update them only with:

```powershell
$env:UPDATE_GOLDEN='1'
go test ./internal/transport/protocolgolden
```

Review every generated diff before committing. Fixtures must not contain real credentials, account identifiers, private URLs or request content.
