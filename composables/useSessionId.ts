import { resolveSessionId } from "~/utils/session";
const STORAGE_KEY = "motocom.session-id";

export function useSessionId() {
  const sessionId = useState<string>("session-id", () => "");

  if (process.client && !sessionId.value) {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const randomUUID = typeof window.crypto?.randomUUID === "function"
      ? () => window.crypto.randomUUID()
      : undefined;
    sessionId.value = resolveSessionId(stored, randomUUID);

    if (!stored) {
      window.localStorage.setItem(STORAGE_KEY, sessionId.value);
    }
  }

  return sessionId;
}
