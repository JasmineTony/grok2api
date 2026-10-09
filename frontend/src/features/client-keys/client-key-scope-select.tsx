import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ScopeOption = { value: string; label: string };

/**
 * 计算多选范围的下一个取值。
 * 返回 null 表示「不改变」，调用方据此跳过 onChange，保持原实现不触发多余更新。
 */
function nextScopeSelection(
  value: string[],
  options: ScopeOption[],
  nextValue: string,
  allLabel: string | undefined,
  normalizeAllWhenComplete: boolean,
): string[] | null {
  if (nextValue === "all") return ["all"];
  const current = value.includes("all") ? (allLabel ? [] : options.map((option) => option.value)) : value;
  const next = current.includes(nextValue) ? current.filter((item) => item !== nextValue) : [...current, nextValue];
  if (next.length === 0) return null;
  if (normalizeAllWhenComplete && next.length === options.length) return ["all"];
  return next;
}

type ScopeDropdownProps = {
  testId: string;
  ariaLabel: string;
  summary: string;
  value: string[];
  onChange: (value: string[]) => void;
  options: ScopeOption[];
  allLabel?: string;
  normalizeAllWhenComplete?: boolean;
};

/** 多选范围下拉：摘要文本由调用方按业务语义拼装。 */
export function ScopeDropdown(props: ScopeDropdownProps) {
  const { testId, ariaLabel, summary, allLabel, value, onChange, options, normalizeAllWhenComplete = false } = props;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-8 min-w-0 max-w-[70%] justify-end gap-1.5 px-2 font-normal"
          aria-label={ariaLabel}
          data-testid={testId}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <ScopeDropdownContent
        allLabel={allLabel}
        value={value}
        onChange={onChange}
        options={options}
        normalizeAllWhenComplete={normalizeAllWhenComplete}
      />
    </DropdownMenu>
  );
}

type ScopeContentProps = {
  value: string[];
  onChange: (value: string[]) => void;
  options: ScopeOption[];
  allLabel?: string;
  normalizeAllWhenComplete: boolean;
};

function ScopeDropdownContent({ allLabel, value, onChange, options, normalizeAllWhenComplete }: ScopeContentProps) {
  function toggle(nextValue: string): void {
    const next = nextScopeSelection(value, options, nextValue, allLabel, normalizeAllWhenComplete);
    if (next) onChange(next);
  }

  return (
    <DropdownMenuContent align="end" className="w-48">
      {allLabel ? (
        <>
          <DropdownMenuCheckboxItem
            checked={value.includes("all")}
            onCheckedChange={() => toggle("all")}
            onSelect={(event) => event.preventDefault()}
          >
            {allLabel}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
        </>
      ) : null}
      {options.map((option) => (
        <DropdownMenuCheckboxItem
          key={option.value}
          checked={!allLabel && value.includes("all") ? true : value.includes(option.value)}
          onCheckedChange={() => toggle(option.value)}
          onSelect={(event) => event.preventDefault()}
        >
          {option.label}
        </DropdownMenuCheckboxItem>
      ))}
    </DropdownMenuContent>
  );
}
