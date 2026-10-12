package greeting

import "testing"

// 夹具：*_test.go 允许被 .dockerignore 排除，不进入必需集合。
func TestHello(t *testing.T) {
	if Hello() == "" {
		t.Fatal("Hello() 不应为空")
	}
}
