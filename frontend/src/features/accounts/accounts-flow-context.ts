import type { AccountProvider } from "@/features/accounts/accounts-dto";
import type { Translate } from "@/features/accounts/accounts-view-model";

/** 账号任务流的共享依赖：当前账号池作用域、选择快照与失效/错误出口。 */
export type AccountsFlowContext = {
  t: Translate;
  provider: AccountProvider;
  language: string;
  selectedIds: string[];
  selectedCount: number;
  clearSelection: () => void;
  invalidate: () => void;
  invalidateModels: () => void;
  invalidateEgressNodes: () => void;
  showError: (error: unknown) => void;
};
