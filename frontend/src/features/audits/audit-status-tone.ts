/** 详情弹窗的状态 Badge 色调；保持与迁移前完全一致的 class 组合与判定顺序。 */
export function auditStatusBadgeClass(statusCode: number, failed = false): string {
  if (statusCode >= 500) return "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30";
  if (statusCode >= 400) return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30";
  if (failed) return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30";
  if (statusCode >= 200 && statusCode < 300)
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  return "bg-muted text-muted-foreground";
}
