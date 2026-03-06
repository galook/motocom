import { computed } from "vue";

export type SystemDiagnosticsScope = "audio" | "nosleep";
export type SystemDiagnosticsLevel = "status" | "error";

export type SystemDiagnosticsEntry = {
  id: number;
  scope: SystemDiagnosticsScope;
  level: SystemDiagnosticsLevel;
  message: string;
  detail: string | null;
  createdAt: number;
};

type LogInput = {
  scope: SystemDiagnosticsScope;
  level: SystemDiagnosticsLevel;
  message: string;
  detail?: string | null;
};

const MAX_LOG_ENTRIES = 120;
const DEDUPE_WINDOW_MS = 800;

function summarizeError(error: unknown): string {
  if (!error) {
    return "unknown";
  }

  if (error instanceof Error || error instanceof DOMException) {
    const detail = error.message || "(no message)";
    return `${error.name}: ${detail}`;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function useSystemDiagnosticsLog() {
  const entries = useState<SystemDiagnosticsEntry[]>(
    "system-diagnostics-entries",
    () => [],
  );
  const nextId = useState<number>("system-diagnostics-next-id", () => 1);
  const lastFingerprint = useState<{ key: string; at: number }>(
    "system-diagnostics-last-fingerprint",
    () => ({ key: "", at: 0 }),
  );

  const pushEntry = ({ scope, level, message, detail }: LogInput) => {
    const normalizedMessage = message.trim();
    const normalizedDetail = detail?.trim() ? detail.trim() : null;
    const now = Date.now();
    const fingerprint = `${scope}|${level}|${normalizedMessage}|${normalizedDetail ?? ""}`;

    if (
      fingerprint === lastFingerprint.value.key &&
      now - lastFingerprint.value.at < DEDUPE_WINDOW_MS
    ) {
      return;
    }

    lastFingerprint.value = {
      key: fingerprint,
      at: now,
    };

    const entry: SystemDiagnosticsEntry = {
      id: nextId.value,
      scope,
      level,
      message: normalizedMessage,
      detail: normalizedDetail,
      createdAt: now,
    };
    nextId.value += 1;
    entries.value = [entry, ...entries.value].slice(0, MAX_LOG_ENTRIES);
  };

  const logStatus = (
    scope: SystemDiagnosticsScope,
    message: string,
    detail?: string | null,
  ) => {
    pushEntry({
      scope,
      level: "status",
      message,
      detail,
    });
  };

  const logError = (
    scope: SystemDiagnosticsScope,
    message: string,
    error?: unknown,
    detail?: string | null,
  ) => {
    const errorText = error ? summarizeError(error) : null;
    const combinedDetail = [detail?.trim() || null, errorText]
      .filter((segment): segment is string => Boolean(segment))
      .join(" | ");

    pushEntry({
      scope,
      level: "error",
      message,
      detail: combinedDetail || null,
    });
  };

  const clearSystemDiagnosticsLog = () => {
    entries.value = [];
    lastFingerprint.value = { key: "", at: 0 };
  };

  return {
    systemDiagnosticsLog: computed(() => entries.value),
    logStatus,
    logError,
    clearSystemDiagnosticsLog,
  };
}
