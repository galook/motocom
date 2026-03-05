import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireMainDriver } from "./lib/helpers";

export const generateUploadUrl = mutation({
  args: {
    roomId: v.id("rooms"),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMainDriver(ctx, args.roomId, args.sessionId);

    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { uploadUrl };
  },
});
