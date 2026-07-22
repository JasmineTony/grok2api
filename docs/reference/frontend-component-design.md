# 前端组件设计规范

## API 设计

- Props 使用明确类型；布尔值使用 `is/has/can` 或领域名，事件使用 `onXxx`。
- 展示组件不得接收 Query/Mutation 对象，改接收 `loading/error/data/onRetry/onAction` 等稳定接口。
- 可选 props 只在缺省与 `undefined` 语义一致时使用；启用 `exactOptionalPropertyTypes` 后不得显式传递无意义的 `undefined`。
- 复合组件优先通过 children/slot 组合；不得创建包含具体业务 ID、API 路径或权限判断的共享 UI。

## 样式与响应式

- 使用 Tailwind 设计令牌和 `cn`，禁止页面级重复颜色/阴影/间距魔法值。
- 桌面表格与移动卡片使用 `ResponsiveDataView`；宽表必须提供横滚和可见边缘。
- 异步区域使用固定最小尺寸的 `AsyncState`/Skeleton，避免加载后布局跳动。
- Dialog 使用统一 viewport margin、最大高度和内部滚动。
- 保留键盘、focus-visible、Reduced Motion、亮暗主题与高对比语义。

## 性能

- 路由和高成本 Dialog/图表按需加载；首屏只加载完成首个交互所需的 Provider。
- memo 只用于稳定 props 且可测的高成本子树；不得机械包裹所有组件。
- schema、formatter、排序和 JSON 序列化不得在无关 render 中重复创建。
- 新增依赖必须通过 bundle/chunk 预算和循环检查。

## 测试

- 基础 UI 测可访问名称、键盘行为和状态；展示组件测 view model；容器测请求/取消/错误；页面 E2E 测用户流程。
- 测试数据用 factory/fixture，mock 在每个测试后恢复，不共享可变数据。
