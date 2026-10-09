import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { EgressScope } from "@/features/settings/settings-api";
import { egressScopes } from "@/features/settings/egress-scopes";

/** 出口作用域下拉：节点表单、导入表单与订阅源表单复用同一份选项与顺序。 */
export function EgressScopeSelect({
  id,
  value,
  scopeLabel,
  onChange,
}: {
  id?: string;
  value: EgressScope;
  scopeLabel: (scope: EgressScope) => string;
  onChange: (scope: EgressScope) => void;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as EgressScope)}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {egressScopes.map((scope) => (
          <SelectItem key={scope} value={scope}>
            {scopeLabel(scope)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
