package httpserver

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chenyme/grok2api/backend/internal/transport/http/middleware"
)

func testDependencies() Dependencies {
	return Dependencies{RequestTimeout: time.Second, MaxBodyBytes: 1024, ConcurrencyGate: middleware.NewConcurrencyGate(1024)}
}

func TestReadinessEndpointReturnsStructuredDegradedStateAsReady(t *testing.T) {
	deps := testDependencies()
	deps.Readiness = func(context.Context) ReadinessSnapshot {
		return ReadinessSnapshot{
			Ready: true, State: "degraded", UpdatedAt: time.Now().UTC(),
			Components: map[string]ReadinessComponent{
				"grok_build": {State: "ready"},
				"grok_web":   {State: "unavailable"},
			},
		}
	}
	router := New(deps)
	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	var body ReadinessSnapshot
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.Ready || body.State != "degraded" || body.Components["grok_build"].State != "ready" {
		t.Fatalf("body = %#v", body)
	}
}

func TestReadinessEndpointReturns503WhileReconciling(t *testing.T) {
	deps := testDependencies()
	deps.Readiness = func(context.Context) ReadinessSnapshot {
		return ReadinessSnapshot{Ready: false, State: "reconciling", UpdatedAt: time.Now().UTC()}
	}
	router := New(deps)
	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable || !strings.Contains(recorder.Body.String(), `"state":"reconciling"`) {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestInferenceTrafficIsRejectedWhileReconciling(t *testing.T) {
	deps := testDependencies()
	deps.TrafficReady = func() bool { return false }
	router := New(deps)
	request := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable || !strings.Contains(recorder.Body.String(), `"code":"service_reconciling"`) {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestSystemEndpointsRequireAdminAuthentication(t *testing.T) {
	deps := testDependencies()
	deps.PublicAPIBaseURL = "https://api.example.com"
	router := New(deps)
	for _, route := range []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/admin/v1/system"},
		{method: http.MethodGet, path: "/api/admin/v1/system/version"},
		{method: http.MethodPost, path: "/api/admin/v1/system/update/check"},
	} {
		request := httptest.NewRequest(route.method, route.path, nil)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s status = %d, want %d", route.method, route.path, recorder.Code, http.StatusUnauthorized)
		}
	}
}

func TestFrontendStaticFilesAndSPAFallback(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("<html>app</html>"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "assets", "app.js"), []byte("console.log('app')"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".build-manifest.json"), []byte(`{"version":1}`), 0o600); err != nil {
		t.Fatal(err)
	}
	deps := testDependencies()
	deps.Logger = slog.Default()
	deps.FrontendStaticPath = root
	router := New(deps)
	// 隐藏产物的 404 判定链（frontend.go）：frontendFile(:70-85) 把请求路径解析为相对路径，
	// isHiddenArtifact(:27-30) 拦截根级点文件；解析失败时由 path.Ext 兜底(:40-42) 对带扩展名的缺失路径返回 404。
	// 别名路径被哪条分支拦下取决于 root 所在卷的路径归一化语义，两个平台覆盖的分支不同：
	//   - 归一化平台（Windows/NTFS 等大小写不敏感卷）：os.Stat 命中 .build-manifest.json，404 来自 isHiddenArtifact；
	//   - 非归一化平台（CI 的 Linux 大小写敏感卷）：os.Stat 直接失败，404 来自 path.Ext 兜底。
	// 这里显式断言实际命中的分支，避免别名用例在 CI 上只覆盖兜底分支、却被读成同样覆盖了隐藏产物守卫。
	for _, alias := range []string{"/.BUILD-MANIFEST.JSON", `/x\..\.build-manifest.json`} {
		relative, resolved := frontendFile(root, alias)
		switch {
		case resolved && isHiddenArtifact(relative):
			t.Logf("别名 %s 归一到 %q，404 由 isHiddenArtifact 拦截", alias, relative)
		case !resolved:
			t.Logf("别名 %s 未被 os.Stat 归一化，404 依赖 path.Ext 兜底（frontend.go:40-42）", alias)
		default:
			t.Fatalf("别名 %s 解析为 %q 却未被 isHiddenArtifact 拦截，隐藏产物守卫失效", alias, relative)
		}
	}

	for _, test := range []struct {
		path        string
		status      int
		body        string
		cachePrefix string
	}{
		{path: "/assets/app.js", status: http.StatusOK, body: "console.log('app')", cachePrefix: "public"},
		// 别名用例断言的是平台无关结果：客户端无论大小写/路径写法如何都拿不到根级产物；
		// 具体由哪条分支拦下随平台变化（见上方分支断言），CI(Linux) 命中 path.Ext 兜底，Windows 命中 isHiddenArtifact。
		{path: "/.build-manifest.json", status: http.StatusNotFound},
		{path: "/.BUILD-MANIFEST.JSON", status: http.StatusNotFound},
		{path: "/x\\..\\.build-manifest.json", status: http.StatusNotFound},
		{path: "/dashboard", status: http.StatusOK, body: "<html>app</html>", cachePrefix: "no-cache"},
		{path: "/assets/missing.js", status: http.StatusNotFound},
		{path: "/api/admin/v1/missing", status: http.StatusNotFound},
		{path: "/swagger/index.html", status: http.StatusNotFound},
	} {
		t.Run(test.path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)
			if recorder.Code != test.status {
				t.Fatalf("status = %d, want %d", recorder.Code, test.status)
			}
			if test.body != "" && !strings.Contains(recorder.Body.String(), test.body) {
				t.Fatalf("body = %q", recorder.Body.String())
			}
			if test.cachePrefix != "" && !strings.HasPrefix(recorder.Header().Get("Cache-Control"), test.cachePrefix) {
				t.Fatalf("cache-control = %q", recorder.Header().Get("Cache-Control"))
			}
		})
	}
}

