import { v } from "convex/values";
import { mutation } from "./_generated/server";
import {
  appendEvent,
  getOrCreateRoomState,
  promoteNextQueuedRequest,
  requireMainDriver,
  requireParticipant,
  trimRoomEvents,
} from "./lib/helpers";
import { MAX_QUEUE_LENGTH } from "./constants";

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

export const enqueueRequest = mutation({
  args: {
    roomId: v.id("rooms"),
    buttonId: v.id("buttons"),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireParticipant(ctx, args.roomId, args.sessionId);

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
      requestedBySessionId: args.sessionId,
      status: hasActiveRequest ? "queued" : "active",
      createdAt: now,
      ...(hasActiveRequest ? {} : { activatedAt: now }),
    });

    if (!hasActiveRequest) {
      await ctx.db.patch(roomState._id, {
        activeRequestId: requestId,
      });

      await appendEvent(ctx, args.roomId, {
        type: "request_started",
        requestId,
        buttonId: args.buttonId,
        actorSessionId: args.sessionId,
      });
      await trimRoomEvents(ctx, args.roomId);
    }

    return {
      requestId,
      status: hasActiveRequest ? ("queued" as const) : ("active" as const),
    };
  },
});

export const resolveActiveRequest = mutation({
  args: {
    roomId: v.id("rooms"),
    decision: v.union(v.literal("accepted"), v.literal("rejected")),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMainDriver(ctx, args.roomId, args.sessionId);

    const roomState = await getOrCreateRoomState(ctx, args.roomId);

    if (!roomState.activeRequestId) {
      throw new Error("No active request to resolve");
    }

    const activeRequestValue = await ctx.db.get(roomState.activeRequestId);
    const activeRequest = isRequestDocLike(activeRequestValue) ? activeRequestValue : null;
    if (!activeRequest || activeRequest.status !== "active") {
      await ctx.db.patch(roomState._id, {
        activeRequestId: null,
      });
      throw new Error("Active request is no longer available");
    }

    const resolvedAt = Date.now();
    await ctx.db.patch(activeRequest._id, {
      status: args.decision,
      resolvedAt,
      resolvedBySessionId: args.sessionId,
    });

    await ctx.db.patch(roomState._id, {
      activeRequestId: null,
    });

    await appendEvent(ctx, args.roomId, {
      type: "request_resolved",
      requestId: activeRequest._id,
      buttonId: activeRequest.buttonId,
      decision: args.decision,
      actorSessionId: args.sessionId,
    });

    const nextActiveRequestId = await promoteNextQueuedRequest(ctx, args.roomId);
    await trimRoomEvents(ctx, args.roomId);

    return nextActiveRequestId
      ? {
          resolvedRequestId: activeRequest._id,
          nextActiveRequestId,
        }
      : {
          resolvedRequestId: activeRequest._id,
        };
  },
});
