import { watch } from "vue";
import { useSystemDiagnosticsLog } from "~/composables/useSystemDiagnosticsLog";

type NoSleepInstance = {
  readonly isEnabled: boolean;
  enable: () => Promise<unknown>;
  disable: () => void;
};

type WakeLockRequestOptions = {
  fromUserGesture?: boolean;
};

function isWakeLockPermissionError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  if (typeof name === "string" && name === "NotAllowedError") {
    return true;
  }

  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message !== "string") {
    return false;
  }

  return /not[\s-]?allowed|permission|denied|user gesture|interaction/i.test(message);
}

export function useScreenWakeLock() {
  const isWakeLockSupported = ref(false);
  const isWakeLockActive = ref(false);
  const { logStatus, logError } = useSystemDiagnosticsLog();
  let shouldKeepAwake = true;
  let noSleep: NoSleepInstance | null = null;
  let noSleepLoadTried = false;
  let noSleepLoadFailed = false;
  let noSleepLoadPromise: Promise<NoSleepInstance | null> | null = null;
  let wakeLockRequestPromise: Promise<boolean> | null = null;
  let hasUserInteraction = false;
  let waitingForInteractionLogged = false;
  let preparingNoSleepLogged = false;

  const hasNativeWakeLockApi = () =>
    Boolean(process.client && typeof navigator !== "undefined" && "wakeLock" in navigator);

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

    if (noSleepLoadPromise) {
      return await noSleepLoadPromise;
    }

    noSleepLoadTried = true;
    noSleepLoadPromise = (async () => {
      try {
        const module = await import("nosleep.js");
        const NoSleepClass = module.default;
        noSleep = new NoSleepClass() as unknown as NoSleepInstance;
        noSleepLoadFailed = false;
        preparingNoSleepLogged = false;
        isWakeLockSupported.value = true;
        return noSleep;
      } catch (error) {
        noSleepLoadFailed = true;
        isWakeLockSupported.value = hasNativeWakeLockApi();
        logError("nosleep", "Failed to load NoSleep library.", error);
        return null;
      }
    })();

    try {
      return await noSleepLoadPromise;
    } finally {
      noSleepLoadPromise = null;
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

  const noteWaitingForInteraction = () => {
    if (waitingForInteractionLogged) {
      return;
    }

    waitingForInteractionLogged = true;
    logStatus(
      "nosleep",
      "NoSleep is waiting for a user interaction.",
      "Tap anywhere to enable wake lock on iOS.",
    );
  };

  const runWakeLockRequest = (task: () => Promise<boolean>) => {
    if (wakeLockRequestPromise) {
      return wakeLockRequestPromise;
    }

    const inFlight = task().finally(() => {
      if (wakeLockRequestPromise === inFlight) {
        wakeLockRequestPromise = null;
      }
    });
    wakeLockRequestPromise = inFlight;
    return inFlight;
  };

  const activateWakeLock = (instance: NoSleepInstance, fromUserGesture: boolean) =>
    runWakeLockRequest(async () => {
      try {
        const enableTask = instance.enable();
        await Promise.resolve(enableTask);
        isWakeLockActive.value = Boolean(instance.isEnabled);
        isWakeLockSupported.value = true;

        if (isWakeLockActive.value) {
          waitingForInteractionLogged = false;
          logStatus("nosleep", "NoSleep is active.", detectNoSleepMode());
        }

        return isWakeLockActive.value;
      } catch (error) {
        isWakeLockActive.value = false;

        if (isWakeLockPermissionError(error)) {
          if (!fromUserGesture) {
            noteWaitingForInteraction();
            return false;
          }

          logError(
            "nosleep",
            "NoSleep enable failed.",
            error,
            "Wake lock denied on iOS. Try tapping again and disable Low Power Mode.",
          );
          return false;
        }

        logError("nosleep", "NoSleep enable failed.", error);
        return false;
      }
    });

  const requestWakeLock = async (options: WakeLockRequestOptions = {}) => {
    const fromUserGesture = Boolean(options.fromUserGesture);

    if (!process.client || !shouldKeepAwake) {
      return false;
    }

    if (document.visibilityState !== "visible") {
      return false;
    }

    if (fromUserGesture) {
      hasUserInteraction = true;
      waitingForInteractionLogged = false;
    } else if (!hasUserInteraction && !isWakeLockActive.value) {
      noteWaitingForInteraction();
      return false;
    }

    if (noSleep) {
      return await activateWakeLock(noSleep, fromUserGesture);
    }

    if (fromUserGesture) {
      void ensureNoSleep();
      if (!preparingNoSleepLogged) {
        preparingNoSleepLogged = true;
        logStatus(
          "nosleep",
          "Preparing NoSleep.",
          "Tap again if wake lock stays inactive.",
        );
      }
      return false;
    }

    const instance = await ensureNoSleep();
    if (!instance) {
      isWakeLockActive.value = false;
      return false;
    }

    return await activateWakeLock(instance, fromUserGesture);
  };

  const onVisibilityChange = () => {
    if (!process.client || !shouldKeepAwake) {
      return;
    }

    if (document.visibilityState === "visible") {
      if (hasUserInteraction || isWakeLockActive.value) {
        void requestWakeLock();
      }
      return;
    }

    void releaseWakeLock();
  };

  const onUserInteraction = () => {
    if (!process.client || !shouldKeepAwake) {
      return;
    }

    void requestWakeLock({ fromUserGesture: true });
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
    void ensureNoSleep();
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
