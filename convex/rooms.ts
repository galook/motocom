import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  constantTimeEqual,
  createPinSalt,
  createSecretToken,
  getParticipantByToken,
  getRoomByCode,
  getRoomStateRecord,
  hashPin,
  hashSecret,
  isParticipantActive,
  legacyHashPin,
  normalizeRoomCode,
  requireParticipant,
  touchRoom,
} from "./lib/helpers";
import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_ROOM_NAME_LENGTH,
  PIN_LOCKOUT_MS,
  PIN_MAX_FAILURES,
  PIN_MIN_LENGTH,
} from "./constants";

type RequestDocLike = Pick<
  Doc<"requests">,
  "_id" | "status" | "buttonId" | "createdAt" | "activatedAt" | "requestedByParticipantId"
>;

function isRequestDocLike(value: unknown): value is RequestDocLike {
  if (!value || typeof value !== "object") {
    return false;
  }
  return "status" in value && "buttonId" in value && "createdAt" in value;
}

function validateDisplayName(displayName: string) {
  if (!displayName) {
    throw new Error("Display name is required");
  }
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new Error(`Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or less`);
  }
}

function participantPublicId(participantId: Id<"participants"> | undefined): string | null {
  return participantId ? String(participantId) : null;
}

function validateOperationId(value: string) {
  const operationId = value.trim();
  if (operationId.length < 8 || operationId.length > 100) {
    throw new Error("Invalid operation identifier");
  }
  return operationId;
}

function validateParticipantToken(value: string) {
  const participantToken = value.trim();
  if (participantToken.length < 32 || participantToken.length > 256) {
    throw new Error("Invalid participant authorization token");
  }
  return participantToken;
}

export const createRoom = mutation({
  args: {
    roomCode: v.string(),
    roomName: v.string(),
    displayName: v.string(),
    mainDriverPin: v.string(),
    participantToken: v.string(),
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    const code = normalizeRoomCode(args.roomCode);
    const roomName = args.roomName.trim();
    const displayName = args.displayName.trim();
    const pin = args.mainDriverPin.trim();
    const operationId = validateOperationId(args.operationId);
    const participantToken = validateParticipantToken(args.participantToken);

    if (code.length < 3 || code.length > 12) {
      throw new Error("Room code must be between 3 and 12 characters");
    }
    if (!roomName) {
      throw new Error("Room name is required");
    }
    if (roomName.length > MAX_ROOM_NAME_LENGTH) {
      throw new Error(`Room name must be ${MAX_ROOM_NAME_LENGTH} characters or less`);
    }
    validateDisplayName(displayName);
    if (pin.length < PIN_MIN_LENGTH) {
      throw new Error(`Main driver PIN must be at least ${PIN_MIN_LENGTH} characters`);
    }

    const existingOperation = await ctx.db
      .query("rooms")
      .withIndex("by_creation_operation", (q) =>
        q.eq("creationOperationId", operationId),
      )
      .unique();
    if (existingOperation) {
      const existingParticipant = await getParticipantByToken(
        ctx,
        existingOperation._id,
        participantToken,
      );
      if (!existingParticipant?.isMainDriver) {
        throw new Error("Creation operation identifier is already in use");
      }
      return {
        roomId: existingOperation._id,
        participantId: existingParticipant._id,
        participantToken,
        replayed: true as const,
      };
    }

    const existing = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (existing) {
      throw new Error("Room code is already in use");
    }

    const now = Date.now();
    const pinSalt = createPinSalt();
    const pinHash = await hashPin(pin, pinSalt);
    const authTokenHash = await hashSecret(participantToken);

    const roomId = await ctx.db.insert("rooms", {
      code,
      name: roomName,
      creationOperationId: operationId,
      mainDriverPinHash: pinHash,
      mainDriverPinSalt: pinSalt,
      mainDriverPinHashVersion: 2,
      pinFailureCount: 0,
      createdAt: now,
      lastActivityAt: now,
    });

    const participantId = await ctx.db.insert("participants", {
      roomId,
      authTokenHash,
      displayName,
      isMainDriver: true,
      lastSeenAt: now,
      audioUnlocked: false,
      joinedAt: now,
    });

    await ctx.db.insert("room_state", {
      roomId,
      activeRequestId: null,
      nextSeq: 1,
    });

    return {
      roomId,
      participantId,
      participantToken,
      replayed: false as const,
    };
  },
});

