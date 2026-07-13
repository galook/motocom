import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MAX_EVENT_HISTORY, MAX_QUEUE_LENGTH, PRESENCE_TIMEOUT_MS } from "../constants";

const PIN_HASH_ITERATIONS = 120_000;
const SECRET_TOKEN_BYTES = 32;
const PIN_SALT_BYTES = 16;

export function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function createSecretToken(): string {
  const bytes = new Uint8Array(SECRET_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function createPinSalt(): string {
  const bytes = new Uint8Array(PIN_SALT_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function hashSecret(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(digest);
}

export async function hashPin(value: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(value),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: PIN_HASH_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return bytesToHex(bits);
}

export function legacyHashPin(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return `pin_${(hash >>> 0).toString(16)}`;
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function isParticipantActive(lastSeenAt: number, now = Date.now()): boolean {
  return now - lastSeenAt <= PRESENCE_TIMEOUT_MS;
}

export async function getRoomByCode(ctx: QueryCtx | MutationCtx, roomCode: string) {
  return await ctx.db
    .query("rooms")
    .withIndex("by_code", (q) => q.eq("code", normalizeRoomCode(roomCode)))
    .unique();
}

export async function getParticipantByToken(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<"rooms">,
  participantToken: string,
) {
  if (!participantToken.trim()) {
    return null;
  }
  const authTokenHash = await hashSecret(participantToken);
  return await ctx.db
    .query("participants")
    .withIndex("by_room_auth", (q) =>
      q.eq("roomId", roomId).eq("authTokenHash", authTokenHash),
    )
    .unique();
}

export async function getLegacyParticipant(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<"rooms">,
  sessionId: string,
) {
  return await ctx.db
    .query("participants")
    .withIndex("by_room_session", (q) =>
      q.eq("roomId", roomId).eq("sessionId", sessionId),
    )
    .unique();
}

export async function requireParticipant(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<"rooms">,
  participantToken: string,
) {
  const participant = await getParticipantByToken(ctx, roomId, participantToken);
  if (!participant) {
    throw new Error("Participant authorization is invalid or expired");
  }
  return participant;
}

export async function requireMainDriver(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<"rooms">,
  participantToken: string,
) {
  const participant = await requireParticipant(ctx, roomId, participantToken);
  if (!participant.isMainDriver) {
    throw new Error("Main driver role required");
  }
  return participant;
}

export async function getRoomStateRecord(ctx: QueryCtx | MutationCtx, roomId: Id<"rooms">) {
  return await ctx.db
    .query("room_state")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .unique();
}

export async function getOrCreateRoomState(ctx: MutationCtx, roomId: Id<"rooms">) {
  let roomState = await getRoomStateRecord(ctx, roomId);

  if (!roomState) {
    const roomStateId = await ctx.db.insert("room_state", {
      roomId,
      activeRequestId: null,
      nextSeq: 1,
    });
    roomState = await ctx.db.get(roomStateId);
  }

  if (!roomState) {
    throw new Error("Unable to initialize room state");
  }
  return roomState;
}

export async function touchRoom(ctx: MutationCtx, roomId: Id<"rooms">, at = Date.now()) {
  await ctx.db.patch(roomId, { lastActivityAt: at });
}

export async function appendEvent(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  payload: {
    type: "request_started" | "request_resolved";
    requestId: Id<"requests">;
    buttonId?: Id<"buttons">;
    decision?: "accepted" | "rejected";
    actorParticipantId?: Id<"participants">;
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
    actorParticipantId: payload.actorParticipantId,
    createdAt: Date.now(),
  });

  await ctx.db.patch(roomState._id, { nextSeq: seq + 1 });
  return seq;
}

export async function trimRoomEvents(ctx: MutationCtx, roomId: Id<"rooms">) {
  const events = await ctx.db
    .query("events")
    .withIndex("by_room_seq", (q) => q.eq("roomId", roomId))
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

export async function promoteNextQueuedRequest(ctx: MutationCtx, roomId: Id<"rooms">) {
  for (let attempt = 0; attempt <= MAX_QUEUE_LENGTH; attempt += 1) {
    const [nextQueued] = await ctx.db
      .query("requests")
      .withIndex("by_room_status_created", (q) =>
        q.eq("roomId", roomId).eq("status", "queued"),
      )
      .take(1);

    if (!nextQueued) {
      return null;
    }

    const button = await ctx.db.get(nextQueued.buttonId);
    if (!button || String(button.roomId) !== String(roomId) || !button.isEnabled) {
      await ctx.db.patch(nextQueued._id, {
        status: "rejected",
        resolvedAt: Date.now(),
      });
      continue;
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
      actorParticipantId: nextQueued.requestedByParticipantId,
    });

    return nextQueued._id;
  }

  throw new Error("Unable to promote a valid queued request");
}
