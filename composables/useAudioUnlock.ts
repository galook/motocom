import { rewriteLoopbackUrlForClient } from "~/utils/mutation";

const PLAY_START_TIMEOUT_MS = 2_000;
const PLAYBACK_END_TIMEOUT_MS = 20_000;
const PLAYBACK_RETRY_DELAY_MS = 150;
const MAX_PLAY_ATTEMPTS = 2;
const MAX_PENDING_PLAYBACK = 20;
const AUDIO_CONTEXT_RESUME_TIMEOUT_MS = 1_500;
const AUDIO_WARMUP_TIMEOUT_MS = 2_000;
const SILENT_WAV_DATA_URI =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

const sleep = (durationMs: number) =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallback), timeoutMs);
    }),
  ]);
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

  return /not[\s-]?allowed|user gesture|interaction/i.test(message);
}

async function waitForPlayStart(audio: HTMLAudioElement) {
  let playResult: Promise<void> | undefined;
  try {
    playResult = audio.play();
  } catch (error) {
    throw error;
  }

  if (!playResult || typeof playResult.then !== "function") {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      callback();
    };

    const timeoutHandle = setTimeout(() => {
      finish(() => {
        reject(new Error("Timed out while waiting for audio playback to start."));
      });
    }, PLAY_START_TIMEOUT_MS);

    playResult
      .then(() => {
        finish(() => {
          clearTimeout(timeoutHandle);
          resolve();
        });
      })
      .catch((error) => {
        finish(() => {
          clearTimeout(timeoutHandle);
          reject(error);
        });
      });
  });
}

async function waitForPlaybackEnd(audio: HTMLAudioElement, timeoutOverrideMs?: number) {
  const durationSeconds = Number.isFinite(audio.duration) ? audio.duration : 0;
  const timeoutMs = timeoutOverrideMs ?? Math.max(
    PLAYBACK_END_TIMEOUT_MS,
    Math.ceil(durationSeconds * 1_000) + 500,
  );

  await new Promise<void>((resolve) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      audio.removeEventListener("ended", onFinish);
      audio.removeEventListener("error", onFinish);
      audio.removeEventListener("abort", onFinish);
      resolve();
    };

    const onFinish = () => {
      finish();
    };

    timeoutHandle = setTimeout(onFinish, timeoutMs);
    audio.addEventListener("ended", onFinish);
    audio.addEventListener("error", onFinish);
    audio.addEventListener("abort", onFinish);
  });
}

function configureAudioElementForIOS(audio: HTMLAudioElement) {
  audio.preload = "auto";
  audio.loop = false;
  if ("playsInline" in audio) {
    try {
      (audio as HTMLMediaElement & { playsInline?: boolean }).playsInline = true;
    } catch {
      // Ignore unsupported browser behavior.
    }
  }
  audio.setAttribute("playsinline", "true");
  audio.setAttribute("webkit-playsinline", "true");
}

function resetAudioElement(audio: HTMLAudioElement) {
  try {
    audio.pause();
  } catch {
    // Ignore pause errors.
  }
  try {
    audio.removeAttribute("src");
    audio.src = "";
    audio.load();
  } catch {
    // Ignore reset errors.
  }
}

