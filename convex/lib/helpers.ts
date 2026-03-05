import { MAX_EVENT_HISTORY, PRESENCE_TIMEOUT_MS } from "../constants";

export function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function hashPin(value: string): string {
  // Lightweight stable hash to avoid storing the raw PIN.
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return `pin_${(hash >>> 0).toString(16)}`;
}

export function isParticipantActive(lastSeenAt: number, now = Date.now()): boolean {
  return now - lastSeenAt <= PRESENCE_TIMEOUT_MS;
}

export async function getRoomByCode(ctx: any, roomCode: string) {
  return ctx.db
    .query("rooms")
    .withIndex("by_code", (q: any) => q.eq("code", normalizeRoomCode(roomCode)))
    .unique();
}

export async function getParticipant(ctx: any, roomId: string, sessionId: string) {
  return ctx.db
    .query("participants")
    .withIndex("by_room_session", (q: any) =>
      q.eq("roomId", roomId).eq("sessionId", sessionId),
    )
    .unique();
}

export async function requireParticipant(ctx: any, roomId: string, sessionId: string) {
  const participant = await getParticipant(ctx, roomId, sessionId);
  if (!participant) {
    throw new Error("Participant session not found in room");
  }
  return participant;
}

export async function requireMainDriver(ctx: any, roomId: string, sessionId: string) {
  const participant = await requireParticipant(ctx, roomId, sessionId);
  if (!participant.isMainDriver) {
    throw new Error("Main driver role required");
  }
  return participant;
}

export async function getOrCreateRoomState(ctx: any, roomId: string) {
  let roomState = await ctx.db
    .query("room_state")
    .withIndex("by_room", (q: any) => q.eq("roomId", roomId))
    .unique();

  if (!roomState) {
    const roomStateId = await ctx.db.insert("room_state", {
      roomId,
      activeRequestId: null,
      nextSeq: 1,
    });
    roomState = await ctx.db.get(roomStateId);
  }

  return roomState;
}

export async function appendEvent(
  ctx: any,
  roomId: string,
  payload: {
    type: "request_started" | "request_resolved";
    requestId: string;
    buttonId?: string;
    decision?: "accepted" | "rejected";
    actorSessionId: string;
  },
) {
  const roomState = await getOrCreateRoomState(ctx, roomId);
  const seq = roomState.nextSeq ?? 1;

  await ctx.db.insert("events", {
    roomId,
    seq,
    type: payload.type,
    requestId: payload.requestId,
    buttonId: payload.buttonId,
    decision: payload.decision,
    actorSessionId: payload.actorSessionId,
    createdAt: Date.now(),
  });

  await ctx.db.patch(roomState._id, { nextSeq: seq + 1 });
  return seq;
}

export async function trimRoomEvents(ctx: any, roomId: string) {
  const events = await ctx.db
    .query("events")
    .withIndex("by_room_seq", (q: any) => q.eq("roomId", roomId))
    .order("desc")
    .collect();

  if (events.length <= MAX_EVENT_HISTORY) {
    return;
  }

  const staleEvents = events.slice(MAX_EVENT_HISTORY);
  for (const event of staleEvents) {
    await ctx.db.delete(event._id);
  }
}

export async function promoteNextQueuedRequest(ctx: any, roomId: string) {
  const [nextQueued] = await ctx.db
    .query("requests")
    .withIndex("by_room_status_created", (q: any) =>
      q.eq("roomId", roomId).eq("status", "queued"),
    )
    .take(1);

  if (!nextQueued) {
    return null;
  }

  const activatedAt = Date.now();
  await ctx.db.patch(nextQueued._id, {
    status: "active",
    activatedAt,
  });

  const roomState = await getOrCreateRoomState(ctx, roomId);
  await ctx.db.patch(roomState._id, {
    activeRequestId: nextQueued._id,
  });

  await appendEvent(ctx, roomId, {
    type: "request_started",
    requestId: nextQueued._id,
    buttonId: nextQueued.buttonId,
    actorSessionId: nextQueued.requestedBySessionId,
  });

  return nextQueued._id;
}
