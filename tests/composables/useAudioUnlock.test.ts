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

type ResumeBehavior = "resolve" | "never" | "rejectNotAllowed";
type PlayBehavior = "resolve" | "never" | "rejectNotAllowed";
type DecodeBehavior = "resolve" | "reject";

function createWebAudioContextMock(options?: {
  resumePlan?: ResumeBehavior[];
  playPlan?: PlayBehavior[];
  decodePlan?: DecodeBehavior[];
}) {
  const resumePlan = options?.resumePlan ?? [];
  const playPlan = options?.playPlan ?? [];
  const decodePlan = options?.decodePlan ?? [];

  const contexts: any[] = [];
  let resumeIndex = 0;
  let playIndex = 0;
  let decodeIndex = 0;

  const ctor = vi.fn().mockImplementation(() => {
    const context: any = {
      state: "suspended",
      sampleRate: 44_100,
      destination: {},
      resume: vi.fn(() => {
        const behavior = resumePlan[resumeIndex] ?? "resolve";
        resumeIndex += 1;

        if (behavior === "never") {
          return new Promise<void>(() => {});
        }
        if (behavior === "rejectNotAllowed") {
          return Promise.reject(new DOMException("The operation is not allowed.", "NotAllowedError"));
        }

        context.state = "running";
        return Promise.resolve();
      }),
      createBuffer: vi.fn((_channels: number, length: number, sampleRate: number) => ({
        duration: Math.max(0.001, length / Math.max(1, sampleRate)),
      })),
      decodeAudioData: vi.fn((_input: ArrayBuffer) => {
        const behavior = decodePlan[decodeIndex] ?? "resolve";
        decodeIndex += 1;

        if (behavior === "reject") {
          return Promise.reject(new Error("decode failed"));
        }

        return Promise.resolve({ duration: 0.1 });
      }),
      createBufferSource: vi.fn(() => {
        const source: any = {
          buffer: null,
          onended: null,
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(() => {
            const behavior = playPlan[playIndex] ?? "resolve";
            playIndex += 1;

            if (behavior === "rejectNotAllowed") {
              throw new DOMException("The operation is not allowed.", "NotAllowedError");
            }

            if (behavior === "never") {
              return;
            }

            setTimeout(() => {
              if (typeof source.onended === "function") {
                source.onended();
              }
            }, 0);
          }),
        };

        return source;
      }),
    };

    contexts.push(context);
    return context;
  });

  return {
    ctor,
    contexts,
  };
}

function installFetchMock() {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: any) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push(url);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(16),
    };
  });

  (globalThis as any).fetch = fetchMock;

  return {
    fetchMock,
    calls,
  };
}

describe("useAudioUnlock", () => {
  const originalClient = (process as any).client;
  const originalFetch = (globalThis as any).fetch;

  beforeEach(() => {
    (process as any).client = true;
    installStateMocks();
  });

  afterEach(() => {
    (process as any).client = originalClient;
    (globalThis as any).fetch = originalFetch;
    delete (window as any).AudioContext;
    delete (window as any).webkitAudioContext;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("marks unlocked when audio context is unavailable", async () => {
    const composable = useAudioUnlock();

    await composable.unlockAudio();

    expect(composable.isUnlocked.value).toBe(true);
  });

  it("buffers playback while locked and flushes once unlocked", async () => {
    vi.useFakeTimers();
    const webAudioMock = createWebAudioContextMock();
    const fetchState = installFetchMock();
    (window as any).AudioContext = webAudioMock.ctor;

    const composable = useAudioUnlock();
    composable.queuePlayback("queued.mp3");

    expect(fetchState.fetchMock).not.toHaveBeenCalled();

    const unlockTask = composable.unlockAudio();
    await vi.advanceTimersByTimeAsync(200);
    await unlockTask;
    await vi.advanceTimersByTimeAsync(100);

    expect(fetchState.calls.some((url) => url.includes("queued.mp3"))).toBe(true);
  });

  it("queues sequential playback and reuses decoded buffer cache", async () => {
    vi.useFakeTimers();
    const webAudioMock = createWebAudioContextMock();
    const fetchState = installFetchMock();
    (window as any).AudioContext = webAudioMock.ctor;

    const composable = useAudioUnlock();
    const unlockTask = composable.unlockAudio();
    await vi.advanceTimersByTimeAsync(300);
    await unlockTask;

    composable.queuePlayback("first.mp3");
    composable.queuePlayback("first.mp3");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(200);

    expect(fetchState.calls.filter((url) => url.includes("first.mp3"))).toHaveLength(1);
    expect(webAudioMock.contexts[0].createBufferSource).toHaveBeenCalledTimes(3);
  });

  it("keeps queue moving when first playback never ends", async () => {
    vi.useFakeTimers();
    const webAudioMock = createWebAudioContextMock({
      playPlan: ["never", "resolve", "resolve"],
    });
    const fetchState = installFetchMock();
    (window as any).AudioContext = webAudioMock.ctor;

    const composable = useAudioUnlock();
    composable.isUnlocked.value = true;

    composable.queuePlayback("first.mp3");
    composable.queuePlayback("second.mp3");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(9_200);
    await Promise.resolve();

    expect(fetchState.calls.some((url) => url.includes("first.mp3"))).toBe(true);
    expect(fetchState.calls.some((url) => url.includes("second.mp3"))).toBe(true);
    expect(webAudioMock.contexts[0].createBufferSource).toHaveBeenCalledTimes(3);
  });

  it("re-locks audio after NotAllowed playback failures", async () => {
    const webAudioMock = createWebAudioContextMock({
      playPlan: ["rejectNotAllowed"],
    });
    installFetchMock();
    (window as any).AudioContext = webAudioMock.ctor;

    const composable = useAudioUnlock();
    composable.isUnlocked.value = true;

    composable.queuePlayback("first.mp3");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(composable.isUnlocked.value).toBe(false);
  });

  it("does not stay in enabling state when audio context resume hangs", async () => {
    vi.useFakeTimers();
    const webAudioMock = createWebAudioContextMock({
      resumePlan: ["never"],
    });
    (window as any).AudioContext = webAudioMock.ctor;

    const composable = useAudioUnlock();
    const unlockTask = composable.unlockAudio();

    expect(composable.isUnlocking.value).toBe(true);

    await vi.advanceTimersByTimeAsync(4_000);
    await unlockTask;

    expect(composable.isUnlocking.value).toBe(false);
    expect(composable.isUnlocked.value).toBe(false);
  });

  it("proactively re-locks when audio context is no longer running", async () => {
    vi.useFakeTimers();
    const webAudioMock = createWebAudioContextMock();
    (window as any).AudioContext = webAudioMock.ctor;

    const composable = useAudioUnlock();
    const unlockTask = composable.unlockAudio();
    await vi.advanceTimersByTimeAsync(300);
    await unlockTask;

    expect(composable.isUnlocked.value).toBe(true);
    webAudioMock.contexts[0].state = "suspended";

    const available = composable.refreshAudioAvailability();

    expect(available).toBe(false);
    expect(composable.isUnlocked.value).toBe(false);
  });
});
