import { describe, expect, it, vi } from "vitest";
import { MAX_EVENT_HISTORY } from "../convex/constants";
import {
  appendEvent,
  getLegacyParticipant,
  getOrCreateRoomState,
  getParticipantByToken,
  getRoomByCode,
  promoteNextQueuedRequest,
  requireMainDriver,
  requireParticipant,
  trimRoomEvents,
} from "../convex/lib/helpers";

describe("convex helper queries", () => {
  it("normalizes room code when querying room", async () => {
    const eqCalls: Array<{ field: string; value: string }> = [];
    const unique = vi.fn().mockResolvedValue({ _id: "room1" });
    const query = vi.fn(() => ({
      withIndex: vi.fn((_name, callback) => {
        const q = {
          eq: (field: string, value: string) => {
            eqCalls.push({ field, value });
            return q;
          },
        };
        callback(q);
        return { unique };
      }),
    }));

    await getRoomByCode({ db: { query } } as any, "  ride 01 ");
    expect(eqCalls).toEqual([{ field: "code", value: "RIDE01" }]);
  });

  it("hashes participant tokens before querying authorization records", async () => {
    const eqCalls: Array<{ field: string; value: string }> = [];
    const unique = vi.fn().mockResolvedValue({ _id: "p1" });
    const query = vi.fn(() => ({
      withIndex: vi.fn((_name, callback) => {
        const q = {
          eq: (field: string, value: string) => {
            eqCalls.push({ field, value });
            return q;
          },
        };
        callback(q);
        return { unique };
      }),
    }));

    const participant = await getParticipantByToken(
      { db: { query } } as any,
      "room1" as any,
      "participant-secret",
    );

    expect(participant).toEqual({ _id: "p1" });
    expect(eqCalls[0]).toEqual({ field: "roomId", value: "room1" });
    expect(eqCalls[1].field).toBe("authTokenHash");
    expect(eqCalls[1].value).not.toBe("participant-secret");
    expect(eqCalls[1].value).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps the legacy participant lookup isolated for migrations", async () => {
    const eqCalls: Array<{ field: string; value: string }> = [];
    const unique = vi.fn().mockResolvedValue({ _id: "p1" });
    const query = vi.fn(() => ({
      withIndex: vi.fn((_name, callback) => {
        const q = {
          eq: (field: string, value: string) => {
            eqCalls.push({ field, value });
            return q;
          },
        };
        callback(q);
        return { unique };
      }),
    }));

    await getLegacyParticipant({ db: { query } } as any, "room1" as any, "session1");
    expect(eqCalls).toEqual([
      { field: "roomId", value: "room1" },
      { field: "sessionId", value: "session1" },
    ]);
  });
});

describe("convex role guards", () => {
  const buildCtx = (participant: any) => ({
    db: {
      query: vi.fn(() => ({
        withIndex: vi.fn(() => ({
          unique: vi.fn().mockResolvedValue(participant),
        })),
      })),
    },
  });

  it("requireParticipant returns the token-authorized participant", async () => {
    const result = await requireParticipant(
      buildCtx({ _id: "p1", isMainDriver: false }) as any,
      "room1" as any,
      "participant-token",
    );
    expect(result).toEqual({ _id: "p1", isMainDriver: false });
  });

  it("requireParticipant rejects missing authorization", async () => {
    await expect(
      requireParticipant(buildCtx(null) as any, "room1" as any, "participant-token"),
    ).rejects.toThrow("Participant authorization is invalid or expired");
  });

  it("requireMainDriver rejects a rider", async () => {
    await expect(
      requireMainDriver(
        buildCtx({ _id: "p1", isMainDriver: false }) as any,
        "room1" as any,
        "participant-token",
      ),
    ).rejects.toThrow("Main driver role required");
  });

  it("requireMainDriver returns an elevated participant", async () => {
    const participant = await requireMainDriver(
      buildCtx({ _id: "p1", isMainDriver: true }) as any,
      "room1" as any,
      "participant-token",
    );
    expect(participant).toEqual({ _id: "p1", isMainDriver: true });
  });
});

