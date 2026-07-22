export type StorageAccess = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): StorageAccess | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStorageString(
  key: string,
  storage: StorageAccess | null = browserStorage(),
): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorageString(
  key: string,
  value: string,
  storage: StorageAccess | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStorageValue(
  key: string,
  storage: StorageAccess | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function readStorageJSON<T>(
  key: string,
  decode: (value: unknown) => T,
  fallback: T,
  storage?: StorageAccess | null,
): T {
  const raw = readStorageString(key, storage === undefined ? browserStorage() : storage);
  if (raw === null) return fallback;
  try {
    return decode(JSON.parse(raw) as unknown);
  } catch {
    return fallback;
  }
}

export function writeStorageJSON(
  key: string,
  value: unknown,
  storage?: StorageAccess | null,
): boolean {
  try {
    return writeStorageString(
      key,
      JSON.stringify(value),
      storage === undefined ? browserStorage() : storage,
    );
  } catch {
    return false;
  }
}
