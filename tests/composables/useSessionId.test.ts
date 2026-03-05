// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionId } from "../../composables/useSessionId";

function installUseStateMock() {
  const store = new Map<string, { value: string }>();
  (globalThis as any).useState = (key: string, init: () => string) => {
    if (!store.has(key)) {
      store.set(key, { value: init() });
    }
    return store.get(key);
  };
  return store;
}

describe("useSessionId", () => {
  const originalClient = (process as any).client;
  const originalWindow = (globalThis as any).window;

  beforeEach(() => {
    (process as any).client = true;
    const backingStore = new Map<string, string>();
    (globalThis as any).window = {
      localStorage: {
        getItem: (key: string) => backingStore.get(key) ?? null,
        setItem: (key: string, value: string) => {
          backingStore.set(key, value);
        },
        removeItem: (key: string) => {
          backingStore.delete(key);
        },
        clear: () => {
          backingStore.clear();
        },
      },
      crypto: {
        randomUUID: () => "default-uuid",
      },
    };
  });

  afterEach(() => {
    (process as any).client = originalClient;
    (globalThis as any).window = originalWindow;
    vi.restoreAllMocks();
  });

  it("uses stored session id", () => {
    installUseStateMock();
    window.localStorage.setItem("motocom.session-id", "stored-id");

    const session = useSessionId();

    expect(session.value).toBe("stored-id");
  });

  it("creates and stores a new session id when none exists", () => {
    installUseStateMock();
    vi.spyOn(window.crypto, "randomUUID").mockReturnValue("new-id");

    const session = useSessionId();

    expect(session.value).toBe("new-id");
    expect(window.localStorage.getItem("motocom.session-id")).toBe("new-id");
  });
});
