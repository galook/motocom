import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  getOrCreateRoomState,
  getParticipant,
  getRoomByCode,
  hashPin,
  isParticipantActive,
  normalizeRoomCode,
} from "./lib/helpers";

type RequestDocLike = {
  _id: string;
  status: "queued" | "active" | "accepted" | "rejected";
  buttonId: string;
  requestedBySessionId: string;
  createdAt: number;
  activatedAt?: number;
};

function isRequestDocLike(value: unknown): value is RequestDocLike {
  if (!value || typeof value !== "object") {
    return false;
  }
  return (
    "status" in value &&
    "buttonId" in value &&
    "requestedBySessionId" in value &&
    "createdAt" in value
  );
}

export const createRoom = mutation({
  args: {
    roomCode: v.string(),
    roomName: v.string(),
    displayName: v.string(),
    mainDriverPin: v.string(),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const code = normalizeRoomCode(args.roomCode);
    const roomName = args.roomName.trim();
    const displayName = args.displayName.trim();
    if (code.length < 3) {
      throw new Error("Room code must be at least 3 characters");
    }
    if (!roomName) {
      throw new Error("Room name is required");
    }
    if (!displayName) {
      throw new Error("Display name is required");
    }
    if (args.mainDriverPin.trim().length < 4) {
      throw new Error("Main driver PIN must be at least 4 characters");
    }

    const existing = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();

    if (existing) {
      throw new Error("Room code is already in use");
    }

    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", {
      code,
      name: roomName,
      mainDriverPinHash: hashPin(args.mainDriverPin),
      createdAt: now,
    });

    const participantId = await ctx.db.insert("participants", {
      roomId,
      sessionId: args.sessionId,
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

    return { roomId, participantId };
  },
});

export const joinRoom = mutation({
  args: {
    roomCode: v.string(),
    displayName: v.string(),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const displayName = args.displayName.trim();
    if (!displayName) {
      throw new Error("Display name is required");
    }

    const room = await getRoomByCode(ctx, args.roomCode);
    if (!room) {
      throw new Error("Room not found");
    }

    const now = Date.now();
    const existingParticipant = await getParticipant(ctx, room._id, args.sessionId);

    if (existingParticipant) {
      await ctx.db.patch(existingParticipant._id, {
        displayName,
        lastSeenAt: now,
      });
      return {
        roomId: room._id,
        participantId: existingParticipant._id,
        isMainDriver: existingParticipant.isMainDriver,
      };
    }

    const participantId = await ctx.db.insert("participants", {
      roomId: room._id,
      sessionId: args.sessionId,
      displayName,
      isMainDriver: false,
      lastSeenAt: now,
      audioUnlocked: false,
      joinedAt: now,
    });

    return { roomId: room._id, participantId, isMainDriver: false };
  },
});

export const claimMainDriver = mutation({
  args: {
    roomId: v.id("rooms"),
    pin: v.string(),
    sessionId: v.string(),
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

    const participant = await getParticipant(ctx, room._id, args.sessionId);
    if (!participant) {
      throw new Error("Participant not found");
    }

    const granted = hashPin(pin) === room.mainDriverPinHash;
    if (!granted) {
      return { granted: false };
    }

    if (!participant.isMainDriver) {
      await ctx.db.patch(participant._id, {
        isMainDriver: true,
      });
    }

    return { granted: true };
  },
});

export const heartbeat = mutation({
  args: {
    roomId: v.id("rooms"),
    sessionId: v.string(),
    audioUnlocked: v.boolean(),
  },
  handler: async (ctx, args) => {
    const participant = await getParticipant(ctx, args.roomId, args.sessionId);
    if (!participant) {
      throw new Error("Participant not found");
    }

    await ctx.db.patch(participant._id, {
      lastSeenAt: Date.now(),
      audioUnlocked: args.audioUnlocked,
    });

    return { ok: true as const };
  },
});

