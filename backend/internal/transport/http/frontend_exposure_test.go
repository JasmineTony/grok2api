package httpserver

import (
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// 本文件固定静态托管的两条契约，二者都在 frontend.go 内实现：
//
//  1. BE-R1 暴露面收紧：注册静态托管前做启动期安全校验（staticRootExposureViolation），
//     staticPath 指向含 config.yaml / config.*.yaml / .env* / *.db / *.sqlite3 / .git / 可执行文件 /
//     链接（符号链接、Windows 重解析点）的目录、或指向进程工作目录及其上级时 panic 使启动失败；
//     Windows 系统垃圾文件（Thumbs.db / desktop.ini）在判定最前面放行，避免误伤导致服务无法启动。
//     本文件此前把「误配置即静默暴露」表征化为断言（旧 TestFrontendStaticExposureServes…/
//     RejectsRootLevelDotfiles），按该文件自身约定，本次收紧已**显式改写**这些断言为 fail-fast 断言。
//  2. BE-R2 入口缓存语义：SPA 回退的 index.html 带内容 ETag 与 no-cache, must-revalidate，且不再输出
//     Last-Modified ⇒ 部署保留 mtime 时也不会返回陈旧 304；其余静态资源的缓存头语义不变。
//
// 装配方式复用 server_test.go 的 testDependencies 夹具。登记：backend/AUDIT.md C 区 BE-R1/BE-R2 与 §25.2 / §32.1。
const (
	// 仅用于行为表征的假值，不包含任何真实凭据。
	testExposureConfigContent = "jwtSecret: TEST-ONLY\ncredentialEncryptionKey: TEST-ONLY\n"
	testExposureDotEnvContent = "JWT_SECRET=TEST-ONLY\n"
	testExposureDBContent     = "TEST-ONLY-SQLITE-BYTES"
	testExposureIndexContent  = "<html>app</html>"
	// testExposureSensitiveReason 是启动失败信息里必须出现的固定前缀（frontend.go 的 panic 文本）。
	testExposureSensitiveReason = "frontend.staticPath 不安全"
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
// 静态根不安全时 New 会 panic（启动期 fail-fast），需要断言该行为请用 staticExposureRouterPanic。
func staticExposureRouter(t *testing.T, root string) *gin.Engine {
	t.Helper()
	deps := testDependencies()
	deps.Logger = slog.Default()
	deps.FrontendStaticPath = root
	return New(deps)
}

// staticExposureRouterPanic 装配路由并捕获启动期 panic，返回 panic 文本；未 panic 时返回空串。
func staticExposureRouterPanic(t *testing.T, staticPath string) string {
	t.Helper()
	message := ""
	func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				message = fmt.Sprint(recovered)
			}
		}()
		staticExposureRouter(t, staticPath)
	}()
	return message
}

// staticExposureRequest 对已装配路由发起一次真实请求，返回原始 recorder（需要读响应头或非 GET 方法时使用）。
func staticExposureRequest(router *gin.Engine, method, requestPath string) *httptest.ResponseRecorder {
	return staticExposureRequestWithHeaders(router, method, requestPath, nil)
}

// staticExposureRequestWithHeaders 在 staticExposureRequest 之上附加请求头（条件请求用）。
func staticExposureRequestWithHeaders(router *gin.Engine, method, requestPath string, headers map[string]string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, requestPath, nil)
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

// staticExposureGet 对已装配路由发起一次真实 GET，返回状态码与响应体。
func staticExposureGet(router *gin.Engine, requestPath string) (int, string) {
	recorder := staticExposureRequest(router, http.MethodGet, requestPath)
	return recorder.Code, recorder.Body.String()
}