export const joinRoom = mutation({
  args: {
    roomCode: v.string(),
    displayName: v.string(),
    participantToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const displayName = args.displayName.trim();
    validateDisplayName(displayName);

    const room = await getRoomByCode(ctx, args.roomCode);
    if (!room) {
      throw new ConvexError("Room not found");
    }

    const now = Date.now();
    const suppliedParticipantToken = args.participantToken
      ? validateParticipantToken(args.participantToken)
      : null;
    if (suppliedParticipantToken) {
      const existingParticipant = await getParticipantByToken(
        ctx,
        room._id,
        suppliedParticipantToken,
      );
      if (existingParticipant) {
        await ctx.db.patch(existingParticipant._id, {
          displayName,
          lastSeenAt: now,
        });
        await touchRoom(ctx, room._id, now);
        return {
          roomId: room._id,
          participantId: existingParticipant._id,
          participantToken: suppliedParticipantToken,
          isMainDriver: existingParticipant.isMainDriver,
        };
      }
    }

    const participantToken = suppliedParticipantToken ?? createSecretToken();
    const authTokenHash = await hashSecret(participantToken);
    const participantId = await ctx.db.insert("participants", {
      roomId: room._id,
      authTokenHash,
      displayName,
      isMainDriver: false,
      lastSeenAt: now,
      audioUnlocked: false,
      joinedAt: now,
    });
    await touchRoom(ctx, room._id, now);

    return {
      roomId: room._id,
      participantId,
      participantToken,
      isMainDriver: false,
    };
  },
});

export const claimMainDriver = mutation({
  args: {
    roomId: v.id("rooms"),
    pin: v.string(),
    participantToken: v.string(),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room) {
      throw new Error("Room not found");
    }
    const pin = args.pin.trim();
    if (!pin) {
      throw new Error("PIN is required");
    }

    const participant = await requireParticipant(ctx, room._id, args.participantToken);
    const now = Date.now();
    if ((room.pinLockedUntil ?? 0) > now) {
      const waitSeconds = Math.max(1, Math.ceil(((room.pinLockedUntil ?? now) - now) / 1_000));
      throw new Error(`Too many incorrect PIN attempts. Try again in ${waitSeconds} seconds.`);
    }

    let granted = false;
    if (room.mainDriverPinHashVersion === 2 && room.mainDriverPinSalt) {
      const candidate = await hashPin(pin, room.mainDriverPinSalt);
      granted = constantTimeEqual(candidate, room.mainDriverPinHash);
    } else {
      granted = constantTimeEqual(legacyHashPin(pin), room.mainDriverPinHash);
    }

    if (!granted) {
      const nextFailureCount = (room.pinFailureCount ?? 0) + 1;
      const shouldLock = nextFailureCount >= PIN_MAX_FAILURES;
      await ctx.db.patch(room._id, {
        pinFailureCount: shouldLock ? 0 : nextFailureCount,
        pinLockedUntil: shouldLock ? now + PIN_LOCKOUT_MS : undefined,
      });
      return { granted: false };
    }

    const roomPatch: Partial<Doc<"rooms">> = {
      pinFailureCount: 0,
      pinLockedUntil: undefined,
      lastActivityAt: now,
    };
    if (room.mainDriverPinHashVersion !== 2 || !room.mainDriverPinSalt) {
      const pinSalt = createPinSalt();
      roomPatch.mainDriverPinSalt = pinSalt;
      roomPatch.mainDriverPinHash = await hashPin(pin, pinSalt);
      roomPatch.mainDriverPinHashVersion = 2;
    }
    await ctx.db.patch(room._id, roomPatch);

    const roomParticipants = await ctx.db
      .query("participants")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    for (const roomParticipant of roomParticipants) {
      const shouldBeMainDriver = roomParticipant._id === participant._id;
      if (roomParticipant.isMainDriver !== shouldBeMainDriver) {
        await ctx.db.patch(roomParticipant._id, { isMainDriver: shouldBeMainDriver });
      }
    }

    return { granted: true };
  },
});

export const heartbeat = mutation({
  args: {
    roomId: v.id("rooms"),
    participantToken: v.string(),
    audioUnlocked: v.boolean(),
  },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx, args.roomId, args.participantToken);
    const now = Date.now();
    await ctx.db.patch(participant._id, {
      lastSeenAt: now,
      audioUnlocked: args.audioUnlocked,
    });
    await touchRoom(ctx, args.roomId, now);
    return { ok: true as const };
  },
});

