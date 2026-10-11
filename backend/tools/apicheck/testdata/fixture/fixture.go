// Package fixture 是 apicheck 的文件级测试夹具（AGENTS.md §10 EVID-3 的负样本来源）。
//
// 目录名 testdata 使 Go 工具链（go build/vet/test ./...）与 apicheck 自身的
// isProductionGoFile 都忽略它，因此它不会进入真实基线 backend/api-baseline.txt。
// 夹具故意只含 1 个导出常量、1 个导出类型、1 个导出函数：三类导出面各自都能被
// 测试复制到临时目录后改写，用来验证门禁对新增/删除/签名变化的判别力。
package fixture

// DefaultLimit 是夹具中的导出常量。
const DefaultLimit = 42

// Config 是夹具中的导出类型。
type Config struct {
	Enabled bool
}

// Describe 是夹具中的导出函数。
func Describe(value int) (string, error) { return "", nil }
