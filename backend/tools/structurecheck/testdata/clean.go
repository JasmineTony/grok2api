// 门禁自测夹具：本文件不含任何越限项，用于证明门禁没有假阳性。
package fixture

// cleanFunction 的最大嵌套为 3 层：for(1) → switch(2) → case 体内的 if(3)。
// case 子句体不额外加层，因此该函数合规。
func cleanFunction() int {
	total := 0
	for i := 0; i < 10; i++ {
		switch i % 2 {
		case 0:
			if i > 5 {
				total += i
			}
		default:
			total -= i
		}
	}
	return total
}

// cleanRangeSelect 的最大嵌套为 3 层：range(1) → select(2) → comm 子句体内的 switch(3)。
func cleanRangeSelect(ch chan int) int {
	total := 0
	for value := range ch {
		select {
		case item := <-ch:
			switch item {
			case 1:
				total += value
			}
		}
	}
	return total
}

// cleanTypeSwitch 的最大嵌套为 3 层：type switch(1) → case 体内的 if(2) → for(3)。
func cleanTypeSwitch(value any) int {
	total := 0
	switch typed := value.(type) {
	case int:
		if typed > 0 {
			for i := 0; i < typed; i++ {
				total += i
			}
		}
	}
	return total
}

// cleanClosure 的函数字面量内部最大嵌套 2 层，证明字面量按独立作用域统计。
func cleanClosure() int {
	run := func() int {
		for i := 0; i < 3; i++ {
			if i > 0 {
				return i
			}
		}
		return 0
	}
	return run()
}

// cleanPackageClosure 是包级函数字面量，内部最大嵌套 3 层：for(1) → if(2) → for(3)，
// 证明包级闭包被纳入统计后不会被无条件判为越限。
var cleanPackageClosure = func() int {
	total := 0
	for i := 0; i < 3; i++ {
		if i > 0 {
			for j := 0; j < 2; j++ {
				total += j
			}
		}
	}
	return total
}
