package protocolgolden

import "testing"

func TestNormalizeJSONIgnoresVolatileFields(t *testing.T) {
	left := []byte(`{"created":171,"id":"resp_a","output":[{"type":"message","content":"ok"}],"usage":{"input_tokens":2}}`)
	right := []byte(`{"usage":{"input_tokens":2},"id":"resp_b","created":999,"output":[{"type":"message","content":"ok"}]}`)
	equal, err := StableJSONEqual(left, right)
	if err != nil || !equal {
		t.Fatalf("equal=%v err=%v", equal, err)
	}
}

func TestNormalizeSSEKeepsProtocolFrames(t *testing.T) {
	input := []byte("event: response\ndata: {\"id\":\"a\",\"delta\":\"hi\"}\n\ndata: [DONE]\n")
	got, err := NormalizeSSE(input)
	if err != nil {
		t.Fatal(err)
	}
	want := "event: response\ndata: {\n  \"delta\": \"hi\",\n  \"id\": \"<normalized>\"\n}\n\ndata: [DONE]\n"
	if string(got) != want {
		t.Fatalf("got %q want %q", got, want)
	}
}