// TestFrontendStaticRootFailFastOnSensitiveEntries 固定 BE-R1 的 fail-fast 判定（frontend.go:26-45 的名单与后缀表，
// 判定入口 isDeniedStaticRootName:47-72，扫描 staticRootExposureViolation:154-196）：静态根内（含子目录）出现
// 服务端秘密、本地秘密载体（config.*.yaml / .env*）、数据库或可执行文件即拒绝启动，
// 断言 panic 文本里同时出现固定前缀与命中的具体条目，避免「任意 panic 都算通过」的空转断言。
// 大小写别名（CONFIG.YAML）在大小写不敏感卷上由文件系统归一化，判定必须落到同一结果。
// 末行「安全产物根」是正对照：同一装配路径下不含敏感条目、且工作目录不在根内时必须正常启动并托管资源，
// 证明 fail-fast 不是对所有静态根一律失败。
func TestFrontendStaticRootFailFastOnSensitiveEntries(t *testing.T) {
	for _, test := range []struct {
		name       string
		files      map[string]string
		wantReason string
	}{
		{
			name:       "根级 config.yaml",
			files:      map[string]string{"index.html": testExposureIndexContent, "config.yaml": testExposureConfigContent},
			wantReason: "含敏感条目 config.yaml",
		},
		{
			name:       "子目录 config.yaml",
			files:      map[string]string{"index.html": testExposureIndexContent, "deploy/config.yaml": testExposureConfigContent},
			wantReason: "含敏感条目 deploy/config.yaml",
		},
		{
			name:       "根级 .env",
			files:      map[string]string{"index.html": testExposureIndexContent, ".env": testExposureDotEnvContent},
			wantReason: "含敏感条目 .env",
		},
		{
			name:       "子目录 .env",
			files:      map[string]string{"index.html": testExposureIndexContent, "data/.env": testExposureDotEnvContent},
			wantReason: "含敏感条目 data/.env",
		},
		{
			name:       "版本库元数据 .git",
			files:      map[string]string{"index.html": testExposureIndexContent, ".git/HEAD": "ref: refs/heads/main\n"},
			wantReason: "含敏感条目 .git",
		},
		{
			name:       "SQLite 数据库",
			files:      map[string]string{"index.html": testExposureIndexContent, "data/backend.db": testExposureDBContent},
			wantReason: "含敏感条目 data/backend.db",
		},
		{
			name:       "SQLite WAL",
			files:      map[string]string{"index.html": testExposureIndexContent, "data/backend.db-wal": testExposureDBContent},
			wantReason: "含敏感条目 data/backend.db-wal",
		},
		{
			// .sqlite3 家族的 WAL/SHM 变体：后缀比对前先剥掉 -wal / -shm，
			// 否则 app.sqlite3-wal 不命中任何后缀，会被当普通静态文件 200 返回。
			name:       "SQLite3 WAL",
			files:      map[string]string{"index.html": testExposureIndexContent, "data/app.sqlite3-wal": testExposureDBContent},
			wantReason: "含敏感条目 data/app.sqlite3-wal",
		},
		{
			name:       "SQLite3 SHM",
			files:      map[string]string{"index.html": testExposureIndexContent, "data/app.sqlite3-shm": testExposureDBContent},
			wantReason: "含敏感条目 data/app.sqlite3-shm",
		},
		{
			name:       "可执行文件",
			files:      map[string]string{"index.html": testExposureIndexContent, "grok2api.exe": "MZ"},
			wantReason: "含敏感条目 grok2api.exe",
		},
		{
			name:       "大小写别名 CONFIG.YAML",
			files:      map[string]string{"index.html": testExposureIndexContent, "CONFIG.YAML": testExposureConfigContent},
			wantReason: "含敏感条目 CONFIG.YAML",
		},
		{
			// .gitignore 登记的本地秘密载体：config.local.yaml 不是点文件，请求期的 isHiddenArtifact
			// 不拦（放行即 200 返回原文），只有启动期拒绝才封住这条可达泄漏路径。
			name:       "本地秘密 config.local.yaml",
			files:      map[string]string{"index.html": testExposureIndexContent, "config.local.yaml": testExposureConfigContent},
			wantReason: "含敏感条目 config.local.yaml",
		},
		{
			name:       "子目录 config.prod.local.yaml",
			files:      map[string]string{"index.html": testExposureIndexContent, "deploy/config.prod.local.yaml": testExposureConfigContent},
			wantReason: "含敏感条目 deploy/config.prod.local.yaml",
		},
		{
			name:       "本地秘密 .env.local",
			files:      map[string]string{"index.html": testExposureIndexContent, ".env.local": testExposureDotEnvContent},
			wantReason: "含敏感条目 .env.local",
		},
		{
			// 大小写别名同样必须命中：模式判定在 ToLower 之后进行，Linux 的大小写敏感卷上也要拦下。
			name:       "大小写别名 CONFIG.LOCAL.YAML",
			files:      map[string]string{"index.html": testExposureIndexContent, "CONFIG.LOCAL.YAML": testExposureConfigContent},
			wantReason: "含敏感条目 CONFIG.LOCAL.YAML",
		},
		{
			name: "安全产物根（正对照）",
			files: map[string]string{
				"index.html":           testExposureIndexContent,
				"assets/app.js":        "console.log('app')",
				"runtime-config.js":    "window.runtimeConfig = {}",
				".build-manifest.json": `{"version":1}`,
				// 模式判定的边界对照：config. 开头但非 .yaml/.yml（config.json）、
				// 以及含 config. 但不以其开头的名字，都必须照常托管，证明判定没有过度拦截。
				"config.json":         "{}",
				"myconfig.local.yaml": "name: demo",
			},
			wantReason: "",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := newStaticRoot(t, test.files)
			message := staticExposureRouterPanic(t, root)
			if test.wantReason == "" {
				if message != "" {
					t.Fatalf("安全静态根 %s 触发了启动失败: %q", root, message)
				}
				status, body := staticExposureGet(staticExposureRouter(t, root), "/assets/app.js")
				if status != http.StatusOK || !strings.Contains(body, "console.log") {
					t.Fatalf("安全静态根 /assets/app.js status = %d body = %q, want %d 且含文件原文", status, body, http.StatusOK)
				}
				return
			}
			if message == "" {
				t.Fatalf("静态根 %s 命中 %q 却未在启动期 fail-fast（BE-R1 未生效）", root, test.wantReason)
			}
			if !strings.Contains(message, testExposureSensitiveReason) || !strings.Contains(message, test.wantReason) {
				t.Fatalf("启动失败信息 = %q, want 同时含 %q 与 %q", message, testExposureSensitiveReason, test.wantReason)
			}
		})
	}
}

