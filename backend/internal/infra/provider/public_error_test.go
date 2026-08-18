package provider

import (
	"errors"
	"testing"
)

type testPublicCodeError string

func (e testPublicCodeError) Error() string           { return "private provider detail" }
func (e testPublicCodeError) PublicErrorCode() string { return string(e) }

func TestErrorPublicCodeAcceptsOnlyBoundedMachineCodes(t *testing.T) {
	code, ok := ErrorPublicCode(errors.Join(errors.New("wrapper"), testPublicCodeError("web_lite_image_parse_failed")))
	if !ok || code != "web_lite_image_parse_failed" {
		t.Fatalf("code=%q ok=%t", code, ok)
	}
	for _, invalid := range []string{"UPPERCASE", "contains space", "path/value", string(make([]byte, 65))} {
		if code, ok := ErrorPublicCode(testPublicCodeError(invalid)); ok || code != "" {
			t.Fatalf("invalid code %q accepted as %q", invalid, code)
		}
	}
}
