import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  appendEvent,
  getOrCreateRoomState,
  promoteNextQueuedRequest,
  requireMainDriver,
  requireParticipant,
  touchRoom,
  trimRoomEvents,
} from "./lib/helpers";
import { MAX_QUEUE_LENGTH } from "./constants";

type RequestDocLike = Pick<
  Doc<"requests">,
  "_id" | "status" | "buttonId" | "requestedByParticipantId" | "createdAt" | "activatedAt"
>;

function isRequestDocLike(value: unknown): value is RequestDocLike {
  if (!value || typeof value !== "object") {
    return false;
  }
  return "status" in value && "buttonId" in value && "createdAt" in value;
}

function validateOperationId(operationId: string) {
  const normalized = operationId.trim();
  if (normalized.length < 8 || normalized.length > 100) {
    throw new Error("Invalid operation identifier");
  }
  return normalized;
}

export const enqueueRequest = mutation({
  args: {
    roomId: v.id("rooms"),
    buttonId: v.id("buttons"),
    participantToken: v.string(),
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    const participant = await requireParticipant(ctx, args.roomId, args.participantToken);
    const operationId = validateOperationId(args.operationId);

    const existingOperation = await ctx.db
      .query("requests")
      .withIndex("by_room_operation", (q) =>
        q.eq("roomId", args.roomId).eq("operationId", operationId),
      )
      .unique();
    if (existingOperation) {
      if (String(existingOperation.requestedByParticipantId) !== String(participant._id)) {
        throw new Error("Operation identifier is already in use");
      }
      return {
        requestId: existingOperation._id,
        status:
          existingOperation.status === "queued" ? ("queued" as const) : ("active" as const),
        replayed: true as const,
      };
    }

    const button = await ctx.db.get(args.buttonId);
    if (!button || String(button.roomId) !== String(args.roomId) || !button.isEnabled) {
      throw new Error("Button is not available");
    }

    const queued = await ctx.db
      .query("requests")
      .withIndex("by_room_status_created", (q) =>
        q.eq("roomId", args.roomId).eq("status", "queued"),
      )
      .take(MAX_QUEUE_LENGTH + 1);
    if (queued.length >= MAX_QUEUE_LENGTH) {
      throw new Error(`Queue limit reached (${MAX_QUEUE_LENGTH})`);
    }

    const roomState = await getOrCreateRoomState(ctx, args.roomId);
    const activeRequestValue = roomState.activeRequestId
      ? await ctx.db.get(roomState.activeRequestId)
      : null;
    const activeRequest = isRequestDocLike(activeRequestValue) ? activeRequestValue : null;
    const hasActiveRequest = Boolean(activeRequest && activeRequest.status === "active");
    const now = Date.now();

    const requestId = await ctx.db.insert("requests", {
      roomId: args.roomId,
      buttonId: args.buttonId,
      requestedByParticipantId: participant._id,
      operationId,
      status: hasActiveRequest ? "queued" : "active",
      createdAt: now,
      ...(hasActiveRequest ? {} : { activatedAt: now }),
    });

    if (!hasActiveRequest) {
      await ctx.db.patch(roomState._id, { activeRequestId: requestId });
      await appendEvent(ctx, args.roomId, {
        type: "request_started",
        requestId,
        buttonId: args.buttonId,
        actorParticipantId: participant._id,
      });
      await trimRoomEvents(ctx, args.roomId);
    }
    await touchRoom(ctx, args.roomId, now);

    return {
      requestId,
      status: hasActiveRequest ? ("queued" as const) : ("active" as const),
      replayed: false as const,
    };
  },
});

export const resolveActiveRequest = mutation({
  args: {
    roomId: v.id("rooms"),
    decision: v.union(v.literal("accepted"), v.literal("rejected")),
    participantToken: v.string(),
  },
  handler: async (ctx, args) => {
    const participant = await requireMainDriver(ctx, args.roomId, args.participantToken);
    const roomState = await getOrCreateRoomState(ctx, args.roomId);

    if (!roomState.activeRequestId) {
      throw new Error("No active request to resolve");
    }

    const activeRequestValue = await ctx.db.get(roomState.activeRequestId);
    const activeRequest = isRequestDocLike(activeRequestValue) ? activeRequestValue : null;
    if (!activeRequest || activeRequest.status !== "active") {
      await ctx.db.patch(roomState._id, { activeRequestId: null });
      throw new Error("Active request is no longer available");
    }

    const resolvedAt = Date.now();
    await ctx.db.patch(activeRequest._id, {
      status: args.decision,
      resolvedAt,
      resolvedBySessionId: undefined,
    });
    await ctx.db.patch(roomState._id, { activeRequestId: null });

    await appendEvent(ctx, args.roomId, {
      type: "request_resolved",
      requestId: activeRequest._id,
      buttonId: activeRequest.buttonId,
      decision: args.decision,
      actorParticipantId: participant._id,
    });

    const nextActiveRequestId = await promoteNextQueuedRequest(ctx, args.roomId);
    await trimRoomEvents(ctx, args.roomId);
    await touchRoom(ctx, args.roomId, resolvedAt);

    return nextActiveRequestId
      ? { resolvedRequestId: activeRequest._id, nextActiveRequestId }
      : { resolvedRequestId: activeRequest._id };
  },
});
