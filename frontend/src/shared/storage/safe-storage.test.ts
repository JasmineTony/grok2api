import { describe, expect, it } from "vitest";

import {
  readStorageJSON,
  readStorageString,
  removeStorageValue,
  type StorageAccess,
  writeStorageJSON,
  writeStorageString,
} from "@/shared/storage/safe-storage";

function memoryStorage(): StorageAccess {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

describe("safe storage", () => {
  it("round-trips strings and JSON without global state", () => {
    const storage = memoryStorage();
    expect(writeStorageString("name", "value", storage)).toBe(true);
    expect(readStorageString("name", storage)).toBe("value");
    expect(writeStorageJSON("json", { enabled: true }, storage)).toBe(true);
    expect(
      readStorageJSON(
        "json",
        (value) => value as { enabled: boolean },
        { enabled: false },
        storage,
      ),
    ).toEqual({ enabled: true });
    expect(removeStorageValue("name", storage)).toBe(true);
    expect(readStorageString("name", storage)).toBeNull();
  });

  it("returns fallbacks when storage or JSON decoding fails", () => {
    const unavailable: StorageAccess = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStorageString("key", unavailable)).toBeNull();
    expect(writeStorageString("key", "value", unavailable)).toBe(false);
    expect(readStorageJSON("key", () => "decoded", "fallback", unavailable)).toBe("fallback");
  });
});
