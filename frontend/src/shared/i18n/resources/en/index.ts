import common from "./common";
import webAccounts from "./web-accounts";
import accounts from "./accounts";
import accountCredentials from "./account-credentials";
import dashboard from "./dashboard";
import creativeConsole from "./creative-console";
import auth from "./auth";
import qualityGuard from "./quality-guard";
import models from "./models";
import clientKeys from "./client-keys";
import audits from "./audits";
import settings from "./settings";
import egress from "./egress";
import docs from "./docs";
import apiErrors from "./api-errors";

/**
 * en 文案：按领域模块组装为 i18next 的 translation 命名空间集合。
 */
export default {
  translation: {
    ...common,
    ...webAccounts,
    ...accounts,
    ...accountCredentials,
    ...dashboard,
    ...creativeConsole,
    ...auth,
    ...qualityGuard,
    ...models,
    ...clientKeys,
    ...audits,
    ...settings,
    ...egress,
    ...docs,
    ...apiErrors,
  },
};