// linkStaticRootDir 在 linkPath 处创建指向 target 的目录链接。
// 优先 os.Symlink；Windows 上创建符号链接需要 SeCreateSymbolicLinkPrivilege（开发者模式或管理员），
// 权限不足时退回 junction（cmd 的 mklink /J 不需要该特权）：二者同为重解析点，同样被请求期的
// os.Stat 与 http.Dir 跟随、同样不被 filepath.WalkDir 进入，故对 BE-R1 的启动期扫描是等价的绕过形态。
// 该回退让本用例在 Windows 与 Linux 上都有判别力，不产生跳过。
func linkStaticRootDir(t *testing.T, target, linkPath string) {
	t.Helper()
	symlinkErr := os.Symlink(target, linkPath)
	if symlinkErr == nil {
		return
	}
	if runtime.GOOS != "windows" {
		t.Fatalf("创建符号链接 %s -> %s 失败: %v", linkPath, target, symlinkErr)
	}
	output, err := exec.Command("cmd", "/c", "mklink", "/J", linkPath, target).CombinedOutput()
	if err != nil {
		t.Fatalf("创建 junction %s -> %s 失败: %v（os.Symlink 失败原因: %v，输出: %s）", linkPath, target, err, symlinkErr, output)
	}
}

// TestFrontendStaticRootFailFastOnLinkedEntry 固定链接条目的 fail-closed 判定（frontend.go:178-185）：
// filepath.WalkDir 不进入符号链接（Windows 上 junction 等重解析点被报告为 fs.ModeIrregular，同样不进入），
// 而请求期的 os.Stat 与 http.Dir 会跟随它们。形态：dist/media -> <含 backend.db 的目录> 时扫描只看到
// 条目 media（不命中任何名单），若不拒绝启动，GET /media/backend.db 会 200 返回数据库。
func TestFrontendStaticRootFailFastOnLinkedEntry(t *testing.T) {
	base := t.TempDir()
	secrets := filepath.Join(base, "data")
	writeStaticRootFiles(t, secrets, map[string]string{"backend.db": testExposureDBContent})
	root := filepath.Join(base, "dist")
	writeStaticRootFiles(t, root, map[string]string{"index.html": testExposureIndexContent})
	linkPath := filepath.Join(root, "media")
	linkStaticRootDir(t, secrets, linkPath)

	// 夹具自证：链接在请求期确实被跟随（frontendFile 用 os.Stat，命中普通文件 backend.db），
	// 否则本用例会因链接未生效而空转。
	target := filepath.Join(linkPath, "backend.db")
	followed, err := os.Stat(target)
	if err != nil || !followed.Mode().IsRegular() {
		t.Fatalf("夹具无效：链接 %s 未被跟随（os.Stat(%s) = %v, %v），本用例会空转", linkPath, target, followed, err)
	}

	message := staticExposureRouterPanic(t, root)
	if message == "" {
		t.Fatalf("静态根 %s 内含指向 %s 的链接却未在启动期 fail-fast：链接目标里的 backend.db 会经 GET /media/backend.db 被当静态资源读出去", root, secrets)
	}
	for _, want := range []string{testExposureSensitiveReason, "含符号链接 media", "启动期不跟随符号链接"} {
		if !strings.Contains(message, want) {
			t.Fatalf("启动失败信息 = %q, want 含 %q", message, want)
		}
	}
}

