import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copyToClipboard } from "@/shared/clipboard";
import { cn } from "@/shared/lib/cn";

type CopyButtonProps = {
  value: string;
  className?: string;
  disabled?: boolean;
  copyLabel?: string;
  onCopied?: () => void;
  onError?: (error: unknown) => void;
};

export function CopyButton({ value, className, disabled, copyLabel, onCopied, onError }: CopyButtonProps) {
  const { t } = useTranslation();
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    },
    [],
  );

  async function handleClick() {
    const ok = await copyToClipboard(value);
    if (ok) {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
      setCopiedValue(value);
      resetTimerRef.current = window.setTimeout(() => {
        setCopiedValue(null);
        resetTimerRef.current = null;
      }, 1500);
      onCopied?.();
    } else {
      const message = t("common.copyFailed");
      toast.error(message);
      onError?.(new Error(message));
    }
  }

  const copied = copiedValue === value;
  const label = copied ? t("common.copied") : (copyLabel ?? t("common.copy"));
  return (
    <CopyButtonTrigger label={label} copied={copied} disabled={disabled} className={className} onClick={handleClick} />
  );
}

type CopyButtonTriggerProps = {
  label: string;
  copied: boolean;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
};

function CopyButtonTrigger({ label, copied, disabled, className, onClick }: CopyButtonTriggerProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("size-7 shrink-0 text-muted-foreground", className)}
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
