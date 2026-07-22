# 前端业务边界

## 依赖方向

```text
app → features → entities → shared
app → entities/shared
features → entities/shared
entities → shared
shared → 浏览器与第三方基础库
```

- `app` 只负责路由、Provider、全局错误边界和页面装配。
- `features/<domain>` 是业务能力边界；跨 feature 协作必须通过公开入口或提升到 entity/shared，禁止读取其他 feature 内部组件。
- `entities` 保存跨页面稳定的领域 DTO、decoder、query key 和 API facade，不依赖 feature。
- `shared` 不得依赖 feature/entity；UI 与组件不得发起业务请求。

## 组件职责

- Route page：只组合容器和路由级状态，不定义复杂 schema、mutation、表格行或 Dialog 业务；不超过 500 行。
- Container：负责 query、mutation、权限、取消、错误与数据映射；不超过 500 行。
- Presentation component：只通过 props 接收 typed view model，输出事件，不读取 API/认证/路由全局状态。
- `shared/components`：跨业务的组合组件，例如表格壳、异步状态、响应式数据视图。
- `components/ui`：Radix/shadcn 基础原语，不依赖业务、网络或 feature 文案。

## 强制约束

- 禁止模块级 `let`/`var` 承载业务运行态；Provider/Hook 内的 ref/state 才能保存会话状态。
- 禁止 feature 直接使用 `fetch` 或 `localStorage`；统一经 `ApiClient` 和 `safe-storage`。
- 禁止 `eval`、`Function` 构造器和前端子进程执行。
- 禁止复制分页、批量选择、错误归一化和成本换算逻辑。
- 不省略 Promise、AbortSignal、错误和空/加载状态处理。
- 环境值来自 runtime config，领域能力来自 API；页面不得创造任意业务上限。
