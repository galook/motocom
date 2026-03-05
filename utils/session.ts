function createFallbackSessionId() {
  return `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function generateSessionId(randomUUID?: (() => string) | null): string {
  if (typeof randomUUID === "function") {
    try {
      const generatedId = randomUUID();
      if (generatedId) {
        return generatedId;
      }
    } catch {
      // Fall through to deterministic fallback when Web Crypto call context is invalid.
    }
  }

  return createFallbackSessionId();
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
