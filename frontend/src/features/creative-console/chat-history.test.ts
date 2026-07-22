import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBlankChatSession,
  createChatSessionTitle,
  loadChatSessions,
  persistChatSessions,
  upsertChatSession,
  type ChatSession,
} from "@/features/creative-console/chat-history";

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("chat history", () => {
  it("creates bounded readable titles", () => {
    expect(
      createChatSessionTitle([
        { id: "1", role: "user", content: "  hello   world  " },
      ]),
    ).toBe("hello world");
    expect(
      createChatSessionTitle([
        { id: "1", role: "user", content: "x".repeat(60) },
      ]),
    ).toHaveLength(49);
  });

  it("sorts and replaces sessions without duplicates", () => {
    const older = {
      ...createBlankChatSession("a"),
      id: "old",
      updatedAt: 1,
      messages: [{ id: "m1", role: "user" as const, content: "old" }],
    };
    const newer = { ...older, id: "new", updatedAt: 2 };
    expect(upsertChatSession([older], newer).map((item) => item.id)).toEqual([
      "new",
      "old",
    ]);
    expect(
      upsertChatSession([older, newer], { ...older, updatedAt: 3 }).map(
        (item) => item.id,
      ),
    ).toEqual(["old", "new"]);
  });

  it("persists, reloads, and rejects malformed records", () => {
    const session: ChatSession = {
      ...createBlankChatSession("grok"),
      id: "session",
      title: "Test",
      messages: [{ id: "message", role: "user", content: "hello" }],
    };
    persistChatSessions("key", [session]);
    expect(loadChatSessions("key")).toMatchObject([
      { id: "session", title: "Test", model: "grok" },
    ]);
    window.localStorage.setItem(
      "grok2api:creative-console:chat-history:bad",
      JSON.stringify([{ id: "bad", messages: "invalid" }]),
    );
    expect(loadChatSessions("bad")).toEqual([]);
  });

  it("keeps the in-memory list when storage is unavailable", () => {
    const session = {
      ...createBlankChatSession("grok"),
      messages: [{ id: "message", role: "user" as const, content: "hello" }],
    };
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(persistChatSessions("key", [session])).toEqual([]);
  });
});