// TestFrontendStaticRootAllowsWindowsShellArtifacts 固定放行名单（frontend.go:33-40）：Thumbs.db 是 Windows
// 资源管理器在含图片的目录里自动生成的系统垃圾文件（frontend/dist 含 frontend/public/sponner/* 的图片，
// `pnpm build` 会把它一并拷进产物根），而它命中 .db 后缀。若不放行，服务在 Windows 上会拒绝启动（启动 DoS）。
// 两个文件都断言被托管，避免「文件没写进夹具」造成的空转断言。
func TestFrontendStaticRootAllowsWindowsShellArtifacts(t *testing.T) {
	root := newStaticRoot(t, map[string]string{
		"index.html":       testExposureIndexContent,
		"Thumbs.db":        "TEST-ONLY-THUMB-CACHE",
		"desktop.ini":      "[.ShellClassInfo]",
		"sponner/logo.svg": "<svg/>",
	})
	if message := staticExposureRouterPanic(t, root); message != "" {
		t.Fatalf("含 Windows 系统垃圾文件的产物根被拒绝启动（Thumbs.db 命中 .db 后缀）: %q", message)
	}
	router := staticExposureRouter(t, root)
	for _, test := range []struct {
		path    string
		content string
	}{
		{path: "/Thumbs.db", content: "TEST-ONLY-THUMB-CACHE"},
		{path: "/desktop.ini", content: ".ShellClassInfo"},
	} {
		t.Run(test.path, func(t *testing.T) {
			status, body := staticExposureGet(router, test.path)
			if status != http.StatusOK || !strings.Contains(body, test.content) {
				t.Fatalf("%s status = %d body = %q, want %d 且含文件原文", test.path, status, body, http.StatusOK)
			}
		})
	}
}

// TestFrontendStaticRootFailFastWhenCoveringWorkingDirectory 固定「staticPath 指向工作目录或其上级」形态的 fail-fast
// （frontend.go:198-211 用 filepath.Rel(root, cwd) + isRelativePathWithinRoot 判定 cwd 是否落在静态根内，含相等）。
// 这是 BE-R1 记录的 `staticPath: "."` / `".."` 误配置；对照组证明工作目录在静态根之外时不会失败（不引入假阳性）。
func TestFrontendStaticRootFailFastWhenCoveringWorkingDirectory(t *testing.T) {
	base := t.TempDir()
	writeStaticRootFiles(t, base, map[string]string{"index.html": testExposureIndexContent})
	dist := filepath.Join(base, "dist")
	writeStaticRootFiles(t, dist, map[string]string{"index.html": testExposureIndexContent})
	nested := filepath.Join(base, "nested")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatalf("创建嵌套目录失败: %v", err)
	}
	for _, test := range []struct {
		name       string
		staticPath string
		workDir    string
		wantReason string
	}{
		{name: "staticPath 等于工作目录", staticPath: base, workDir: base, wantReason: "静态根覆盖进程工作目录"},
		{name: "staticPath 是工作目录的上级", staticPath: base, workDir: nested, wantReason: "静态根覆盖进程工作目录"},
		{name: "工作目录在静态根之外（对照组）", staticPath: dist, workDir: base, wantReason: ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Chdir(test.workDir)
			message := staticExposureRouterPanic(t, test.staticPath)
			if test.wantReason == "" {
				if message != "" {
					t.Fatalf("工作目录 %s 不在静态根 %s 内却 fail-fast: %q", test.workDir, test.staticPath, message)
				}
				return
			}
			if !strings.Contains(message, test.wantReason) {
				t.Fatalf("staticPath=%s workDir=%s 启动失败信息 = %q, want 含 %q", test.staticPath, test.workDir, message, test.wantReason)
			}
		})
	}
}

