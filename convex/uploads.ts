import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireMainDriver } from "./lib/helpers";

export const generateUploadUrl = mutation({
  args: {
    roomId: v.id("rooms"),
    participantToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMainDriver(ctx, args.roomId, args.participantToken);
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { uploadUrl };
  },
});

export const discardUnattachedUpload = mutation({
  args: {
    roomId: v.id("rooms"),
    participantToken: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requireMainDriver(ctx, args.roomId, args.participantToken);
    const [button, templateButton, acceptRoom, rejectRoom] = await Promise.all([
      ctx.db
        .query("buttons")
        .withIndex("by_sound_storage", (q) => q.eq("soundStorageId", args.storageId))
        .first(),
      ctx.db
        .query("template_buttons")
        .withIndex("by_sound_storage", (q) => q.eq("soundStorageId", args.storageId))
        .first(),
      ctx.db
        .query("rooms")
        .withIndex("by_accept_storage", (q) => q.eq("acceptSoundStorageId", args.storageId))
        .first(),
      ctx.db
        .query("rooms")
        .withIndex("by_reject_storage", (q) => q.eq("rejectSoundStorageId", args.storageId))
        .first(),
    ]);

    if (button || templateButton || acceptRoom || rejectRoom) {
      return { deleted: false as const };
    }

    const metadata = await ctx.storage.getMetadata(args.storageId);
    if (metadata) {
      await ctx.storage.delete(args.storageId);
    }
    return { deleted: true as const };
  },
});
