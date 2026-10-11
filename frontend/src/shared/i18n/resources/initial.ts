import commonZhCN from "./zh-CN/common";
import authZhCN from "./zh-CN/auth";
import apiErrorsZhCN from "./zh-CN/api-errors";
import commonEn from "./en/common";
import authEn from "./en/auth";
import apiErrorsEn from "./en/api-errors";

/**
 * 首屏同步文案（进入首屏关键 JS 依赖闭包）。
 *
 * 只包含首屏闭包内真实使用的 3 个领域：
 *  - common：登录页与 Spinner 等通用文案；
 *  - auth：登录页与 AuthBoundary；
 *  - api-errors：`shared/api/client.ts` 通过 `apiErrors.${code}` **同步**调用
 *    `i18n.exists` / `i18n.t`，异步补入会让错误文案出现回落英文的竞态，故必须保持同步。
 *
 * 其余 12 个领域见 `./deferred`，由 `loadDeferredResources()` 在任何懒加载页面渲染前补入。
 * 领域展开顺序与拆分前 `zh-CN/index.ts`、`en/index.ts` 保持一致。
 */
export default {
  "zh-CN": {
    translation: {
      ...commonZhCN,
      ...authZhCN,
      ...apiErrorsZhCN,
    },
  },
  en: {
    translation: {
      ...commonEn,
      ...authEn,
      ...apiErrorsEn,
    },
  },
};