// TestFrontendStaticExposureNotRegisteredWithoutIndexHTML 固定 fail-fast 的作用域（frontend.go:78-85）：
// 校验只在 frontendRoot(:213-232) 成功后执行，即「不注册静态托管」的形态（缺 index.html）不失败、也不暴露。
// 判别力来自带扩展名的路径（/config.yaml、/data/backend.db）：注册后会返回 200 文件原文，未注册才是 404；
// `/dashboard` 子例只作为 SPA 回退路径的负向对照保留（两种情形下都是 404）。
func TestFrontendStaticExposureNotRegisteredWithoutIndexHTML(t *testing.T) {
	root := newStaticRoot(t, map[string]string{
		"config.yaml":     testExposureConfigContent,
		"data/backend.db": testExposureDBContent,
	})
	if message := staticExposureRouterPanic(t, root); message != "" {
		t.Fatalf("缺少 index.html 时不应注册静态托管，却启动失败: %q", message)
	}
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
				t.Fatalf("%s status = %d, want %d（frontendFile:234-249 的 filepath.Rel 防护失效）", requestPath, status, http.StatusNotFound)
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

// TestFrontendFileRejectsResolvedPathsOutsideRoot 直接固定 frontendFile 的 root 边界（frontend.go:234-249）。
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

// TestFrontendStaticCacheControlValues 固定缓存头的**精确取值**（frontend.go:98-102 与 serveIndexHTML:119-136）：
// 哈希资源 /assets/** ⇒ "public, max-age=31536000, immutable"；其余命中静态文件 ⇒ "no-cache"；
// SPA 回退的 index.html ⇒ "no-cache, must-revalidate"（BE-R2 新增取值，必须与 ETag 一起生效）。
// 断言完整字符串而非前缀：任何取值变化（例如把 index.html 改回 "no-cache" 或改为 no-store）必须显式修改本断言。
func TestFrontendStaticCacheControlValues(t *testing.T) {
	root := newStaticRoot(t, map[string]string{
		"index.html":        testExposureIndexContent,
		"assets/app.js":     "console.log('app')",
		"favicon.ico":       "TEST-ONLY-ICON",
		"runtime-config.js": "window.runtimeConfig = {}",
		"sponner/logo.svg":  "<svg/>",
	})
	router := staticExposureRouter(t, root)
	for _, test := range []struct {
		path string
		want string
	}{
		{path: "/assets/app.js", want: "public, max-age=31536000, immutable"},
		{path: "/favicon.ico", want: "no-cache"},
		{path: "/runtime-config.js", want: "no-cache"},
		{path: "/sponner/logo.svg", want: "no-cache"},
		{path: "/dashboard", want: "no-cache, must-revalidate"},
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

// TestFrontendStaticExposureMethodDimension 固定方法维度（frontend.go:89-92）：NoRoute 只处理 GET/HEAD，
// 其余方法一律 404 且不进入静态文件解析。
// HEAD /runtime-config.js 与 GET 走同一条解析链（200 + 空体，Cache-Control 与 GET 相同）；
// POST /runtime-config.js 由 `c.Status(http.StatusNotFound)` 直接结束 ⇒ 404、空体（实测行为，非 gin 默认 404 文本）。
func TestFrontendStaticExposureMethodDimension(t *testing.T) {
	root := newStaticRoot(t, map[string]string{
		"index.html":        testExposureIndexContent,
		"runtime-config.js": "window.runtimeConfig = {}",
	})
	router := staticExposureRouter(t, root)

	get := staticExposureRequest(router, http.MethodGet, "/runtime-config.js")
	if get.Code != http.StatusOK {
		t.Fatalf("GET /runtime-config.js status = %d, want %d（对照组无效，下面的 HEAD 断言会空转）", get.Code, http.StatusOK)
	}

	head := staticExposureRequest(router, http.MethodHead, "/runtime-config.js")
	if head.Code != http.StatusOK {
		t.Fatalf("HEAD /runtime-config.js status = %d, want %d（HEAD 应与 GET 同样命中静态文件）", head.Code, http.StatusOK)
	}
	if head.Body.Len() != 0 {
		t.Fatalf("HEAD /runtime-config.js body = %q, want 空体", head.Body.String())
	}
	// 注释声称「HEAD 的 Cache-Control 与 GET 相同」，这里把该声称固定成断言：
	// 两者走同一分支（非 /assets/ ⇒ no-cache），HEAD 也必须带这个响应头。
	if headCacheControl, getCacheControl := head.Header().Get("Cache-Control"), get.Header().Get("Cache-Control"); headCacheControl != getCacheControl || headCacheControl != "no-cache" {
		t.Fatalf("HEAD /runtime-config.js Cache-Control = %q, GET = %q, want 均为 %q", headCacheControl, getCacheControl, "no-cache")
	}

	post := staticExposureRequest(router, http.MethodPost, "/runtime-config.js")
	if post.Code != http.StatusNotFound {
		t.Fatalf("POST /runtime-config.js status = %d, want %d（非 GET/HEAD 不应进入静态托管）", post.Code, http.StatusNotFound)
	}
	if strings.Contains(post.Body.String(), "runtimeConfig") {
		t.Fatalf("POST /runtime-config.js body = %q，非 GET/HEAD 请求泄漏了静态文件内容", post.Body.String())
	}
}

// TestFrontendStaticExposureRootFailureMatrix 参数化 frontendRoot(frontend.go:213-232) 的失败矩阵：
// staticPath 为空、目录不存在、路径是普通文件、index.html 是目录 —— 四种形态下静态托管整体不注册、
// 启动期安全校验不执行（不失败），敏感文件请求落到 gin 默认 404。
// 「index.html 是目录」的子夹具内含 config.yaml，正是用来证明校验的作用域：frontendRoot 失败 ⇒ 校验不触发。
// 末段对照组用同一夹具下的正常根，证明上面的 404 来自 frontendRoot 失败而不是夹具写错（避免空转断言）。
func TestFrontendStaticExposureRootFailureMatrix(t *testing.T) {
	base := t.TempDir()
	plainFile := filepath.Join(base, "not-a-directory.txt")
	writeStaticRootFiles(t, base, map[string]string{
		"not-a-directory.txt":        testExposureConfigContent,
		"index-is-a-dir/config.yaml": testExposureConfigContent,
		"dist/index.html":            testExposureIndexContent,
		"dist/runtime-config.js":     "window.runtimeConfig = {}",
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
			if message := staticExposureRouterPanic(t, test.staticPath); message != "" {
				t.Fatalf("静态根形态 %q 未注册静态托管，却启动失败: %q", test.staticPath, message)
			}
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
	status, body := staticExposureGet(control, "/runtime-config.js")
	if status != http.StatusOK || !strings.Contains(body, "runtimeConfig") {
		t.Fatalf("对照组 dist/runtime-config.js status = %d body = %q, want %d 且含文件原文", status, body, http.StatusOK)
	}
}

// TestFrontendSPAFallbackIndexCacheHeaders 固定 BE-R2：SPA 回退的 index.html 必须带
// Cache-Control: no-cache, must-revalidate 与内容 ETag，且**不输出 Last-Modified**。
// 不输出 Last-Modified 是消除「保留 mtime ⇒ 陈旧 304」的关键：http.ServeContent 收到零 mtime 后
// 既不写 Last-Modified，也忽略 If-Modified-Since，条件判定只剩 ETag（判别力见下一个用例）。
func TestFrontendSPAFallbackIndexCacheHeaders(t *testing.T) {
	root := newStaticRoot(t, map[string]string{"index.html": testExposureIndexContent})
	router := staticExposureRouter(t, root)
	etags := make(map[string]string)
	for _, requestPath := range []string{"/", "/dashboard", "/settings/profile"} {
		t.Run(requestPath, func(t *testing.T) {
			recorder := staticExposureRequest(router, http.MethodGet, requestPath)
			if recorder.Code != http.StatusOK {
				t.Fatalf("%s status = %d, want %d", requestPath, recorder.Code, http.StatusOK)
			}
			if !strings.Contains(recorder.Body.String(), "app") {
				t.Fatalf("%s body = %q, want 含 index.html 原文", requestPath, recorder.Body.String())
			}
			if got := recorder.Header().Get("Cache-Control"); got != "no-cache, must-revalidate" {
				t.Fatalf("%s Cache-Control = %q, want %q", requestPath, got, "no-cache, must-revalidate")
			}
			if got := recorder.Header().Get("Last-Modified"); got != "" {
				t.Fatalf("%s Last-Modified = %q, want 空（保留 mtime 的部署会因此得到陈旧 304）", requestPath, got)
			}
			etag := recorder.Header().Get("Etag")
			if len(etag) < 10 || !strings.HasPrefix(etag, `"`) || !strings.HasSuffix(etag, `"`) {
				t.Fatalf("%s Etag = %q, want 带双引号的非空强校验值", requestPath, etag)
			}
			etags[requestPath] = etag
		})
	}
	for requestPath, etag := range etags {
		if etag != etags["/"] {
			t.Fatalf("%s Etag = %q, want 与 / 的 %q 相同（同一文件内容必须得到同一 ETag）", requestPath, etag, etags["/"])
		}
	}
}

// TestFrontendSPAFallbackIndexETagRejectsStaleContent 固定 BE-R2 的核心行为：内容变更但 mtime 被保留时，
// 既不能用旧 ETag 得到 304，也不能用 If-Modified-Since 得到 304。
// 夹具自证：改内容后把 mtime 复位成原值，并断言 mtime 确实未变，否则本用例退化成「内容与 mtime 都变了」的普通场景。
// 中间用例（内容未变 + 匹配 ETag ⇒ 304）证明这不是「一律 200」：缓存复验仍然有效。
func TestFrontendSPAFallbackIndexETagRejectsStaleContent(t *testing.T) {
	root := newStaticRoot(t, map[string]string{"index.html": "<html>v1</html>"})
	indexPath := filepath.Join(root, "index.html")
	router := staticExposureRouter(t, root)

	first := staticExposureRequest(router, http.MethodGet, "/dashboard")
	if first.Code != http.StatusOK || !strings.Contains(first.Body.String(), "v1") {
		t.Fatalf("首次 GET /dashboard status = %d body = %q, want %d 且 v1", first.Code, first.Body.String(), http.StatusOK)
	}
	etag := first.Header().Get("Etag")
	if etag == "" {
		t.Fatalf("首次响应无 ETag，无法验证 BE-R2 的复验语义")
	}

	revalidated := staticExposureRequestWithHeaders(router, http.MethodGet, "/dashboard", map[string]string{"If-None-Match": etag})
	if revalidated.Code != http.StatusNotModified || revalidated.Body.Len() != 0 {
		t.Fatalf("内容未变 + 匹配 ETag：status = %d body = %q, want %d 且空体", revalidated.Code, revalidated.Body.String(), http.StatusNotModified)
	}

	originalInfo, err := os.Stat(indexPath)
	if err != nil {
		t.Fatalf("读取 index.html 信息失败: %v", err)
	}
	originalModTime := originalInfo.ModTime()
	if err := os.WriteFile(indexPath, []byte("<html>v2</html>"), 0o600); err != nil {
		t.Fatalf("改写 index.html 失败: %v", err)
	}
	if err := os.Chtimes(indexPath, originalModTime, originalModTime); err != nil {
		t.Fatalf("复位 mtime 失败: %v", err)
	}
	updatedInfo, err := os.Stat(indexPath)
	if err != nil {
		t.Fatalf("重新读取 index.html 信息失败: %v", err)
	}
	if !updatedInfo.ModTime().Equal(originalModTime) {
		t.Fatalf("夹具无效：mtime 由 %v 变为 %v，未保留 mtime", originalModTime, updatedInfo.ModTime())
	}

	changed := staticExposureRequestWithHeaders(router, http.MethodGet, "/dashboard", map[string]string{"If-None-Match": etag})
	if changed.Code != http.StatusOK || !strings.Contains(changed.Body.String(), "v2") {
		t.Fatalf("内容变更且保留 mtime：status = %d body = %q, want %d 且 v2（陈旧 304 未消除）", changed.Code, changed.Body.String(), http.StatusOK)
	}
	if got := changed.Header().Get("Etag"); got == etag {
		t.Fatalf("内容变更后 Etag = %q 未变，ETag 未随内容变化", got)
	}

	stale := staticExposureRequestWithHeaders(router, http.MethodGet, "/dashboard", map[string]string{
		"If-Modified-Since": originalModTime.Add(time.Hour).UTC().Format(http.TimeFormat),
	})
	if stale.Code != http.StatusOK || !strings.Contains(stale.Body.String(), "v2") {
		t.Fatalf("仅带 If-Modified-Since 且晚于保留的 mtime：status = %d body = %q, want %d 且 v2（index.html 仍在输出 Last-Modified 语义）", stale.Code, stale.Body.String(), http.StatusOK)
	}
}

// TestFrontendSPAFallbackRejectsDotDotPathElement 固定 SPA 回退的 ".." 拒绝语义（frontend.go:138-152）：
// 改用 http.ServeContent + 零 mtime 后不再经过 net/http.ServeFile，必须自行保留其 containsDotDot 判定，
// 否则 GET /../dashboard 会由 400 变成 200。带扩展名的路径仍由 path.Ext 分支先返回 404（顺序不变）。
// 负向对照 /a..b/c 证明判定按「路径元素」而非「包含两个点」：它不是越界元素，必须落到 index.html。
func TestFrontendSPAFallbackRejectsDotDotPathElement(t *testing.T) {
	root := newStaticRoot(t, map[string]string{"index.html": testExposureIndexContent})
	router := staticExposureRouter(t, root)
	for _, test := range []struct {
		path   string
		status int
		body   string
	}{
		{path: "/../dashboard", status: http.StatusBadRequest},
		// `/..\dashboard` 到不了本分支：path.Ext 按 "/" 切分后的末段是 "..\dashboard"、扩展名非空，
		// 先由 path.Ext 分支返回 404（改动前后一致），故这里固定 404 而不是 400。
		{path: "/..\\dashboard", status: http.StatusNotFound},
		{path: "/../missing.js", status: http.StatusNotFound},
		{path: "/a..b/c", status: http.StatusOK, body: "app"},
		{path: "/dashboard", status: http.StatusOK, body: "app"},
	} {
		t.Run(test.path, func(t *testing.T) {
			status, body := staticExposureGet(router, test.path)
			if status != test.status {
				t.Fatalf("%s status = %d, want %d", test.path, status, test.status)
			}
			if test.body != "" && !strings.Contains(body, test.body) {
				t.Fatalf("%s body = %q, want 含 %q", test.path, body, test.body)
			}
		})
	}
}

// TestHasDotDotPathElementMatchesServeFileSemantics 平台无关地固定 hasDotDotPathElement 的判定口径：
// 与 net/http 的 containsDotDot 一致（按 "/" 与 "\" 切分后存在恰好等于 ".." 的元素）。
// 注意：谓词为 true 不等于请求一定得到 400——NoRoute 里 path.Ext 分支先执行，
// 含 "." 的末段（如 `/..\dashboard`）会先返回 404，见 TestFrontendSPAFallbackRejectsDotDotPathElement。
func TestHasDotDotPathElementMatchesServeFileSemantics(t *testing.T) {
	for _, test := range []struct {
		value string
		want  bool
	}{
		{value: "/dashboard", want: false},
		{value: "/", want: false},
		{value: "", want: false},
		{value: "/a..b/c", want: false},
		{value: "/a..", want: false},
		{value: "..", want: true},
		{value: "/../dashboard", want: true},
		{value: "/x/../y", want: true},
		{value: `/..\dashboard`, want: true},
		{value: `/x/..\y`, want: true},
	} {
		if got := hasDotDotPathElement(test.value); got != test.want {
			t.Fatalf("hasDotDotPathElement(%q) = %v, want %v", test.value, got, test.want)
		}
	}
}
