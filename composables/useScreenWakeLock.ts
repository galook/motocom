import { watch } from "vue";
import { useSystemDiagnosticsLog } from "~/composables/useSystemDiagnosticsLog";

type NoSleepInstance = {
  readonly isEnabled: boolean;
  enable: () => Promise<unknown>;
  disable: () => void;
};

export function useScreenWakeLock() {
  const isWakeLockSupported = ref(false);
  const isWakeLockActive = ref(false);
  const { logStatus, logError } = useSystemDiagnosticsLog();
  let shouldKeepAwake = true;
  let noSleep: NoSleepInstance | null = null;
  let noSleepLoadTried = false;
  let noSleepLoadFailed = false;

  const hasNativeWakeLockApi = () =>
    process.client && typeof navigator !== "undefined" && "wakeLock" in navigator;

  const detectNoSleepMode = () => {
    const noSleepAny = noSleep as { _wakeLock?: unknown; noSleepVideo?: unknown } | null;
    if (noSleepAny?._wakeLock) {
      return "mode=api";
    }
    if (noSleepAny?.noSleepVideo) {
      return "mode=video";
    }
    return "mode=legacy";
  };

  const ensureNoSleep = async () => {
    if (!process.client) {
      return null;
    }

    if (noSleep) {
      return noSleep;
    }

    if (noSleepLoadTried && noSleepLoadFailed) {
      return null;
    }

    noSleepLoadTried = true;
    try {
      const module = await import("nosleep.js");
      const NoSleepClass = module.default;
      noSleep = new NoSleepClass() as unknown as NoSleepInstance;
      noSleepLoadFailed = false;
      isWakeLockSupported.value = true;
      return noSleep;
    } catch (error) {
      noSleepLoadFailed = true;
      isWakeLockSupported.value = hasNativeWakeLockApi();
      logError("nosleep", "Failed to load NoSleep library.", error);
      return null;
    }
  };

  const releaseWakeLock = async () => {
    const instance = noSleep;
    if (!instance) {
      isWakeLockActive.value = false;
      return;
    }

    try {
      instance.disable();
    } catch (error) {
      logError("nosleep", "Failed to disable NoSleep.", error);
    }

    isWakeLockActive.value = false;
  };

  const requestWakeLock = async () => {
    if (!process.client || !shouldKeepAwake) {
      return false;
    }

    if (document.visibilityState !== "visible") {
      return false;
    }

    const instance = await ensureNoSleep();
    if (!instance) {
      isWakeLockActive.value = false;
      return false;
    }

    try {
      await instance.enable();
      isWakeLockActive.value = Boolean(instance.isEnabled);
      isWakeLockSupported.value = true;

      if (isWakeLockActive.value) {
        logStatus("nosleep", "NoSleep is active.", detectNoSleepMode());
      }

      return isWakeLockActive.value;
    } catch (error) {
      isWakeLockActive.value = false;
      logError("nosleep", "NoSleep enable failed.", error);
      return false;
    }
  };

  const onVisibilityChange = () => {
    if (!process.client || !shouldKeepAwake) {
      return;
    }

    if (document.visibilityState === "visible") {
      void requestWakeLock();
      return;
    }

    void releaseWakeLock();
  };

  const onUserInteraction = () => {
    if (!process.client || !shouldKeepAwake) {
      return;
    }

    void requestWakeLock();
  };

  onMounted(() => {
    if (!process.client) {
      return;
    }

    isWakeLockSupported.value = hasNativeWakeLockApi();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pointerdown", onUserInteraction, { passive: true });
    window.addEventListener("touchstart", onUserInteraction, { passive: true });
    window.addEventListener("keydown", onUserInteraction);
    void requestWakeLock();
  });

  onUnmounted(() => {
    if (!process.client) {
      return;
    }

    shouldKeepAwake = false;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pointerdown", onUserInteraction);
    window.removeEventListener("touchstart", onUserInteraction);
    window.removeEventListener("keydown", onUserInteraction);
    void releaseWakeLock();
  });

  watch(
    isWakeLockSupported,
    (next, previous) => {
      if (!process.client || next === previous) {
        return;
      }

      logStatus(
        "nosleep",
        next ? "NoSleep is supported." : "NoSleep is not supported.",
      );
    },
    { immediate: true },
  );

  watch(
    isWakeLockActive,
    (next, previous) => {
      if (!process.client || next === previous) {
        return;
      }

      logStatus("nosleep", next ? "NoSleep is active." : "NoSleep is inactive.");
    },
    { immediate: true },
  );

  return {
    isWakeLockSupported,
    isWakeLockActive,
    requestWakeLock,
    releaseWakeLock,
  };
}