export const getRoomState = query({
  args: {
    roomCode: v.string(),
    participantToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const room = await getRoomByCode(ctx, args.roomCode);
    if (!room) {
      return null;
    }

    const [buttons, queuedRequests, eventsDescending, roomState, currentParticipant] =
      await Promise.all([
        ctx.db
          .query("buttons")
          .withIndex("by_room_sort", (q) => q.eq("roomId", room._id))
          .collect(),
        ctx.db
          .query("requests")
          .withIndex("by_room_status_created", (q) =>
            q.eq("roomId", room._id).eq("status", "queued"),
          )
          .take(20),
        ctx.db
          .query("events")
          .withIndex("by_room_seq", (q) => q.eq("roomId", room._id))
          .order("desc")
          .take(50),
        getRoomStateRecord(ctx, room._id),
        args.participantToken
          ? getParticipantByToken(ctx, room._id, args.participantToken)
          : Promise.resolve(null),
      ]);

    const buttonLookup = new Map(buttons.map((button) => [String(button._id), button]));
    const buttonDtos = await Promise.all(
      buttons.map(async (button) => ({
        id: String(button._id),
        label: button.label,
        sortOrder: button.sortOrder,
        isEnabled: button.isEnabled,
        soundUrl: await ctx.storage.getUrl(button.soundStorageId),
      })),
    );

    const activeRequestValue = roomState?.activeRequestId
      ? await ctx.db.get(roomState.activeRequestId)
      : null;
    const activeRequest = isRequestDocLike(activeRequestValue) ? activeRequestValue : null;
    const activeRequestDto =
      activeRequest && activeRequest.status === "active"
        ? {
            id: String(activeRequest._id),
            buttonId: String(activeRequest.buttonId),
            buttonLabel:
              buttonLookup.get(String(activeRequest.buttonId))?.label ?? "Unavailable button",
            requestedByParticipantId: participantPublicId(
              activeRequest.requestedByParticipantId,
            ),
            createdAt: activeRequest.createdAt,
            activatedAt: activeRequest.activatedAt ?? null,
          }
        : null;

    const queueDtos = queuedRequests.map((request) => ({
      id: String(request._id),
      buttonId: String(request.buttonId),
      buttonLabel: buttonLookup.get(String(request.buttonId))?.label ?? "Unavailable button",
      requestedByParticipantId: participantPublicId(request.requestedByParticipantId),
      createdAt: request.createdAt,
    }));

    const events = [...eventsDescending].reverse().map((event) => ({
      seq: event.seq,
      type: event.type,
      requestId: String(event.requestId),
      buttonId: event.buttonId ? String(event.buttonId) : null,
      decision: event.decision ?? null,
      actorParticipantId: participantPublicId(event.actorParticipantId),
      createdAt: event.createdAt,
    }));

    return {
      room: {
        id: String(room._id),
        code: room.code,
        name: room.name,
      },
      buttons: buttonDtos,
      activeRequest: activeRequestDto,
      queue: queueDtos,
      outcomeSounds: {
        acceptUrl: room.acceptSoundStorageId
          ? await ctx.storage.getUrl(room.acceptSoundStorageId)
          : null,
        rejectUrl: room.rejectSoundStorageId
          ? await ctx.storage.getUrl(room.rejectSoundStorageId)
          : null,
      },
      currentParticipantId: currentParticipant ? String(currentParticipant._id) : null,
      isMainDriver: Boolean(currentParticipant?.isMainDriver),
      events,
    };
  },
});

export const getRoomPresence = query({
  args: { roomCode: v.string() },
  handler: async (ctx, args) => {
    const room = await getRoomByCode(ctx, args.roomCode);
    if (!room) {
      return [];
    }

    const participants = await ctx.db
      .query("participants")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    const now = Date.now();

    return participants
      .map((participant) => ({
        id: String(participant._id),
        displayName: participant.displayName,
        isMainDriver: participant.isMainDriver,
        lastSeenAt: participant.lastSeenAt,
        isActive: isParticipantActive(participant.lastSeenAt, now),
      }))
      .sort((left, right) => Number(right.isActive) - Number(left.isActive));
  },
});

export const listRecentEvents = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("events")
      .withIndex("by_room_seq", (q) => q.eq("roomId", args.roomId))
      .order("desc")
      .take(50);

    return [...events].reverse().map((event) => ({
      seq: event.seq,
      type: event.type,
      requestId: String(event.requestId),
      buttonId: event.buttonId ? String(event.buttonId) : null,
      decision: event.decision ?? null,
      actorParticipantId: participantPublicId(event.actorParticipantId),
      createdAt: event.createdAt,
    }));
  },
});
