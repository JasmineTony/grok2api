package httpserver

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// 本文件把「静态托管的敏感文件暴露面」的**当前行为**表征化（characterization test），不修改任何生产代码。
//
// 背景（独立只读评估 R16 + 已登记项）：frontend.go 的静态托管除「根级点文件」外没有任何白名单，
// 当 FrontendStaticPath 指向配置目录（"."）或父目录、且该目录含 index.html 时，GET /config.yaml、GET /data/*.db
// 会返回 200；默认 ./frontend/dist 与镜像布局不可触发。
// 登记编号：backend/AUDIT.md §25.2 第 3 项（未成文未测的三处风险）与 §32.1（P2；「dist 与 config 同目录」形态为 P1）。
// 目的：任何未来的白名单 / 启动期 fail-fast 收紧都必须**显式修改本文件的断言**并被评审看到；
// 这些断言固定的是现状，**不是**对该行为的认可。装配方式复用 server_test.go 的 testDependencies 夹具与静态根写法。

const (
	// 仅用于行为表征的假值，不包含任何真实凭据。
	testExposureConfigContent = "jwtSecret: TEST-ONLY\ncredentialEncryptionKey: TEST-ONLY\n"
	testExposureDotEnvContent = "JWT_SECRET=TEST-ONLY\n"
	testExposureNestedDotEnv  = "NESTED_JWT_SECRET=TEST-ONLY\n"
	testExposureDBContent     = "TEST-ONLY-SQLITE-BYTES"
	testExposureIndexContent  = "<html>app</html>"
)

// writeStaticRootFiles 在 dir 下按相对路径写入夹具文件，自动创建父目录。
func writeStaticRootFiles(t *testing.T, dir string, files map[string]string) {
	t.Helper()
	for name, content := range files {
		target := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			t.Fatalf("创建目录 %s 失败: %v", filepath.Dir(target), err)
		}
		if err := os.WriteFile(target, []byte(content), 0o600); err != nil {
			t.Fatalf("写入 %s 失败: %v", target, err)
		}
	}
}

// newStaticRoot 新建临时静态根并写入夹具文件。
func newStaticRoot(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	writeStaticRootFiles(t, root, files)
	return root
}

// staticExposureRouter 用给定静态根装配完整路由（deps 复用 server_test.go 的 testDependencies）。
func staticExposureRouter(t *testing.T, root string) *gin.Engine {
	t.Helper()
	deps := testDependencies()
	deps.Logger = slog.Default()
	deps.FrontendStaticPath = root
	return New(deps)
}

// staticExposureRequest 对已装配路由发起一次真实请求，返回原始 recorder（需要读响应头或非 GET 方法时使用）。
func staticExposureRequest(router *gin.Engine, method, requestPath string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(method, requestPath, nil))
	return recorder
}

// staticExposureGet 对已装配路由发起一次真实 GET，返回状态码与响应体。
func staticExposureGet(router *gin.Engine, requestPath string) (int, string) {
	recorder := staticExposureRequest(router, http.MethodGet, requestPath)
	return recorder.Code, recorder.Body.String()
}

