package httpserver

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// staticRootScanEntryBudget 是启动期静态根扫描的条目上限：超过即拒绝启动（fail-closed），
// 避免 staticPath 误配置指向超大目录时把校验退化成不可控的启动开销。
const staticRootScanEntryBudget = 20000

// staticRootDeniedNames 是静态产物根内不允许出现的条目名（小写精确比较）。
// 只收「不可能合法出现在前端构建产物里」的服务端秘密与版本库元数据：名单越窄越安全，
// 误伤合法产物会让服务无法启动，而 BE-R1 的 fail-fast 完全依赖这份名单与 isDeniedStaticRootName 的模式、后缀判定。
var staticRootDeniedNames = map[string]struct{}{
	".env":        {},
	".git":        {},
	"config.yaml": {},
	"config.yml":  {},
}

// staticRootAllowedNames 是敏感判定的放行名单（小写精确匹配），在 isDeniedStaticRootName 最前面短路放行。
// 收 Windows 资源管理器在含图片目录里自动生成的系统垃圾文件：frontend/dist 含图片（frontend/public/sponner/*），
// `pnpm build` 会把 Thumbs.db 一并拷进产物根，而它命中下面的 .db 后缀。它与服务端秘密无关，
// 误判会让服务在 Windows 上无法启动（启动 DoS），故必须放行；后缀类判定本身不降级为告警。
var staticRootAllowedNames = map[string]struct{}{
	"thumbs.db":   {},
	"desktop.ini": {},
}

// staticRootDeniedSuffixes 是静态产物根内不允许出现的文件名后缀（小写比较）：数据库文件与可执行文件。
// SQLite 的 -wal / -shm 兄弟文件在匹配前先被剥掉（见 isDeniedStaticRootName），
// 故 app.sqlite3-wal 与 app.sqlite3 命中同一项，不必为每个后缀再列两条变体。
var staticRootDeniedSuffixes = []string{".db", ".sqlite", ".sqlite3", ".exe"}

// isDeniedStaticRootName 是静态根条目名的唯一敏感判定入口：放行名单短路，随后是精确名单、
// 本仓库 .gitignore 登记的本地秘密载体模式，最后是后缀表。
// 模式判定针对 config.local.yaml / config.*.local.yaml / .env.local 这类名字：它们不是点文件，
// 请求期的 isHiddenArtifact 不拦（会以 200 返回原文），只有启动期拒绝才能消除这条可达泄漏路径。
func isDeniedStaticRootName(name string) bool {
	name = strings.ToLower(name)
	if _, allowed := staticRootAllowedNames[name]; allowed {
		return false
	}
	if _, denied := staticRootDeniedNames[name]; denied {
		return true
	}
	if strings.HasPrefix(name, "config.") && (strings.HasSuffix(name, ".yaml") || strings.HasSuffix(name, ".yml")) {
		return true
	}
	if strings.HasPrefix(name, ".env") {
		return true
	}
	suffixName := strings.TrimSuffix(strings.TrimSuffix(name, "-wal"), "-shm")
	for _, suffix := range staticRootDeniedSuffixes {
		if strings.HasSuffix(suffixName, suffix) {
			return true
		}
	}
	return false
}

