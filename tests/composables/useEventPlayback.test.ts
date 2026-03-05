import { nextTick, ref, watch } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomState } from "../../types/soundboard";
import { useEventPlayback } from "../../composables/useEventPlayback";

function installStateMocks() {
  const state = new Map<string, any>();
  (globalThis as any).useState = (key: string, init: () => unknown) => {
    if (!state.has(key)) {
      state.set(key, ref(init()));
    }
    return state.get(key);
  };
  (globalThis as any).watch = watch;
}

function buildRoomState(events: RoomState["events"]): RoomState {
  return {
    room: { id: "room1", code: "R1", name: "Room" },
    buttons: [
      {
        id: "b1",
        label: "Horn",
        sortOrder: 0,
        isEnabled: true,
        soundUrl: "horn.mp3",
      },
    ],
    activeRequest: null,
    queue: [],
    participants: [
      {
        sessionId: "self",
        displayName: "Self",
        isMainDriver: false,
        lastSeenAt: Date.now(),
        isActive: true,
      },
    ],
    outcomeSounds: {
      acceptUrl: "accept.mp3",
      rejectUrl: "reject.mp3",
    },
    isMainDriver: false,
    events,
  };
}

describe("useEventPlayback", () => {
  beforeEach(() => {
    installStateMocks();
  });

  it("does not replay historical baseline events", async () => {
    const roomState = ref<RoomState | null>(null);
    const queuePlayback = vi.fn();

    useEventPlayback(roomState, ref("self"), ref(true), queuePlayback);

    roomState.value = buildRoomState([
      {
        seq: 1,
        type: "request_started",
        requestId: "r1",
        buttonId: "b1",
        decision: null,
        actorSessionId: "other",
        createdAt: 1,
      },
    ]);
    await nextTick();

    expect(queuePlayback).not.toHaveBeenCalled();
  });

  it("plays fresh remote events only", async () => {
    const roomState = ref<RoomState | null>(null);
    const queuePlayback = vi.fn();

    useEventPlayback(roomState, ref("self"), ref(true), queuePlayback);

    roomState.value = buildRoomState([]);
    await nextTick();

    roomState.value = buildRoomState([
      {
        seq: 1,
        type: "request_started",
        requestId: "r1",
        buttonId: "b1",
        decision: null,
        actorSessionId: "other",
        createdAt: 1,
      },
      {
        seq: 2,
        type: "request_resolved",
        requestId: "r1",
        buttonId: "b1",
        decision: "accepted",
        actorSessionId: "other",
        createdAt: 2,
      },
      {
        seq: 3,
        type: "request_resolved",
        requestId: "r1",
        buttonId: "b1",
        decision: "rejected",
        actorSessionId: "self",
        createdAt: 3,
      },
    ]);

    await nextTick();

    expect(queuePlayback).toHaveBeenCalledTimes(2);
    expect(queuePlayback).toHaveBeenNthCalledWith(1, "horn.mp3");
    expect(queuePlayback).toHaveBeenNthCalledWith(2, "accept.mp3");
  });
});
