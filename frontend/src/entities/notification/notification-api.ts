import { apiRequest } from "@/shared/api/client";
import { createObjectDecoder, hasShape, isArrayOf, isBoolean, isNumber, isOneOf, isOptional, isString } from "@/shared/api/decoder";

export type NotificationDTO = { id: string; eventKey: string; severity: "info" | "warning" | "error"; title: string; body: string; status: "unread" | "read" | "acknowledged"; createdAt: string; readAt?: string; acknowledgedAt?: string; expiresAt?: string };
export type NotificationPageDTO = { items: NotificationDTO[]; page: number; pageSize: number; total: number };
const item = hasShape({ id: isString, eventKey: isString, severity: isOneOf("info", "warning", "error"), title: isString, body: isString, status: isOneOf("unread", "read", "acknowledged"), createdAt: isString, readAt: isOptional(isString), acknowledgedAt: isOptional(isString), expiresAt: isOptional(isString) });
const decodePage = createObjectDecoder<NotificationPageDTO>("notification page", { items: isArrayOf(item), page: isNumber, pageSize: isNumber, total: isNumber });
const decodeUpdated = createObjectDecoder<{ updated: boolean }>("notification update", { updated: isBoolean });
export function listNotifications(): Promise<NotificationPageDTO> { return apiRequest("/api/admin/v1/notifications?page=1&pageSize=20", {}, decodePage); }
export function markNotificationRead(id: string): Promise<{ updated: boolean }> { return apiRequest("/api/admin/v1/notifications/" + encodeURIComponent(id) + "/read", { method: "POST" }, decodeUpdated); }
export function acknowledgeNotification(id: string): Promise<{ updated: boolean }> { return apiRequest("/api/admin/v1/notifications/" + encodeURIComponent(id) + "/acknowledge", { method: "POST" }, decodeUpdated); }
