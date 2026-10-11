import webAccountsZhCN from "./zh-CN/web-accounts";
import accountsZhCN from "./zh-CN/accounts";
import accountCredentialsZhCN from "./zh-CN/account-credentials";
import dashboardZhCN from "./zh-CN/dashboard";
import creativeConsoleZhCN from "./zh-CN/creative-console";
import qualityGuardZhCN from "./zh-CN/quality-guard";
import modelsZhCN from "./zh-CN/models";
import clientKeysZhCN from "./zh-CN/client-keys";
import auditsZhCN from "./zh-CN/audits";
import settingsZhCN from "./zh-CN/settings";
import egressZhCN from "./zh-CN/egress";
import docsZhCN from "./zh-CN/docs";
import webAccountsEn from "./en/web-accounts";
import accountsEn from "./en/accounts";
import accountCredentialsEn from "./en/account-credentials";
import dashboardEn from "./en/dashboard";
import creativeConsoleEn from "./en/creative-console";
import qualityGuardEn from "./en/quality-guard";
import modelsEn from "./en/models";
import clientKeysEn from "./en/client-keys";
import auditsEn from "./en/audits";
import settingsEn from "./en/settings";
import egressEn from "./en/egress";
import docsEn from "./en/docs";

/**
 * 非首屏文案（不进入首屏关键 JS 依赖闭包，独立成一个懒加载 chunk）。
 *
 * 12 个领域都没有被首屏模块引用，只有懒加载页面会用到；由
 * `loadDeferredResources()` 在 `app/deferred-pages.tsx` 解析任何页面模块**之前**补入。
 * 领域展开顺序与拆分前 `zh-CN/index.ts`、`en/index.ts` 保持一致。
 */
export default {
  "zh-CN": {
    translation: {
      ...webAccountsZhCN,
      ...accountsZhCN,
      ...accountCredentialsZhCN,
      ...dashboardZhCN,
      ...creativeConsoleZhCN,
      ...qualityGuardZhCN,
      ...modelsZhCN,
      ...clientKeysZhCN,
      ...auditsZhCN,
      ...settingsZhCN,
      ...egressZhCN,
      ...docsZhCN,
    },
  },
  en: {
    translation: {
      ...webAccountsEn,
      ...accountsEn,
      ...accountCredentialsEn,
      ...dashboardEn,
      ...creativeConsoleEn,
      ...qualityGuardEn,
      ...modelsEn,
      ...clientKeysEn,
      ...auditsEn,
      ...settingsEn,
      ...egressEn,
      ...docsEn,
    },
  },
};