// TestFrontendStaticExposureServesSensitiveFilesFromConfiguredRoot 固定现状：静态根内的非点文件敏感文件会被原样服务。
// 语义：registerFrontend(frontend.go:14-47) 只用 isHiddenArtifact 拦根级点文件，没有扩展名/目录白名单，
// 因此当 FrontendStaticPath 同时含 index.html 与 config.yaml 时，GET /config.yaml 返回 200 且响应体为文件原文。
// 这是已登记的暴露面（backend/AUDIT.md §25.2 第 3 项、§32.1；P2，误配置形态 P1），
// 本断言的存在是为了让未来收紧（fail-fast 或白名单）必须显式改测试，**不是**认可该行为。
func TestFrontendStaticExposureServesSensitiveFilesFromConfiguredRoot(t *testing.T) {
	root := newStaticRoot(t, map[string]string{
		"index.html":      testExposureIndexContent,
		"config.yaml":     testExposureConfigContent,
		"data/backend.db": testExposureDBContent,
	})
	router := staticExposureRouter(t, root)
	for _, test := range []struct {
		path string
		body string
	}{
		{path: "/config.yaml", body: "jwtSecret: TEST-ONLY"},
		{path: "/data/backend.db", body: testExposureDBContent},
	} {
		t.Run(test.path, func(t *testing.T) {
			status, body := staticExposureGet(router, test.path)
			if status != http.StatusOK {
				t.Fatalf("%s status = %d, want %d：静态根暴露面语义已变化，必须同步 backend/AUDIT.md §25.2/§32.1 登记", test.path, status, http.StatusOK)
			}
			if !strings.Contains(body, test.body) {
				t.Fatalf("%s body = %q, want 含 %q", test.path, body, test.body)
			}
		})
	}
}

// TestFrontendStaticExposureRejectsRootLevelDotfiles 固定现状：唯一的守卫只拦「产物根级点文件」。
// 语义：isHiddenArtifact(frontend.go:99-101) 要求解析后的相对路径目录为根且基名以 "." 开头，
// 所以 /.env 返回 404；但该守卫不是白名单——同目录的 config.yaml、data/*.db 仍被 200 服务
// （见 TestFrontendStaticExposureServesSensitiveFilesFromConfiguredRoot），
// 且**子目录**点文件不受拦：/data/.env 返回 200 文件原文（path.Dir(clean) != "/" ⇒ 守卫不触发）。
// 后者是「唯一守卫」的精确边界，也是未来收紧白名单/加目录规则时最易误伤的一侧，故用独有内容
// NESTED_JWT_SECRET=TEST-ONLY 区分，确保响应来自 data/.env 而非根级 .env。
// 登记：backend/AUDIT.md §25.2 第 3 项、§32.1。
func TestFrontendStaticExposureRejectsRootLevelDotfiles(t *testing.T) {
	root := newStaticRoot(t, map[string]string{
		"index.html": testExposureIndexContent,
		".env":       testExposureDotEnvContent,
		"data/.env":  testExposureNestedDotEnv,
	})
	router := staticExposureRouter(t, root)
	status, body := staticExposureGet(router, "/.env")
	if status != http.StatusNotFound {
		t.Fatalf("/.env status = %d, want %d（根级点文件守卫 frontend.go:99-101 失效）", status, http.StatusNotFound)
	}
	if strings.Contains(body, "JWT_SECRET") {
		t.Fatalf("/.env body = %q，泄漏了点文件内容", body)
	}
	status, body = staticExposureGet(router, "/data/.env")
	if status != http.StatusOK {
		t.Fatalf("/data/.env status = %d, want %d：守卫只覆盖根级点文件，子目录点文件语义已变化，必须同步 backend/AUDIT.md §25.2/§32.1", status, http.StatusOK)
	}
	if !strings.Contains(body, testExposureNestedDotEnv) {
		t.Fatalf("/data/.env body = %q, want 含 %q", body, testExposureNestedDotEnv)
	}
}

