// 门禁自测夹具：本文件的越限项用于证明 REV-3 会被检出。
package fixture

// deepNesting 的最大嵌套为 4 层：for(1) → if(2) → switch(3) → case 体内的 if(4)。
func deepNesting() int {
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

// elseNesting 证明 else 分支也计入 if 的层级：for(1) → if(2) → else 体内的 if(3) → for(4)。
func elseNesting() int {
	total := 0
	for i := 0; i < 3; i++ {
		if i > 0 {
			total++
		} else {
			if i < 0 {
				for j := 0; j < 2; j++ {
					total--
				}
			}
		}
	}
	return total
}

// closureNesting 的函数体本身没有控制流；它返回的函数字面量内部嵌套 4 层，
// 因此只应以 <closure> 上报一次，证明函数字面量是独立作用域。
func closureNesting() func() int {
	return func() int {
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
}
