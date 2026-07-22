import type { ReactNode } from "react";

import { EmptyState, ErrorState, LoadingState } from "@/shared/components/data-state";

type AsyncStateProps = {
  loading: boolean;
  error?: Error | null;
  empty: boolean;
  onRetry: () => void;
  emptyMessage?: string | undefined;
  children: ReactNode;
};

export function AsyncState({
  loading,
  error,
  empty,
  onRetry,
  emptyMessage,
  children,
}: AsyncStateProps) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} onRetry={onRetry} />;
  if (empty) return <EmptyState message={emptyMessage} />;
  return children;
}