describe("room state helpers", () => {
  it("returns existing room state when available", async () => {
    const existing = { _id: "rs1", roomId: "room1", nextSeq: 1, activeRequestId: null };
    const insert = vi.fn();
    const get = vi.fn();
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({ unique: vi.fn().mockResolvedValue(existing) })),
        })),
        insert,
        get,
      },
    };

    const result = await getOrCreateRoomState(ctx as any, "room1" as any);
    expect(result).toEqual(existing);
    expect(insert).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("creates and returns room state when missing", async () => {
    const inserted = { _id: "rs2", roomId: "room2", nextSeq: 1, activeRequestId: null };
    const insert = vi.fn().mockResolvedValue("rs2");
    const get = vi.fn().mockResolvedValue(inserted);
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({ unique: vi.fn().mockResolvedValue(null) })),
        })),
        insert,
        get,
      },
    };

    const result = await getOrCreateRoomState(ctx as any, "room2" as any);
    expect(insert).toHaveBeenCalledWith("room_state", {
      roomId: "room2",
      activeRequestId: null,
      nextSeq: 1,
    });
    expect(get).toHaveBeenCalledWith("rs2");
    expect(result).toEqual(inserted);
  });
});

describe("event helpers", () => {
  it("appends a public participant actor and increments sequence", async () => {
    const roomState = { _id: "rs1", roomId: "room1", nextSeq: 7, activeRequestId: null };
    const insert = vi.fn();
    const patch = vi.fn();
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({ unique: vi.fn().mockResolvedValue(roomState) })),
        })),
        insert,
        patch,
      },
    };

    const seq = await appendEvent(ctx as any, "room1" as any, {
      type: "request_started",
      requestId: "req1" as any,
      buttonId: "btn1" as any,
      actorParticipantId: "participant1" as any,
    });

    expect(seq).toBe(7);
    expect(insert).toHaveBeenCalledWith(
      "events",
      expect.objectContaining({
        roomId: "room1",
        seq: 7,
        type: "request_started",
        requestId: "req1",
        buttonId: "btn1",
        actorParticipantId: "participant1",
      }),
    );
    expect(patch).toHaveBeenCalledWith("rs1", { nextSeq: 8 });
  });

  it("trims stale events past max history", async () => {
    const events = Array.from({ length: MAX_EVENT_HISTORY + 2 }, (_, index) => ({
      _id: `event-${index}`,
    }));
    const deleteFn = vi.fn();
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({ collect: vi.fn().mockResolvedValue(events) })),
          })),
        })),
        delete: deleteFn,
      },
    };

    await trimRoomEvents(ctx as any, "room1" as any);
    expect(deleteFn).toHaveBeenCalledTimes(2);
    expect(deleteFn).toHaveBeenCalledWith("event-50");
    expect(deleteFn).toHaveBeenCalledWith("event-51");
  });
});

describe("queue promotion", () => {
  it("returns null when queue is empty", async () => {
    const patch = vi.fn();
    const insert = vi.fn();
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "requests") {
            return {
              withIndex: vi.fn(() => ({ take: vi.fn().mockResolvedValue([]) })),
            };
          }
          throw new Error(`unexpected table: ${table}`);
        }),
        patch,
        insert,
      },
    };

    const result = await promoteNextQueuedRequest(ctx as any, "room1" as any);
    expect(result).toBeNull();
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("promotes a valid queued request and emits a public actor id", async () => {
    const roomState = { _id: "rs1", roomId: "room1", nextSeq: 4, activeRequestId: null };
    const nextQueued = {
      _id: "req1",
      buttonId: "btn1",
      requestedByParticipantId: "participant-rider",
    };
    const patch = vi.fn();
    const insert = vi.fn().mockResolvedValue("event1");
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "requests") {
            return {
              withIndex: vi.fn(() => ({ take: vi.fn().mockResolvedValue([nextQueued]) })),
            };
          }
          if (table === "room_state") {
            return {
              withIndex: vi.fn(() => ({ unique: vi.fn().mockResolvedValue(roomState) })),
            };
          }
          throw new Error(`unexpected table: ${table}`);
        }),
        get: vi.fn().mockResolvedValue({ _id: "btn1", roomId: "room1", isEnabled: true }),
        patch,
        insert,
      },
    };

    const result = await promoteNextQueuedRequest(ctx as any, "room1" as any);
    expect(result).toBe("req1");
    expect(patch).toHaveBeenCalledWith(
      "req1",
      expect.objectContaining({ status: "active", activatedAt: expect.any(Number) }),
    );
    expect(patch).toHaveBeenCalledWith("rs1", { activeRequestId: "req1" });
    expect(insert).toHaveBeenCalledWith(
      "events",
      expect.objectContaining({
        roomId: "room1",
        seq: 4,
        type: "request_started",
        requestId: "req1",
        buttonId: "btn1",
        actorParticipantId: "participant-rider",
      }),
    );
    expect(patch).toHaveBeenCalledWith("rs1", { nextSeq: 5 });
  });
});
