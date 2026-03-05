// @vitest-environment jsdom
import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAudioUnlock } from "../../composables/useAudioUnlock";

function installStateMocks() {
  const state = new Map<string, any>();
  (globalThis as any).useState = (key: string, init: () => unknown) => {
    if (!state.has(key)) {
      state.set(key, ref(init()));
    }
    return state.get(key);
  };
  (globalThis as any).ref = ref;
}

function createAudioCtorMock(playPlan: Array<"never" | "resolve" | "rejectNotAllowed"> = []) {
  const instances: any[] = [];
  const playedSrcs: string[] = [];
  let playIndex = 0;

  const ctor = vi.fn().mockImplementation(() => {
    const listeners = new Map<string, Set<() => void>>();
    const emit = (eventName: string) => {
      const handlers = listeners.get(eventName);
      if (!handlers) {
        return;
      }
      for (const handler of [...handlers]) {
        handler();
      }
    };

    const audio: any = {
      src: "",
      preload: "",
      loop: false,
      muted: false,
      duration: 0.1,
      currentTime: 0,
      load: vi.fn(),
      pause: vi.fn(),
      setAttribute: vi.fn(),
      removeAttribute: vi.fn((attribute: string) => {
        if (attribute === "src") {
          audio.src = "";
        }
      }),
      addEventListener: vi.fn((eventName: string, handler: () => void) => {
        if (!listeners.has(eventName)) {
          listeners.set(eventName, new Set());
        }
        listeners.get(eventName)?.add(handler);
      }),
      removeEventListener: vi.fn((eventName: string, handler: () => void) => {
        listeners.get(eventName)?.delete(handler);
      }),
    };

    audio.play = vi.fn(() => {
      playedSrcs.push(audio.src);
      const behavior = playPlan[playIndex] ?? "resolve";
      playIndex += 1;

      if (behavior === "never") {
        return new Promise<void>(() => {});
      }
      if (behavior === "rejectNotAllowed") {
        return Promise.reject(new DOMException("The operation is not allowed.", "NotAllowedError"));
      }

      return Promise.resolve().then(() => {
        setTimeout(() => emit("ended"), 0);
      });
    });

    instances.push(audio);
    return audio;
  });

  return {
    ctor,
    instances,
    playedSrcs,
  };
}

describe("useAudioUnlock", () => {
  const originalClient = (process as any).client;
  const OriginalAudio = (globalThis as any).Audio;

  beforeEach(() => {
    (process as any).client = true;
    installStateMocks();
  });

  afterEach(() => {
    (process as any).client = originalClient;
    (globalThis as any).Audio = OriginalAudio;
    delete (window as any).AudioContext;
    delete (window as any).webkitAudioContext;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("marks unlocked when audio context is unavailable", async () => {
    const audioMock = createAudioCtorMock();
    (globalThis as any).Audio = audioMock.ctor;

    const composable = useAudioUnlock();

    await composable.unlockAudio();

    expect(composable.isUnlocked.value).toBe(true);
  });

  it("does not queue playback while locked", async () => {
    const audioMock = createAudioCtorMock();
    (globalThis as any).Audio = audioMock.ctor;

    const composable = useAudioUnlock();
    composable.queuePlayback("test.mp3");
    await Promise.resolve();

    expect(audioMock.ctor).not.toHaveBeenCalled();
  });

  it("queues sequential playback on a single audio element", async () => {
    vi.useFakeTimers();
    const audioMock = createAudioCtorMock();
    (globalThis as any).Audio = audioMock.ctor;

    const composable = useAudioUnlock();
    composable.isUnlocked.value = true;
    composable.queuePlayback("first.mp3");
    composable.queuePlayback("second.mp3");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);

    expect(audioMock.ctor).toHaveBeenCalledTimes(1);
    expect(audioMock.playedSrcs).toEqual(["first.mp3", "second.mp3"]);
  });

  it("keeps queue moving when playback start hangs on iOS-like failures", async () => {
    vi.useFakeTimers();
    const audioMock = createAudioCtorMock(["never", "never", "resolve"]);
    (globalThis as any).Audio = audioMock.ctor;

    const composable = useAudioUnlock();
    composable.isUnlocked.value = true;

    composable.queuePlayback("first.mp3");
    composable.queuePlayback("second.mp3");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(4_500);
    await Promise.resolve();

    expect(audioMock.ctor).toHaveBeenCalledTimes(1);
    expect(audioMock.playedSrcs).toEqual(["first.mp3", "first.mp3", "second.mp3"]);
  });

  it("re-locks audio after NotAllowed playback failures", async () => {
    const audioMock = createAudioCtorMock(["rejectNotAllowed"]);
    (globalThis as any).Audio = audioMock.ctor;

    const composable = useAudioUnlock();
    composable.isUnlocked.value = true;

    composable.queuePlayback("first.mp3");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(composable.isUnlocked.value).toBe(false);
  });

  it("buffers playback while locked and flushes once unlocked", async () => {
    const audioMock = createAudioCtorMock();
    (globalThis as any).Audio = audioMock.ctor;

    const composable = useAudioUnlock();
    composable.queuePlayback("queued.mp3");

    expect(audioMock.ctor).not.toHaveBeenCalled();

    await composable.unlockAudio();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(audioMock.playedSrcs.some((src) => src.includes("queued.mp3"))).toBe(true);
  });

  it("does not stay in enabling state when audio context resume hangs", async () => {
    vi.useFakeTimers();
    const audioMock = createAudioCtorMock(["never"]);
    (globalThis as any).Audio = audioMock.ctor;

    class HangingAudioContext {
      state = "suspended";

      createGain() {
        return {
          gain: { value: 0 },
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
      }

      createOscillator() {
        return {
          type: "sine",
          frequency: { value: 440 },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
          disconnect: vi.fn(),
        };
      }

      resume() {
        return new Promise<void>(() => {});
      }
    }

    (window as any).AudioContext = HangingAudioContext;

    const composable = useAudioUnlock();
    const unlockTask = composable.unlockAudio();
    expect(composable.isUnlocking.value).toBe(true);

    await vi.advanceTimersByTimeAsync(4_500);
    await unlockTask;

    expect(composable.isUnlocking.value).toBe(false);
  });
});
