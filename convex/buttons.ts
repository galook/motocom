import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireMainDriver } from "./lib/helpers";

export const createButton = mutation({
  args: {
    roomId: v.id("rooms"),
    label: v.string(),
    fileStorageId: v.id("_storage"),
    sortOrder: v.optional(v.number()),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMainDriver(ctx, args.roomId, args.sessionId);
    const label = args.label.trim();
    if (!label) {
      throw new Error("Button label is required");
    }

    const now = Date.now();
    let sortOrder = args.sortOrder;

    if (sortOrder == null) {
      const [lastButton] = await ctx.db
        .query("buttons")
        .withIndex("by_room_sort", (q) => q.eq("roomId", args.roomId))
        .order("desc")
        .take(1);
      sortOrder = lastButton ? lastButton.sortOrder + 1 : 0;
    }

    const buttonId = await ctx.db.insert("buttons", {
      roomId: args.roomId,
      label,
      soundStorageId: args.fileStorageId,
      sortOrder,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    });

    return { buttonId };
  },
});

export const updateButton = mutation({
  args: {
    roomId: v.id("rooms"),
    buttonId: v.id("buttons"),
    label: v.optional(v.string()),
    fileStorageId: v.optional(v.id("_storage")),
    sortOrder: v.optional(v.number()),
    isEnabled: v.optional(v.boolean()),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMainDriver(ctx, args.roomId, args.sessionId);

    const button = await ctx.db.get(args.buttonId);
    if (!button || String(button.roomId) !== String(args.roomId)) {
      throw new Error("Button not found");
    }

    const patch: Record<string, unknown> = {
      updatedAt: Date.now(),
    };

    if (args.label != null) {
      const label = args.label.trim();
      if (!label) {
        throw new Error("Button label is required");
      }
      patch.label = label;
    }
    if (args.fileStorageId != null) {
      patch.soundStorageId = args.fileStorageId;
    }
    if (args.sortOrder != null) {
      patch.sortOrder = args.sortOrder;
    }
    if (args.isEnabled != null) {
      patch.isEnabled = args.isEnabled;
    }

    await ctx.db.patch(args.buttonId, patch);
    return { ok: true as const };
  },
});

export const deleteButton = mutation({
  args: {
    roomId: v.id("rooms"),
    buttonId: v.id("buttons"),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMainDriver(ctx, args.roomId, args.sessionId);

    const button = await ctx.db.get(args.buttonId);
    if (!button || String(button.roomId) !== String(args.roomId)) {
      throw new Error("Button not found");
    }

    const activeRequestsUsingButton = await ctx.db
      .query("requests")
      .withIndex("by_room_status_created", (q) =>
        q.eq("roomId", args.roomId).eq("status", "active"),
      )
      .collect();

    if (
      activeRequestsUsingButton.some(
        (request) => String(request.buttonId) === String(args.buttonId),
      )
    ) {
      throw new Error("Cannot delete a button while it is active");
    }

    await ctx.db.delete(args.buttonId);
    return { ok: true as const };
  },
});

export const setOutcomeSounds = mutation({
  args: {
    roomId: v.id("rooms"),
    acceptStorageId: v.id("_storage"),
    rejectStorageId: v.id("_storage"),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMainDriver(ctx, args.roomId, args.sessionId);

    await ctx.db.patch(args.roomId, {
      acceptSoundStorageId: args.acceptStorageId,
      rejectSoundStorageId: args.rejectStorageId,
    });

    return { ok: true as const };
  },
});
