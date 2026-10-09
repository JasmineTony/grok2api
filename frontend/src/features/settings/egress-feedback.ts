import { toast } from "sonner";

/** 出口模块统一的失败提示：优先展示服务端错误信息，否则回退到调用方文案。 */
export function showEgressError(error: unknown, fallback = "Operation failed"): void {
  toast.error(error instanceof Error ? error.message : fallback);
}
