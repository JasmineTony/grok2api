export function createQueryKeys<const T extends string>(scope: T) {
  return {
    all: [scope] as const,
    list: <P extends readonly unknown[]>(...parts: P) => [scope, "list", ...parts] as const,
    detail: (id: string) => [scope, "detail", id] as const,
  };
}