export const getRoomState = query({
  args: {
    roomCode: v.string(),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const room = await getRoomByCode(ctx, args.roomCode);
    if (!room) {
      return null;
    }

    const [buttons, participants, queuedRequests, eventsDescending] = await Promise.all([
      ctx.db
        .query("buttons")
        .withIndex("by_room_sort", (q) => q.eq("roomId", room._id))
        .collect(),
      ctx.db
        .query("participants")
        .withIndex("by_room", (q) => q.eq("roomId", room._id))
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

    const roomState = await getOrCreateRoomState(ctx, room._id);
    const activeRequestValue = roomState.activeRequestId
      ? await ctx.db.get(roomState.activeRequestId)
      : null;
    const activeRequest = isRequestDocLike(activeRequestValue) ? activeRequestValue : null;

    const activeRequestDto =
      activeRequest && activeRequest.status === "active"
        ? {
            id: String(activeRequest._id),
            buttonId: String(activeRequest.buttonId),
            buttonLabel:
              buttonLookup.get(String(activeRequest.buttonId))?.label ?? "Unknown button",
            requestedBySessionId: activeRequest.requestedBySessionId,
            createdAt: activeRequest.createdAt,
            activatedAt: activeRequest.activatedAt ?? null,
          }
        : null;

    const queueDtos = queuedRequests.map((request) => ({
      id: String(request._id),
      buttonId: String(request.buttonId),
      buttonLabel: buttonLookup.get(String(request.buttonId))?.label ?? "Unknown button",
      requestedBySessionId: request.requestedBySessionId,
      createdAt: request.createdAt,
    }));

    const now = Date.now();
    const participantDtos = participants
      .map((participant) => ({
        sessionId: participant.sessionId,
        displayName: participant.displayName,
        isMainDriver: participant.isMainDriver,
        lastSeenAt: participant.lastSeenAt,
        isActive: isParticipantActive(participant.lastSeenAt, now),
      }))
      .sort((left, right) => Number(right.isActive) - Number(left.isActive));

    const currentParticipant =
      args.sessionId != null
        ? participants.find((participant) => participant.sessionId === args.sessionId)
        : null;

    const events = [...eventsDescending]
      .reverse()
      .map((event) => ({
        seq: event.seq,
        type: event.type,
        requestId: String(event.requestId),
        buttonId: event.buttonId ? String(event.buttonId) : null,
        decision: event.decision ?? null,
        actorSessionId: event.actorSessionId,
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
      participants: participantDtos,
      outcomeSounds: {
        acceptUrl: room.acceptSoundStorageId
          ? await ctx.storage.getUrl(room.acceptSoundStorageId)
          : null,
        rejectUrl: room.rejectSoundStorageId
          ? await ctx.storage.getUrl(room.rejectSoundStorageId)
          : null,
      },
      isMainDriver: Boolean(currentParticipant?.isMainDriver),
      events,
    };
  },
});

export const listRecentEvents = query({
  args: {
    roomId: v.id("rooms"),
  },
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
      actorSessionId: event.actorSessionId,
      createdAt: event.createdAt,
    }));
  },
});

export const listActiveRooms = query({
  args: {},
  handler: async (ctx) => {
    const rooms = await ctx.db.query("rooms").collect();
    const now = Date.now();

    const roomSummaries = await Promise.all(
      rooms.map(async (room) => {
        const participants = await ctx.db
          .query("participants")
          .withIndex("by_room", (q) => q.eq("roomId", room._id))
          .collect();

        const activeParticipants = participants.filter((participant) =>
          isParticipantActive(participant.lastSeenAt, now),
        );

        const lastActivityAt = participants.reduce(
          (max, participant) => Math.max(max, participant.lastSeenAt),
          0,
        );

        return {
          id: String(room._id),
          code: room.code,
          name: room.name,
          activeParticipants: activeParticipants.length,
          lastActivityAt,
        };
      }),
    );

    return roomSummaries
      .filter((room) => room.activeParticipants > 0)
      .sort((left, right) => {
        if (right.activeParticipants !== left.activeParticipants) {
          return right.activeParticipants - left.activeParticipants;
        }
        return right.lastActivityAt - left.lastActivityAt;
      });
  },
});
