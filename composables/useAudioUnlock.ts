import { rewriteLoopbackUrlForClient } from "~/utils/mutation";
import { useSystemDiagnosticsLog } from "~/composables/useSystemDiagnosticsLog";
import { watch } from "vue";

const AUDIO_CONTEXT_RESUME_TIMEOUT_MS = 1_500;
const AUDIO_UNLOCK_TIMEOUT_MS = 2_500;
const AUDIO_FETCH_TIMEOUT_MS = 12_000;
const PLAYBACK_END_TIMEOUT_MS = 8_000;
const PLAYBACK_RETRY_DELAY_MS = 150;
const MAX_PLAY_ATTEMPTS = 2;
const MAX_PENDING_PLAYBACK = 20;
const MAX_DECODED_BUFFER_CACHE = 40;
const AUDIO_DEBUG_ALERT_COOLDOWN_MS = 1_500;
const AUDIO_DEBUG_ALERT_MAX_LENGTH = 1_800;

const sleep = (durationMs: number) =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  }
}

function isPlaybackBlockedError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  if (typeof name === "string" && name === "NotAllowedError") {
    return true;
  }

  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message !== "string") {
    return false;
  }

  return /not[\s-]?allowed|user gesture|interaction|audiocontext/i.test(message);
}

function buildPlaybackBlockedError() {
  return new DOMException(
    "Audio playback is blocked until a user gesture unlocks the app.",
    "NotAllowedError",
  );
}

function playbackTimeoutMs(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return PLAYBACK_END_TIMEOUT_MS;
  }
  return Math.max(PLAYBACK_END_TIMEOUT_MS, Math.ceil(durationSeconds * 1_000) + 500);
}

