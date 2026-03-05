import { nextTick, ref, watch } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePresence } from "../../composables/usePresence";

function installStateMocks() {
  (globalThis as any).watch = watch;
  (globalThis as any).onUnmounted = vi.fn();
}

describe("usePresence", () => {
  const originalClient = (process as any).client;

  beforeEach(() => {
    installStateMocks();
    (process as any).client = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    (process as any).client = originalClient;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sends heartbeat immediately and on interval", async () => {
    const mutate = vi.fn().mockResolvedValue({ ok: true });
    (globalThis as any).useConvexMutation = vi.fn(() => ({ mutate }));

    const roomId = ref<string | null>("room1");
    const sessionId = ref("session1");
    const audioUnlocked = ref(false);

    usePresence(roomId, sessionId, audioUnlocked);
    await nextTick();

    expect(mutate).toHaveBeenCalledWith({
      roomId: "room1",
      sessionId: "session1",
      audioUnlocked: false,
    });

    vi.advanceTimersByTime(20_000);
    await nextTick();

    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it("restarts heartbeat when audio unlock changes", async () => {
    const mutate = vi.fn().mockResolvedValue({ ok: true });
    (globalThis as any).useConvexMutation = vi.fn(() => ({ mutate }));

    const roomId = ref<string | null>("room1");
    const sessionId = ref("session1");
    const audioUnlocked = ref(false);

    usePresence(roomId, sessionId, audioUnlocked);
    await nextTick();

    audioUnlocked.value = true;
    await nextTick();

    // immediate call on start + immediate call after restart
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate).toHaveBeenLastCalledWith({
      roomId: "room1",
      sessionId: "session1",
      audioUnlocked: true,
    });
  });
});