// TestFrontendStaticExposureNotRegisteredWithoutIndexHTML 固定前置条件：静态根不含 index.html 时静态托管整体不注册。
// 语义：frontendRoot(frontend.go:49-68) 要求 staticPath 非空、存在且为目录、index.html 为常规文件，
// 任一不满足即 return，NoRoute 不注册 ⇒ 敏感文件请求落到 gin 默认 404。
// 这正是 §32.1 把该风险定为 P2 的依据（默认 ./frontend/dist 与镜像布局不可触发），
// 也是本文件其余用例都必须先写入 index.html 的原因。
// 口径更正（F2）：判别力来自带扩展名的路径（/config.yaml、/data/backend.db）——注册后它们会返回 200 文件原文，
// 未注册才是 404；`/dashboard` 子例**不构成**「路由未注册」的证据：它在「NoRoute 未注册」与
// 「NoRoute 已注册但 SPA 回退目标 index.html 缺失」两种情形下同样是 404，故只作为 SPA 回退路径的负向对照保留。
// frontendRoot 的四种失败形态（staticPath 为空 / 目录不存在 / 路径是普通文件 / index.html 是目录）
// 另见 TestFrontendStaticExposureRootFailureMatrix。
func TestFrontendStaticExposureNotRegisteredWithoutIndexHTML(t *testing.T) {
	root := newStaticRoot(t, map[string]string{
		"config.yaml":     testExposureConfigContent,
		"data/backend.db": testExposureDBContent,
	})
	router := staticExposureRouter(t, root)
	for _, requestPath := range []string{"/config.yaml", "/data/backend.db", "/dashboard"} {
		t.Run(requestPath, func(t *testing.T) {
			status, body := staticExposureGet(router, requestPath)
			if status != http.StatusNotFound {
				t.Fatalf("%s status = %d, want %d（缺少 index.html 时不应注册静态托管）", requestPath, status, http.StatusNotFound)
			}
			if strings.Contains(body, "TEST-ONLY") {
				t.Fatalf("%s body = %q，静态托管在缺少 index.html 时仍然生效", requestPath, body)
			}
		})
	}
}

// TestFrontendStaticExposureRejectsDirectoryTraversal 固定现状：HTTP 层永远拿不到静态根之外的内容。
// 语义：请求路径先经 path.Clean 归一化（绝对路径根处的 ".." 被丢弃），再由 frontendFile 的 filepath.Rel 确认落在 root 内。
// 注意（实测结论，勿当成对 filepath.Rel 守卫的覆盖）：即便把该守卫改成只判 err（变异 B），本用例仍全部通过——
// http.FileServer 会把 "/../x" 归一化回 root 内而返回 404，所以守卫在 HTTP 层不可观测；
// 守卫本身的回归由 TestFrontendFileRejectsResolvedPathsOutsideRoot 直接覆盖。
// 对照组把父目录本身当静态根（含 index.html），证明该哨兵文件确实可被服务 ⇒ 上面的 404 来自 root 边界，
// 不是「文件不存在」造成的空转断言。
func TestFrontendStaticExposureRejectsDirectoryTraversal(t *testing.T) {
	const sentinel = "TEST-ONLY-OUTSIDE-SECRET"
	base := t.TempDir()
	root := filepath.Join(base, "dist")
	writeStaticRootFiles(t, base, map[string]string{
		"index.html":         testExposureIndexContent,
		"outside-secret.txt": sentinel,
	})
	writeStaticRootFiles(t, root, map[string]string{"index.html": testExposureIndexContent})

	traversal := staticExposureRouter(t, root)
	// `/..\outside-secret.txt` 走的是别名形态：path.Clean 只把 "\" 当普通字符，归一化平台（Windows）的 filepath.Join
	// 会把它当上级目录；Linux 上 "\" 是普通文件名字符、由 os.Stat 失败兜底（同 server_test.go:116-119 的别名口径）。
	// 两类平台的期望结果一致：404 且响应体不含 root 外内容。
	for _, requestPath := range []string{"/../outside-secret.txt", "/%2e%2e/outside-secret.txt", "/..%2foutside-secret.txt", `/..\outside-secret.txt`} {
		t.Run(requestPath, func(t *testing.T) {
			status, body := staticExposureGet(traversal, requestPath)
			if status != http.StatusNotFound {
				t.Fatalf("%s status = %d, want %d（frontend.go:70-85 的 filepath.Rel 防护失效）", requestPath, status, http.StatusNotFound)
			}
			if strings.Contains(body, sentinel) {
				t.Fatalf("%s body = %q，返回了静态根之外的内容", requestPath, body)
			}
		})
	}

	control := staticExposureRouter(t, base)
	status, body := staticExposureGet(control, "/outside-secret.txt")
	if status != http.StatusOK || !strings.Contains(body, sentinel) {
		t.Fatalf("对照组 /outside-secret.txt status = %d body = %q, want %d 且含哨兵内容", status, body, http.StatusOK)
	}
}

