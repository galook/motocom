function createFallbackSessionId() {
  return `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function generateSessionId(randomUUID?: (() => string) | null): string {
  return randomUUID?.() ?? createFallbackSessionId();
}

export function resolveSessionId(
  storedSessionId: string | null,
  randomUUID?: (() => string) | null,
): string {
  if (storedSessionId) {
    return storedSessionId;
  }

  return generateSessionId(randomUUID);
}