// registerFrontend 在构建产物存在时托管静态文件，并为前端路由提供 SPA 回退。
// 注册前先做启动期安全校验：staticPath 指向含 config.yaml / config.*.yaml / .env* / *.db / *.sqlite3 / .git /
// 可执行文件或链接（符号链接、Windows 重解析点）的目录，或指向进程工作目录及其上级时 panic 使启动失败，
// 而不是把服务端配置与数据库当静态资源读出去（BE-R1）。
func registerFrontend(router *gin.Engine, staticPath string) {
	root, indexPath, ok := frontendRoot(staticPath)
	if !ok {
		return
	}
	if reason := staticRootExposureViolation(root); reason != "" {
		panic("httpserver: frontend.staticPath 不安全（" + reason + "），拒绝把 " + root + " 作为静态根；请指向前端构建产物目录（默认 ./frontend/dist）")
	}
	files := http.FileServer(http.Dir(root))
	router.NoRoute(func(c *gin.Context) {
		requestPath := c.Request.URL.Path
		if (c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead) || isBackendPath(requestPath) {
			c.Status(http.StatusNotFound)
			return
		}
		if filePath, exists := frontendFile(root, requestPath); exists {
			if isHiddenArtifact(filePath) {
				c.Status(http.StatusNotFound)
				return
			}
			if strings.HasPrefix(path.Clean(requestPath), "/assets/") {
				c.Header("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				c.Header("Cache-Control", "no-cache")
			}
			c.Request.URL.Path = "/" + filepath.ToSlash(filePath)
			files.ServeHTTP(c.Writer, c.Request)
			return
		}
		if path.Ext(path.Clean(requestPath)) != "" {
			c.Status(http.StatusNotFound)
			return
		}
		if hasDotDotPathElement(requestPath) {
			c.Status(http.StatusBadRequest)
			return
		}
		serveIndexHTML(c, indexPath)
	})
}

// serveIndexHTML 托管 SPA 入口 index.html（BE-R2）：Cache-Control 要求每次复验，ETag 取自文件内容，
// 且不向 http.ServeContent 传 mtime。这样「部署保留 mtime」时既不会因 If-Modified-Since 得到陈旧 304
// （不设置 Last-Modified，条件判定只看 ETag），也不会因内容已变而 ETag 未变而复用旧 HTML。
// 其余静态资源的缓存语义不经过本函数（frontend.go 的 NoRoute 只对它设值，assets 与普通文件保持原语义）。
func serveIndexHTML(c *gin.Context, indexPath string) {
	content, err := os.ReadFile(indexPath)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, os.ErrNotExist) {
			status = http.StatusNotFound
		}
		c.Status(status)
		return
	}
	c.Header("Cache-Control", "no-cache, must-revalidate")
	c.Header("Etag", fmt.Sprintf("\"%x\"", sha256.Sum256(content)))
	http.ServeContent(c.Writer, c.Request, "index.html", time.Time{}, bytes.NewReader(content))
}

// hasDotDotPathElement 报告 URL 路径是否含 ".." 路径元素（分隔符为 "/" 或 "\"）。
// 口径与 net/http.ServeFile 内部的 containsDotDot 一致：SPA 回退原先经 ServeFile 托管 index.html，
// 改用 http.ServeContent + 零 mtime 后（BE-R2）必须自行保留这条拒绝语义，否则 GET /../dashboard
// 会由 400 变成 200（带扩展名的路径仍由上面的 path.Ext 分支先返回 404，与改动前一致）。
func hasDotDotPathElement(value string) bool {
	if !strings.Contains(value, "..") {
		return false
	}
	for _, element := range strings.FieldsFunc(value, func(r rune) bool { return r == '/' || r == '\\' }) {
		if element == ".." {
			return true
		}
	}
	return false
}

// staticRootExposureViolation 在启动期判定静态根是否可安全托管：返回空串表示通过，
// 否则返回具体的违规原因（调用方据此 panic，不静默降级）。
// 判定分两步：静态根不得覆盖进程工作目录；静态根内（含子目录）不得出现敏感条目或链接
// （扫描不跟随符号链接与 Windows 重解析点，无法确认链接目标不含敏感文件 ⇒ 同样拒绝启动）。
func staticRootExposureViolation(root string) string {
	if reason := workingDirCoverageViolation(root); reason != "" {
		return reason
	}
	visited := 0
	violation := ""
	err := filepath.WalkDir(root, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			violation = "无法读取 " + current + ": " + walkErr.Error()
			return fs.SkipAll
		}
		visited++
		if visited > staticRootScanEntryBudget {
			violation = fmt.Sprintf("目录条目数超过 %d，无法在启动期确认其中不含敏感文件", staticRootScanEntryBudget)
			return fs.SkipAll
		}
		relative, relErr := filepath.Rel(root, current)
		if relErr != nil {
			relative = current
		}
		// 启动期不跟随链接：filepath.WalkDir 用 os.Lstat 语义（不进入符号链接，Windows 上 junction 等
		// 重解析点被报告为 fs.ModeIrregular 且同样不进入），而请求期的 os.Stat 与 http.Dir 会跟随它们。
		// 形态：dist/media -> /app/data 时扫描只看到条目 media（不命中任何名单），GET /media/backend.db
		// 却会 200 返回数据库 ⇒ 只要出现链接就 fail-closed，而不是把它当普通条目放行。
		if mode := entry.Type(); mode&fs.ModeSymlink != 0 || mode&fs.ModeIrregular != 0 {
			violation = "含符号链接 " + filepath.ToSlash(relative) + "：启动期不跟随符号链接，无法确认其目标不含敏感文件"
			return fs.SkipAll
		}
		if isDeniedStaticRootName(entry.Name()) {
			violation = "含敏感条目 " + filepath.ToSlash(relative)
			return fs.SkipAll
		}
		return nil
	})
	if err != nil {
		return "扫描静态根失败: " + err.Error()
	}
	return violation
}

