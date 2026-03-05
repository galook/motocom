import { rewriteLoopbackUrlForClient } from "~/utils/mutation";

const PLAY_START_TIMEOUT_MS = 2_000;
const PLAYBACK_END_TIMEOUT_MS = 20_000;
const PLAYBACK_RETRY_DELAY_MS = 150;
const MAX_PLAY_ATTEMPTS = 2;
const SILENT_WAV_DATA_URI =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

const sleep = (durationMs: number) =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

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

async function waitForPlaybackEnd(audio: HTMLAudioElement) {
  const durationSeconds = Number.isFinite(audio.duration) ? audio.duration : 0;
  const timeoutMs = Math.max(
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

export function useAudioUnlock() {
  const isUnlocked = useState<boolean>("audio-unlocked", () => false);
  const isUnlocking = ref(false);
  const chain = ref(Promise.resolve());
  const playbackAudio = useState<HTMLAudioElement | null>("audio-player", () => null);

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
      await waitForPlaybackEnd(audio);
    } finally {
      audio.muted = wasMuted;
      resetAudioElement(audio);
    }
  };

  const playWithRetry = async (rawUrl: string) => {
    const audio = ensurePlaybackAudio();
    const playbackUrl = rewriteLoopbackUrlForClient(rawUrl);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= MAX_PLAY_ATTEMPTS; attempt += 1) {
      try {
        configureAudioElementForIOS(audio);
        audio.muted = false;
        audio.src = playbackUrl;
        audio.load();
        await waitForPlayStart(audio);
        await waitForPlaybackEnd(audio);
        return;
      } catch (error) {
        lastError = error;
        resetAudioElement(audio);
        if (attempt < MAX_PLAY_ATTEMPTS) {
          await sleep(PLAYBACK_RETRY_DELAY_MS);
        }
      }
    }

    resetAudioElement(audio);
    throw lastError ?? new Error("Audio playback failed.");
  };

  const unlockAudio = async () => {
    if (!process.client || isUnlocked.value || isUnlocking.value) {
      return;
    }

    isUnlocking.value = true;
    try {
      const AudioContextClass = window.AudioContext ?? (window as any).webkitAudioContext;
      if (AudioContextClass) {
        const context = new AudioContextClass();
        const gainNode = context.createGain();
        gainNode.gain.value = 0;
        gainNode.connect(context.destination);

        const oscillator = context.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.value = 440;
        oscillator.connect(gainNode);

        oscillator.start();
        oscillator.stop(context.currentTime + 0.02);
        await context.resume();
        await new Promise((resolve) => setTimeout(resolve, 25));
        await context.close();
      }

      try {
        await warmupPlaybackAudio();
      } catch {
        // Some browsers block data-uri warmups; proceed after user gesture.
      }

      isUnlocked.value = true;
    } finally {
      isUnlocking.value = false;
    }
  };

  const queuePlayback = (url: string | null) => {
    if (!process.client || !url || !isUnlocked.value) {
      return;
    }

    chain.value = chain.value
      .catch(() => {
        // Keep playback pipeline alive even if a previous task failed.
      })
      .then(async () => {
        try {
          await playWithRetry(url);
        } catch {
          // Ignore playback failures from browser policy/runtime issues.
        }
      });
  };

  return {
    isUnlocked,
    isUnlocking,
    unlockAudio,
    queuePlayback,
  };
}