// TestFrontendFileRejectsResolvedPathsOutsideRoot 直接固定 frontendFile 的 root 边界（frontend.go:70-85）。
// 语义：path.Clean 已把 URL 路径里的 ".." 在根处消掉，唯一能让 filepath.Join 解析到 root 之外的输入是含 "\" 的别名
// （path.Clean 视 "\" 为普通字符，而归一化平台 Windows 的 filepath.Join 把它当分隔符）⇒ 由 filepath.Rel 拦截。
// 该分支在 HTTP 层不可观测（见 TestFrontendStaticExposureRejectsDirectoryTraversal 的实测说明），回归只能靠这里。
// 口径边界：非归一化平台（Linux）上 "\" 是普通文件名字符、os.Stat 直接失败 ⇒ 本用例在 Linux 上不具判别力（同 server_test.go:116-119）。
func TestFrontendFileRejectsResolvedPathsOutsideRoot(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "dist")
	writeStaticRootFiles(t, base, map[string]string{"outside-secret.txt": "TEST-ONLY-OUTSIDE-SECRET"})
	writeStaticRootFiles(t, root, map[string]string{"index.html": testExposureIndexContent})

	relative, exists := frontendFile(root, "/index.html")
	if !exists || relative != "index.html" {
		t.Fatalf("frontendFile(root, \"/index.html\") = (%q, %v), want (\"index.html\", true)：夹具无效，后续断言会空转", relative, exists)
	}
	if relative, exists := frontendFile(root, `/..\outside-secret.txt`); exists {
		t.Fatalf(`frontendFile(root, "/..\\outside-secret.txt") = %q, true；解析结果越出 root 却未被 filepath.Rel 拦截`, relative)
	}
}

// TestFrontendStaticExposureCacheControlValues 固定 frontend.go:31-35 的 Cache-Control **精确取值**：
// 请求路径经 path.Clean 后以 "/assets/" 开头 ⇒ "public, max-age=31536000, immutable"；
// 其余命中静态文件（含 config.yaml）与 SPA 回退（/dashboard）⇒ "no-cache"。
// 断言完整字符串而非前缀：哈希资源的长期复用与 index.html 的即时失效都建立在这两个取值上，
// 任何取值变化（例如加 must-revalidate、把 index.html 改为 no-store）必须显式修改本断言。
func TestFrontendStaticExposureCacheControlValues(t *testing.T) {
	root := newStaticRoot(t, map[string]string{
		"index.html":    testExposureIndexContent,
		"config.yaml":   testExposureConfigContent,
		"assets/app.js": "console.log('app')",
	})
	router := staticExposureRouter(t, root)
	for _, test := range []struct {
		path string
		want string
	}{
		{path: "/config.yaml", want: "no-cache"},
		{path: "/assets/app.js", want: "public, max-age=31536000, immutable"},
		{path: "/dashboard", want: "no-cache"},
	} {
		t.Run(test.path, func(t *testing.T) {
			recorder := staticExposureRequest(router, http.MethodGet, test.path)
			if recorder.Code != http.StatusOK {
				t.Fatalf("%s status = %d, want %d", test.path, recorder.Code, http.StatusOK)
			}
			if got := recorder.Header().Get("Cache-Control"); got != test.want {
				t.Fatalf("%s Cache-Control = %q, want %q", test.path, got, test.want)
			}
		})
	}
}

