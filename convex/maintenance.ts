import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";

const ROOM_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_ROOMS_PER_RUN = 5;

async function isStorageReferenced(ctx: MutationCtx, storageId: Id<"_storage">) {
  const [button, templateButton, acceptRoom, rejectRoom] = await Promise.all([
    ctx.db
      .query("buttons")
      .withIndex("by_sound_storage", (q) => q.eq("soundStorageId", storageId))
      .first(),
    ctx.db
      .query("template_buttons")
      .withIndex("by_sound_storage", (q) => q.eq("soundStorageId", storageId))
      .first(),
    ctx.db
      .query("rooms")
      .withIndex("by_accept_storage", (q) => q.eq("acceptSoundStorageId", storageId))
      .first(),
    ctx.db
      .query("rooms")
      .withIndex("by_reject_storage", (q) => q.eq("rejectSoundStorageId", storageId))
      .first(),
  ]);

  return Boolean(button || templateButton || acceptRoom || rejectRoom);
}

async function deleteRoomData(ctx: MutationCtx, roomId: Id<"rooms">) {
  const room = await ctx.db.get(roomId);
  if (!room) {
    return { deleted: false, storageIds: [] as Id<"_storage">[] };
  }

  const [buttons, participants, requests, events, roomStates] = await Promise.all([
    ctx.db
      .query("buttons")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect(),
    ctx.db
      .query("participants")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect(),
    ctx.db
      .query("requests")
      .withIndex("by_room_created", (q) => q.eq("roomId", roomId))
      .collect(),
    ctx.db
      .query("events")
      .withIndex("by_room_seq", (q) => q.eq("roomId", roomId))
      .collect(),
    ctx.db
      .query("room_state")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect(),
  ]);

  const storageIds = new Set<Id<"_storage">>();
  for (const button of buttons) {
    storageIds.add(button.soundStorageId);
    await ctx.db.delete(button._id);
  }
  if (room.acceptSoundStorageId) {
    storageIds.add(room.acceptSoundStorageId);
  }
  if (room.rejectSoundStorageId) {
    storageIds.add(room.rejectSoundStorageId);
  }

  for (const event of events) {
    await ctx.db.delete(event._id);
  }
  for (const request of requests) {
    await ctx.db.delete(request._id);
  }
  for (const participant of participants) {
    await ctx.db.delete(participant._id);
  }
  for (const state of roomStates) {
    await ctx.db.delete(state._id);
  }
  await ctx.db.delete(roomId);

  return { deleted: true, storageIds: [...storageIds] };
}

export const cleanupExpiredData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - ROOM_RETENTION_MS;
    const indexedCandidates = await ctx.db
      .query("rooms")
      .withIndex("by_last_activity", (q) => q.lt("lastActivityAt", cutoff))
      .take(MAX_ROOMS_PER_RUN);

    // Legacy rooms may not yet have lastActivityAt. Inspect only a small bounded set.
    const legacyCandidates = indexedCandidates.length >= MAX_ROOMS_PER_RUN
      ? []
      : (await ctx.db.query("rooms").take(MAX_ROOMS_PER_RUN * 2)).filter(
          (room) => room.lastActivityAt == null && room.createdAt < cutoff,
        );

    const candidates = [...indexedCandidates, ...legacyCandidates]
      .filter(
        (room, index, all) =>
          all.findIndex((candidate) => String(candidate._id) === String(room._id)) === index,
      )
      .slice(0, MAX_ROOMS_PER_RUN);

    const candidateStorageIds = new Set<Id<"_storage">>();
    let deletedRooms = 0;
    for (const room of candidates) {
      const result = await deleteRoomData(ctx, room._id);
      if (!result.deleted) {
        continue;
      }
      deletedRooms += 1;
      for (const storageId of result.storageIds) {
        candidateStorageIds.add(storageId);
      }
    }

    let deletedFiles = 0;
    for (const storageId of candidateStorageIds) {
      if (await isStorageReferenced(ctx, storageId)) {
        continue;
      }
      await ctx.storage.delete(storageId);
      deletedFiles += 1;
    }

    return {
      deletedRooms,
      deletedFiles,
      checkedRooms: candidates.length,
    };
  },
});
