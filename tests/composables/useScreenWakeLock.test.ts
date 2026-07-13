// @vitest-environment jsdom
import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const diagnostics = vi.hoisted(() => ({
  logStatus: vi.fn(),
  logError: vi.fn(),
}));

const noSleepState = vi.hoisted(() => {
  const instances: any[] = [];
  let enableImpl: null | ((instance: any) => Promise<unknown>) = null;

  class NoSleepMock {
    enabled = false;
    _wakeLock: Record<string, never> | null = null;

    constructor() {
      instances.push(this);
    }

    enable = vi.fn(async () => {
      if (enableImpl) {
        return await enableImpl(this);
      }

      this._wakeLock = {};
      this.enabled = true;
      return undefined;
    });

    disable = vi.fn(() => {
      this._wakeLock = null;
      this.enabled = false;
    });

    get isEnabled() {
      return this.enabled;
    }
  }

  return {
    NoSleepMock,
    instances,
    setEnableImpl(fn: null | ((instance: any) => Promise<unknown>)) {
      enableImpl = fn;
    },
    reset() {
      instances.length = 0;
      enableImpl = null;
    },
  };
});

vi.mock("~/composables/useSystemDiagnosticsLog", () => ({
  useSystemDiagnosticsLog: () => diagnostics,
}));

vi.mock("nosleep.js", () => ({
  default: noSleepState.NoSleepMock,
}));

async function loadComposable() {
  return await import("../../composables/useScreenWakeLock");
}

async function flushAsyncWork() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await Promise.resolve();
}

describe("useScreenWakeLock", () => {
  const originalClient = (process as any).client;
  let mountedCallbacks: Array<() => void> = [];
  let unmountedCallbacks: Array<() => void> = [];
  let visibilityState: DocumentVisibilityState = "visible";

  beforeEach(() => {
    vi.resetModules();
    (process as any).client = true;
    (globalThis as any).ref = ref;
    mountedCallbacks = [];
    unmountedCallbacks = [];
    (globalThis as any).onMounted = (callback: () => void) => {
      mountedCallbacks.push(callback);
    };
    (globalThis as any).onUnmounted = (callback: () => void) => {
      unmountedCallbacks.push(callback);
    };

    visibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });

    noSleepState.reset();
    diagnostics.logStatus.mockReset();
    diagnostics.logError.mockReset();
  });

  afterEach(() => {
    for (const callback of unmountedCallbacks) {
      callback();
    }

    (process as any).client = originalClient;
    noSleepState.reset();
    vi.restoreAllMocks();
  });

  it("does not try to enable wake lock on mount", async () => {
    const { useScreenWakeLock } = await loadComposable();
    useScreenWakeLock();
    expect(mountedCallbacks).toHaveLength(1);
    mountedCallbacks.forEach((callback) => callback());
    await flushAsyncWork();

    expect(noSleepState.instances).toHaveLength(1);
    expect(noSleepState.instances[0].enable).not.toHaveBeenCalled();
    expect(diagnostics.logError).not.toHaveBeenCalledWith(
      "nosleep",
      "NoSleep enable failed.",
      expect.anything(),
    );
  });

  it("activates wake lock after user interaction", async () => {
    const { useScreenWakeLock } = await loadComposable();
    const composable = useScreenWakeLock();
    mountedCallbacks.forEach((callback) => callback());
    await flushAsyncWork();

    window.dispatchEvent(new Event("pointerdown"));
    await flushAsyncWork();

    expect(noSleepState.instances[0].enable).toHaveBeenCalledTimes(1);
    expect(composable.isWakeLockActive.value).toBe(true);
  });

  it("does not treat non-gesture wake-lock requests as hard errors", async () => {
    const { useScreenWakeLock } = await loadComposable();
    const composable = useScreenWakeLock();
    mountedCallbacks.forEach((callback) => callback());
    await flushAsyncWork();

    const granted = await composable.requestWakeLock();

    expect(granted).toBe(false);
    expect(noSleepState.instances[0].enable).not.toHaveBeenCalled();
    expect(diagnostics.logError).not.toHaveBeenCalled();
    expect(diagnostics.logStatus).toHaveBeenCalledWith(
      "nosleep",
      "NoSleep is waiting for a user interaction.",
      "Tap anywhere to enable wake lock on iOS.",
    );
  });

  it("reports denied wake-lock requests after direct user interaction", async () => {
    const { useScreenWakeLock } = await loadComposable();
    noSleepState.setEnableImpl(async () => {
      throw new DOMException("Permission was denied", "NotAllowedError");
    });

    const composable = useScreenWakeLock();
    mountedCallbacks.forEach((callback) => callback());
    await flushAsyncWork();
    diagnostics.logError.mockClear();

    window.dispatchEvent(new Event("pointerdown"));
    await flushAsyncWork();

    expect(composable.isWakeLockActive.value).toBe(false);
    expect(diagnostics.logError).toHaveBeenCalledWith(
      "nosleep",
      "NoSleep enable failed.",
      expect.any(DOMException),
      "Wake lock denied on iOS. Try tapping again and disable Low Power Mode.",
    );
  });
});