// TestIsHiddenArtifactOnResolvedAliases 固定 isHiddenArtifact 的平台无关语义（frontend.go:97-101）：
// 判定输入是 os.Stat 解析后的相对路径，因此别名一旦被文件系统归一化（大小写变化、`x\..` 折叠），
// 仍然必须按根级点文件拦截。Linux CI 上 os.Stat 对这类别名直接失败、HTTP 层覆盖不到该归一化结果，回归只能靠这里。
func TestIsHiddenArtifactOnResolvedAliases(t *testing.T) {
	for _, test := range []struct {
		relative string
		hidden   bool
	}{
		{relative: ".build-manifest.json", hidden: true},
		{relative: ".BUILD-MANIFEST.JSON", hidden: true},
		{relative: "build-manifest.json", hidden: false},
		{relative: "assets/.build-manifest.json", hidden: false},
		{relative: "assets/app.js", hidden: false},
	} {
		if got := isHiddenArtifact(test.relative); got != test.hidden {
			t.Fatalf("isHiddenArtifact(%q) = %v, want %v", test.relative, got, test.hidden)
		}
	}
}

func TestSwaggerRegistrationFollowsStartupConfig(t *testing.T) {
	disabledDeps := testDependencies()
	disabledDeps.Logger = slog.Default()
	disabled := New(disabledDeps)
	disabledRequest := httptest.NewRequest(http.MethodGet, "/swagger/doc.json", nil)
	disabledRecorder := httptest.NewRecorder()
	disabled.ServeHTTP(disabledRecorder, disabledRequest)
	if disabledRecorder.Code != http.StatusNotFound {
		t.Fatalf("disabled swagger status = %d, want %d", disabledRecorder.Code, http.StatusNotFound)
	}

	enabledDeps := testDependencies()
	enabledDeps.Logger = slog.Default()
	enabledDeps.SwaggerEnabled = true
	enabled := New(enabledDeps)
	enabledRequest := httptest.NewRequest(http.MethodGet, "/swagger/doc.json", nil)
	enabledRecorder := httptest.NewRecorder()
	enabled.ServeHTTP(enabledRecorder, enabledRequest)
	if enabledRecorder.Code != http.StatusOK {
		t.Fatalf("enabled swagger status = %d, want %d", enabledRecorder.Code, http.StatusOK)
	}
	var document struct {
		Info struct {
			Title string `json:"title"`
		} `json:"info"`
	}
	if err := json.Unmarshal(enabledRecorder.Body.Bytes(), &document); err != nil {
		t.Fatalf("decode swagger document: %v", err)
	}
	if document.Info.Title != "Grok2API" {
		t.Fatalf("swagger title = %q, want %q", document.Info.Title, "Grok2API")
	}
}