// TestFrontendStaticExposureMethodDimension 固定方法维度（frontend.go:22-25）：NoRoute 只处理 GET/HEAD，
// 其余方法一律 404 且不进入静态文件解析。
// HEAD /config.yaml 与 GET 走同一条解析链（200 + 空体，Cache-Control 与 GET 相同）；
// POST /config.yaml 由 `c.Status(http.StatusNotFound)` 直接结束 ⇒ 404、空体（实测行为，非 gin 默认 404 文本）。
func TestFrontendStaticExposureMethodDimension(t *testing.T) {
	root := newStaticRoot(t, map[string]string{
		"index.html":  testExposureIndexContent,
		"config.yaml": testExposureConfigContent,
	})
	router := staticExposureRouter(t, root)

	head := staticExposureRequest(router, http.MethodHead, "/config.yaml")
	if head.Code != http.StatusOK {
		t.Fatalf("HEAD /config.yaml status = %d, want %d（HEAD 应与 GET 同样命中静态文件）", head.Code, http.StatusOK)
	}
	if head.Body.Len() != 0 {
		t.Fatalf("HEAD /config.yaml body = %q, want 空体", head.Body.String())
	}

	post := staticExposureRequest(router, http.MethodPost, "/config.yaml")
	if post.Code != http.StatusNotFound {
		t.Fatalf("POST /config.yaml status = %d, want %d（非 GET/HEAD 不应进入静态托管）", post.Code, http.StatusNotFound)
	}
	if strings.Contains(post.Body.String(), "TEST-ONLY") {
		t.Fatalf("POST /config.yaml body = %q，非 GET/HEAD 请求泄漏了静态文件内容", post.Body.String())
	}
}

// TestFrontendStaticExposureRootFailureMatrix 参数化 frontendRoot(frontend.go:49-68) 的失败矩阵：
// staticPath 为空、目录不存在、路径是普通文件、index.html 是目录 —— 四种形态下静态托管整体不注册，
// 敏感文件请求落到 gin 默认 404。这正是 §32.1 把该风险定为 P2 的依据（默认 ./frontend/dist 不可触发）。
// 末段对照组用同一夹具下的正常根，证明上面的 404 来自 frontendRoot 失败而不是夹具写错（避免空转断言）。
func TestFrontendStaticExposureRootFailureMatrix(t *testing.T) {
	base := t.TempDir()
	plainFile := filepath.Join(base, "not-a-directory.txt")
	writeStaticRootFiles(t, base, map[string]string{
		"not-a-directory.txt":        testExposureConfigContent,
		"index-is-a-dir/config.yaml": testExposureConfigContent,
		"dist/index.html":            testExposureIndexContent,
		"dist/config.yaml":           testExposureConfigContent,
	})
	indexDirRoot := filepath.Join(base, "index-is-a-dir")
	if err := os.MkdirAll(filepath.Join(indexDirRoot, "index.html"), 0o755); err != nil {
		t.Fatalf("创建 index.html 目录失败: %v", err)
	}
	for _, test := range []struct {
		name       string
		staticPath string
	}{
		{name: "staticPath 为空", staticPath: ""},
		{name: "目录不存在", staticPath: filepath.Join(base, "missing")},
		{name: "路径是普通文件", staticPath: plainFile},
		{name: "index.html 是目录", staticPath: indexDirRoot},
	} {
		t.Run(test.name, func(t *testing.T) {
			router := staticExposureRouter(t, test.staticPath)
			status, body := staticExposureGet(router, "/config.yaml")
			if status != http.StatusNotFound {
				t.Fatalf("静态根形态 %q：/config.yaml status = %d, want %d（frontendRoot 应判定失败并不注册）", test.staticPath, status, http.StatusNotFound)
			}
			if strings.Contains(body, "TEST-ONLY") {
				t.Fatalf("静态根形态 %q：/config.yaml body = %q，静态托管在该形态下仍然生效", test.staticPath, body)
			}
		})
	}

	control := staticExposureRouter(t, filepath.Join(base, "dist"))
	status, body := staticExposureGet(control, "/config.yaml")
	if status != http.StatusOK || !strings.Contains(body, "jwtSecret: TEST-ONLY") {
		t.Fatalf("对照组 dist/config.yaml status = %d body = %q, want %d 且含文件原文", status, body, http.StatusOK)
	}
}
