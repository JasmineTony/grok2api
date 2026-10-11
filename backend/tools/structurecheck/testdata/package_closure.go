// 门禁自测夹具：包级函数字面量（var 初始化器）内部嵌套 4 层，用于证明包级闭包不被漏报。
package fixture

// deepPackageClosure 的最大嵌套为 4 层：for(1) → if(2) → switch(3) → case 体内的 if(4)。
// 它位于包级 var 的初始化器里，不在任何具名函数体内，因此必须按独立作用域参与 REV-2 / REV-3。
var deepPackageClosure = func() int {
	total := 0
	for i := 0; i < 3; i++ {
		if i > 0 {
			switch i {
			case 1:
				if i > 0 {
					total++
				}
			}
		}
	}
	return total
}