export function useAudioUnlock(convexUrl = "") {
  const isUnlocked = useState<boolean>("audio-unlocked", () => false);
  const isUnlocking = ref(false);
  const chain = ref(Promise.resolve());
  const pendingUrls = useState<string[]>("audio-pending-urls", () => []);
  const playbackAudio = useState<HTMLAudioElement | null>("audio-player", () => null);
  const audioContext = useState<AudioContext | null>("audio-context", () => null);
  const unlockListenersInstalled = useState<boolean>("audio-unlock-listeners-installed", () => false);

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
    } catch {
      return null;
    }
    return audioContext.value;
  };

  const resumeAudioContext = async () => {
    const context = ensureAudioContext();
    if (!context) {
      return false;
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
      return context.state === "running";
    } catch {
      return false;
    }
  };

  const primeAudioContext = async () => {
    const context = ensureAudioContext();
    if (!context) {
      return false;
    }
    const resumed = await resumeAudioContext();
    if (!resumed) {
      return false;
    }

    const gainNode = context.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(context.destination);

    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = 440;
    oscillator.connect(gainNode);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.02);

    await sleep(25);

    try {
      oscillator.disconnect();
      gainNode.disconnect();
    } catch {
      // Ignore disconnect errors.
    }

    return true;
  };

  const ensurePlaybackAudio = () => {
    if (playbackAudio.value) {
      return playbackAudio.value;
    }

    const audio = new Audio();
    configureAudioElementForIOS(audio);
    playbackAudio.value = audio;
    return audio;
  };

  const warmupPlaybackAudio = async () => {
    const audio = ensurePlaybackAudio();
    const wasMuted = audio.muted;

    try {
      configureAudioElementForIOS(audio);
      audio.muted = true;
      audio.src = SILENT_WAV_DATA_URI;
      audio.load();
      await waitForPlayStart(audio);
      await waitForPlaybackEnd(audio, AUDIO_WARMUP_TIMEOUT_MS);
    } finally {
      audio.muted = wasMuted;
      resetAudioElement(audio);
    }
  };

  const playWithRetry = async (rawUrl: string) => {
    const audio = ensurePlaybackAudio();
    const playbackUrl = rewriteLoopbackUrlForClient(rawUrl, undefined, convexUrl);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= MAX_PLAY_ATTEMPTS; attempt += 1) {
      try {
        await resumeAudioContext();
        configureAudioElementForIOS(audio);
        audio.muted = false;
        audio.src = playbackUrl;
        audio.load();
        await waitForPlayStart(audio);
        await waitForPlaybackEnd(audio);
        return;
      } catch (error) {
        lastError = error;
        if (isPlaybackBlockedError(error)) {
          throw error;
        }
        resetAudioElement(audio);
        if (attempt < MAX_PLAY_ATTEMPTS) {
          await sleep(PLAYBACK_RETRY_DELAY_MS);
        }
      }
    }

    resetAudioElement(audio);
    throw lastError ?? new Error("Audio playback failed.");
  };

  const queuePendingUrl = (url: string) => {
    if (!url) {
      return;
    }
    const nextPending = [...pendingUrls.value, url];
    pendingUrls.value = nextPending.slice(-MAX_PENDING_PLAYBACK);
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
          }
        }
      });
  };

  const flushPendingPlayback = () => {
    if (!isUnlocked.value || pendingUrls.value.length === 0) {
      return;
    }

    const bufferedUrls = pendingUrls.value;
    pendingUrls.value = [];
    for (const bufferedUrl of bufferedUrls) {
      enqueuePlaybackTask(bufferedUrl);
    }
  };

  const unlockAudio = async () => {
    if (!process.client || isUnlocked.value || isUnlocking.value) {
      return;
    }

    isUnlocking.value = true;
    try {
      let didUnlock = await primeAudioContext();

      try {
        await warmupPlaybackAudio();
        didUnlock = true;
      } catch {
        // Some browsers block data-uri warmups.
      }

      isUnlocked.value = didUnlock;
      if (didUnlock) {
        flushPendingPlayback();
      }
    } finally {
      isUnlocking.value = false;
    }
  };

  if (process.client && !unlockListenersInstalled.value) {
    unlockListenersInstalled.value = true;

    const handleInteraction = () => {
      void unlockAudio();
    };

    window.addEventListener("pointerdown", handleInteraction, { passive: true });
    window.addEventListener("touchstart", handleInteraction, { passive: true });
    window.addEventListener("keydown", handleInteraction);
  }

  const queuePlayback = (url: string | null) => {
    if (!process.client || !url) {
      return;
    }

    if (!isUnlocked.value) {
      queuePendingUrl(url);
      return;
    }

    flushPendingPlayback();
    enqueuePlaybackTask(url);
  };

  return {
    isUnlocked,
    isUnlocking,
    unlockAudio,
    queuePlayback,
  };
}
