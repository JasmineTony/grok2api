import type { DegradeSummaryDTO } from "@/features/quality-guard/quality-guard-api";

// 按出口节点聚合的降级分布：从 degrade-accounts-panel.tsx 拆出，条形比例与展示字段不变。

export function NodeList({ nodes, empty, title }: { nodes: DegradeSummaryDTO["nodes"]; empty: string; title: string }) {
  const max = Math.max(1, ...nodes.map((node) => node.hits));
  return (
    <section className="flex h-full min-h-64 flex-col overflow-hidden rounded-lg bg-card" data-testid="degrade-nodes">
      <div className="shrink-0 border-b px-4 py-4 sm:px-5">
        <h2 className="text-sm font-medium">{title}</h2>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-4 sm:p-5">
        {nodes.length === 0 ? (
          <p className="text-xs text-muted-foreground">{empty}</p>
        ) : (
          nodes.map((node) => (
            <div key={node.name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 text-xs">
              <div>
                <div>{node.name}</div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <i
                    className="block h-full bg-amber-500"
                    style={{ width: `${Math.round((node.hits / max) * 100)}%` }}
                  />
                </div>
              </div>
              <span className="font-mono">
                {node.hits} / {node.accounts}
              </span>
              <span className="font-mono">{node.maxTPS}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
