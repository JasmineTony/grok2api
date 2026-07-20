import { isRouteErrorResponse } from "react-router-dom";

export function describeRouteError(error: unknown): string | null {
  if (isRouteErrorResponse(error)) {
    if (typeof error.data === "string" && error.data.trim()) return error.data.trim();
    return `${error.status} ${error.statusText}`.trim();
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return null;
}