// workingDirCoverageViolation 报告静态根是否覆盖进程工作目录，即 staticPath 被配置为 "." 或其上级目录的形态；
// 该形态会把服务端自身的目录树当作静态资源，是 BE-R1 记录的误配置。
// 不同卷（filepath.Rel 返回错误）时工作目录必然不在 root 内，按未覆盖处理，不引入额外失败面。
func workingDirCoverageViolation(root string) string {
	workingDir, err := os.Getwd()
	if err != nil {
		return ""
	}
	relative, err := filepath.Rel(root, workingDir)
	if err != nil || !isRelativePathWithinRoot(relative) {
		return ""
	}
	return "静态根覆盖进程工作目录 " + workingDir + "（staticPath 指向工作目录或其上级目录）"
}

func frontendRoot(staticPath string) (string, string, bool) {
	staticPath = strings.TrimSpace(staticPath)
	if staticPath == "" {
		return "", "", false
	}
	root, err := filepath.Abs(staticPath)
	if err != nil {
		return "", "", false
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return "", "", false
	}
	indexPath := filepath.Join(root, "index.html")
	indexInfo, err := os.Stat(indexPath)
	if err != nil || !indexInfo.Mode().IsRegular() {
		return "", "", false
	}
	return filepath.Clean(root), indexPath, true
}

func frontendFile(root, requestPath string) (string, bool) {
	cleanPath := strings.TrimPrefix(path.Clean("/"+requestPath), "/")
	if cleanPath == "" || cleanPath == "." {
		return "", false
	}
	fullPath := filepath.Join(root, filepath.FromSlash(cleanPath))
	relative, err := filepath.Rel(root, fullPath)
	if err != nil || !isRelativePathWithinRoot(relative) {
		return "", false
	}
	info, err := os.Stat(fullPath)
	if err != nil || !info.Mode().IsRegular() {
		return "", false
	}
	return relative, true
}

// isRelativePathWithinRoot 报告 filepath.Rel 得到的相对路径是否落在 root 内（frontendFile 的包含性守卫）。
// 逻辑逐字等价于该处原有的内联判定（CHG-2：搬运，仅抽出与命名），抽出原因是这条分支只在含 filepath.Separator
// 的别名路径上触发、Linux 上不可达，单独抽成纯字符串谓词后才能由平台无关的单测直接覆盖。
// 口径：恰好为 ".." 或以 ".."+filepath.Separator 开头才算越界；"..x"、"..foo/bar" 这类以两点开头但不是父目录
// 的名字必须判为 root 内。filepath.Rel 已归一化输出，故 "sub/../file" 这类形态不会出现，此处按非越界处理。
func isRelativePathWithinRoot(relative string) bool {
	return relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func isBackendPath(value string) bool {
	cleanPath := path.Clean("/" + value)
	for _, prefix := range []string{"/api", "/v1", "/swagger"} {
		if cleanPath == prefix || strings.HasPrefix(cleanPath, prefix+"/") {
			return true
		}
	}
	return cleanPath == "/healthz" || cleanPath == "/readyz"
}

// isHiddenArtifact 报告已解析的相对路径是否为产物根目录下的点文件（构建与测试的内部产物，例如 .build-manifest.json）。
// 判定必须基于解析后的相对路径：请求路径中的大小写、反斜杠等别名会由 os.Stat 归一化，只有解析结果才与平台无关。
func isHiddenArtifact(relative string) bool {
	clean := path.Clean("/" + filepath.ToSlash(relative))
	return path.Dir(clean) == "/" && strings.HasPrefix(path.Base(clean), ".")
}
