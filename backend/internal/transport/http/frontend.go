package httpserver

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// registerFrontend 在构建产物存在时托管静态文件，并为前端路由提供 SPA 回退。
func registerFrontend(router *gin.Engine, staticPath string) {
	root, indexPath, ok := frontendRoot(staticPath)
	if !ok {
		return
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
		c.Header("Cache-Control", "no-cache")
		http.ServeFile(c.Writer, c.Request, indexPath)
	})
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