async function fetchAudioBytes(url: string): Promise<ArrayBuffer> {
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    abortController.abort();
  }, AUDIO_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch audio (${response.status}).`);
    }

    return await response.arrayBuffer();
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function waitForSourceToEnd(source: AudioBufferSourceNode, timeoutMs: number) {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeoutHandle = setTimeout(() => {
      finish(new Error("Timed out while waiting for audio playback to finish."));
    }, timeoutMs);

    const finish = (error?: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      source.onended = null;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    source.onended = () => {
      finish();
    };

    try {
      source.start(0);
    } catch (error) {
      finish(error);
    }
  });
}

export function useAudioUnlock(convexUrl = "") {
  const isUnlocked = useState<boolean>("audio-unlocked", () => false);
  const isUnlocking = ref(false);
  const chain = ref(Promise.resolve());
  const pendingUrls = useState<string[]>("audio-pending-urls", () => []);
  const audioContext = useState<AudioContext | null>("audio-context", () => null);
  const decodeCache = useState<Map<string, AudioBuffer>>(
    "audio-decode-cache",
    () => new Map(),
  );
  const decodeInFlight = useState<Map<string, Promise<AudioBuffer>>>(
    "audio-decode-inflight",
    () => new Map(),
  );
  const lastDebugAlert = useState<{ key: string; at: number }>(
    "audio-debug-last-alert",
    () => ({ key: "", at: 0 }),
  );
  const { logStatus, logError } = useSystemDiagnosticsLog();

  const summarizeError = (error: unknown) => {
    if (!error) {
      return "unknown";
    }
    if (error instanceof Error || error instanceof DOMException) {
      return `${error.name}: ${error.message || "(no message)"}`;
    }
    if (typeof error === "string") {
      return error;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  };

  const summarizeDetails = (
    details: Record<string, string | number | boolean | null | undefined>,
  ) =>
    Object.entries(details)
      .filter(([, value]) => value != null && value !== "")
      .map(([key, value]) => `${key}=${String(value)}`);

  const showAudioDebugAlert = (
    stage: string,
    details: Record<string, string | number | boolean | null | undefined>,
    error?: unknown,
  ) => {
    const detailEntries = summarizeDetails(details);
    logError(
      "audio",
      `Audio ${stage.replace(/-/g, " ")}`,
      error,
      detailEntries.join(", "),
    );

    if (!process.client || typeof window === "undefined" || typeof window.alert !== "function") {
      return;
    }

    const errorText = summarizeError(error);
    const key = `${stage}|${detailEntries.join("|")}|${errorText}`;
    const now = Date.now();
    if (
      lastDebugAlert.value.key === key &&
      now - lastDebugAlert.value.at < AUDIO_DEBUG_ALERT_COOLDOWN_MS
    ) {
      return;
    }
    lastDebugAlert.value = { key, at: now };

    const contextState = audioContext.value?.state ?? "none";
    const text = [
      "[MOTOCOM AUDIO DEBUG]",
      `stage=${stage}`,
      ...detailEntries,
      `error=${errorText}`,
      `ctxState=${contextState}`,
      `isUnlocked=${String(isUnlocked.value)}`,
      `isUnlocking=${String(isUnlocking.value)}`,
      `pending=${pendingUrls.value.length}`,
    ].join("\n");

    console.error(text, error);
    const isJsdom =
      typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent || "");
    if (isJsdom) {
      return;
    }

    try {
      window.alert(text.slice(0, AUDIO_DEBUG_ALERT_MAX_LENGTH));
    } catch {
      // Ignore alert failures in unsupported environments.
    }
  };

  const ensureAudioContext = () => {
    if (!process.client) {
      return null;
    }

    if (audioContext.value) {
      return audioContext.value;
    }

    const AudioContextClass = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      return null;
    }

    try {
      audioContext.value = new AudioContextClass();
    } catch (error) {
      showAudioDebugAlert("create-audio-context", {}, error);
      return null;
    }

    return audioContext.value;
  };

  const resumeAudioContext = async () => {
    const context = ensureAudioContext();
    if (!context) {
      return true;
    }

    if (context.state === "running") {
      return true;
    }

    try {
      await withTimeout(
        Promise.resolve(context.resume()).then(() => undefined),
        AUDIO_CONTEXT_RESUME_TIMEOUT_MS,
        undefined,
      );
    } catch (error) {
      showAudioDebugAlert("resume-context-throw", {}, error);
      return false;
    }

    const running = context.state === "running";
    if (!running) {
      showAudioDebugAlert("resume-context-not-running", {
        state: context.state,
      });
    }
    return running;
  };

  const primeAudioContext = async () => {
    const context = ensureAudioContext();
    if (!context) {
      return true;
    }

    const resumed = await resumeAudioContext();
    if (!resumed) {
      return false;
    }

    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, context.sampleRate || 44_100);
    source.connect(context.destination);

    try {
      await withTimeout(
        waitForSourceToEnd(source, 250).then(() => true).catch(() => true),
        250,
        true,
      );
    } finally {
      source.onended = null;
      try {
        source.disconnect();
      } catch {
        // Ignore disconnect errors.
      }
    }

    return true;
  };

  const rememberDecodedBuffer = (url: string, buffer: AudioBuffer) => {
    const cache = decodeCache.value;
    if (cache.has(url)) {
      cache.delete(url);
    }
    cache.set(url, buffer);

    while (cache.size > MAX_DECODED_BUFFER_CACHE) {
      const oldestKey = cache.keys().next().value as string | undefined;
      if (!oldestKey) {
        return;
      }
      cache.delete(oldestKey);
    }
  };

  const loadDecodedBuffer = async (url: string) => {
    const cached = decodeCache.value.get(url);
    if (cached) {
      return cached;
    }

    const inFlight = decodeInFlight.value.get(url);
    if (inFlight) {
      return await inFlight;
    }

    const task = (async () => {
      const context = ensureAudioContext();
      if (!context) {
        const missingContextError = new Error("AudioContext is unavailable.");
        showAudioDebugAlert("decode-missing-context", { url }, missingContextError);
        throw missingContextError;
      }

      try {
        const bytes = await fetchAudioBytes(url);
        const decoded = await context.decodeAudioData(bytes.slice(0));
        rememberDecodedBuffer(url, decoded);
        return decoded;
      } catch (error) {
        showAudioDebugAlert("decode-buffer-failed", { url }, error);
        throw error;
      }
    })();

    decodeInFlight.value.set(url, task);
    try {
      return await task;
    } finally {
      decodeInFlight.value.delete(url);
    }
  };

  const playDecodedBuffer = async (url: string) => {
    const context = ensureAudioContext();
    if (!context) {
      return;
    }

    const resumed = await resumeAudioContext();
    if (!resumed) {
      throw buildPlaybackBlockedError();
    }

    const decodedBuffer = await loadDecodedBuffer(url);
    const source = context.createBufferSource();
    source.buffer = decodedBuffer;
    source.connect(context.destination);

    try {
      await waitForSourceToEnd(source, playbackTimeoutMs(decodedBuffer.duration));
    } finally {
      source.onended = null;
      try {
        source.disconnect();
      } catch {
        // Ignore disconnect errors.
      }
    }
  };

  const playWithRetry = async (rawUrl: string) => {
    const playbackUrl = rewriteLoopbackUrlForClient(rawUrl, undefined, convexUrl);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= MAX_PLAY_ATTEMPTS; attempt += 1) {
      try {
        await playDecodedBuffer(playbackUrl);
        return;
      } catch (error) {
        lastError = error;
        if (isPlaybackBlockedError(error)) {
          showAudioDebugAlert("playback-blocked", {
            rawUrl,
            playbackUrl,
            attempt,
          }, error);
          throw error;
        }
        if (attempt < MAX_PLAY_ATTEMPTS) {
          await sleep(PLAYBACK_RETRY_DELAY_MS);
          continue;
        }

        showAudioDebugAlert("playback-failed-after-retry", {
          rawUrl,
          playbackUrl,
          attempt,
        }, error);
      }
    }

    throw lastError ?? new Error("Audio playback failed.");
  };

  const queuePendingUrl = (url: string) => {
    if (!url) {
      return;
    }
    const wasEmpty = pendingUrls.value.length === 0;
    const nextPending = [...pendingUrls.value, url];
    pendingUrls.value = nextPending.slice(-MAX_PENDING_PLAYBACK);
    if (wasEmpty) {
      logStatus("audio", "Playback queued while audio is locked.", `pending=${pendingUrls.value.length}`);
    }
  };

  const enqueuePlaybackTask = (url: string) => {
    chain.value = chain.value
      .catch(() => {
        // Keep playback pipeline alive even if a previous task failed.
      })
      .then(async () => {
        try {
          await playWithRetry(url);
        } catch (error) {
          if (isPlaybackBlockedError(error)) {
            queuePendingUrl(url);
            isUnlocked.value = false;
            return;
          }
          showAudioDebugAlert("playback-task-failed", { url }, error);
        }
      });
  };

  const flushPendingPlayback = () => {
    if (!isUnlocked.value || pendingUrls.value.length === 0) {
      return;
    }

    const bufferedUrls = pendingUrls.value;
    pendingUrls.value = [];
    logStatus("audio", "Flushing queued playback.", `items=${bufferedUrls.length}`);

    for (const bufferedUrl of bufferedUrls) {
      enqueuePlaybackTask(bufferedUrl);
    }
  };

  const refreshAudioAvailability = () => {
    if (!process.client) {
      return isUnlocked.value;
    }

    const context = audioContext.value;
    if (!context) {
      return isUnlocked.value;
    }

    const running = context.state === "running";
    if (isUnlocked.value && !running && !isUnlocking.value) {
      isUnlocked.value = false;
      logStatus("audio", "Audio lock restored because context stopped.", `state=${context.state}`);
    }

    return running;
  };

  const unlockAudio = async () => {
    if (!process.client || isUnlocked.value || isUnlocking.value) {
      return;
    }

    isUnlocking.value = true;
    try {
      const didUnlock = await withTimeout(
        (async () => {
          const context = ensureAudioContext();
          if (!context) {
            logStatus("audio", "Audio unlocked without AudioContext support.");
            return true;
          }

          return await primeAudioContext();
        })(),
        AUDIO_UNLOCK_TIMEOUT_MS,
        false,
      ).catch(() => false);

      isUnlocked.value = didUnlock;
      if (!didUnlock) {
        showAudioDebugAlert("unlock-failed", {
          contextState: audioContext.value?.state ?? "none",
        });
      }
      if (didUnlock) {
        flushPendingPlayback();
      }
    } finally {
      isUnlocking.value = false;
    }
  };

  const queuePlayback = (url: string | null) => {
    if (!process.client || !url) {
      return;
    }

    if (!isUnlocked.value || !refreshAudioAvailability()) {
      queuePendingUrl(url);
      return;
    }

    flushPendingPlayback();
    enqueuePlaybackTask(url);
  };

  watch(
    isUnlocking,
    (next, previous) => {
      if (!process.client || next === previous) {
        return;
      }

      if (next) {
        logStatus("audio", "Audio unlock requested.");
      }
    },
    { immediate: true },
  );

  watch(
    isUnlocked,
    (next, previous) => {
      if (!process.client || next === previous) {
        return;
      }

      const contextState = audioContext.value?.state ?? "none";
      logStatus(
        "audio",
        next ? "Audio is unlocked." : "Audio is locked.",
        `context=${contextState},pending=${pendingUrls.value.length}`,
      );
    },
    { immediate: true },
  );

  return {
    isUnlocked,
    isUnlocking,
    unlockAudio,
    refreshAudioAvailability,
    queuePlayback,
  };
}
