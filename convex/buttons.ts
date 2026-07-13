import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { hashSecret, requireMainDriver, touchRoom } from "./lib/helpers";
import {
  MAX_BUTTON_LABEL_LENGTH,
  MAX_BUTTONS_PER_ROOM,
  MAX_UPLOAD_BYTES,
} from "./constants";

const TEMPLATE_NAME_MAX_LENGTH = 80;

function normalizeTemplateName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeButtonLabel(value: string) {
  const label = value.trim().replace(/\s+/g, " ");
  if (!label) {
    throw new Error("Button label is required");
  }
  if (label.length > MAX_BUTTON_LABEL_LENGTH) {
    throw new Error(`Button label must be ${MAX_BUTTON_LABEL_LENGTH} characters or less`);
  }
  return label;
}

function validateOperationId(value: string) {
  const operationId = value.trim();
  if (operationId.length < 8 || operationId.length > 100) {
    throw new Error("Invalid operation identifier");
  }
  return operationId;
}

async function validateMediaStorage(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
) {
  const metadata = await ctx.storage.getMetadata(storageId);
  if (!metadata) {
    throw new Error("Uploaded media was not found");
  }
  if (metadata.size <= 0 || metadata.size > MAX_UPLOAD_BYTES) {
    throw new Error(`Media must be smaller than ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`);
  }
  const contentType = (metadata.contentType ?? "").toLowerCase();
  if (!contentType.startsWith("audio/") && !contentType.startsWith("video/")) {
    throw new Error("Uploaded file must be audio or video media");
  }
}

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

async function deleteStorageIfUnreferenced(
  ctx: MutationCtx,
  storageId: Id<"_storage"> | null | undefined,
) {
  if (!storageId || await isStorageReferenced(ctx, storageId)) {
    return false;
  }
  await ctx.storage.delete(storageId);
  return true;
}

export const createButton = mutation({
  args: {
    roomId: v.id("rooms"),
    label: v.string(),
    fileStorageId: v.id("_storage"),
    sortOrder: v.optional(v.number()),
    participantToken: v.string(),
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMainDriver(ctx, args.roomId, args.participantToken);
    const label = normalizeButtonLabel(args.label);
    const operationId = validateOperationId(args.operationId);

    const existingOperation = await ctx.db
      .query("buttons")
      .withIndex("by_room_operation", (q) =>
        q.eq("roomId", args.roomId).eq("operationId", operationId),
      )
      .unique();
    if (existingOperation) {
      return { buttonId: existingOperation._id, replayed: true as const };
    }

    const buttons = await ctx.db
      .query("buttons")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .take(MAX_BUTTONS_PER_ROOM + 1);
    if (buttons.length >= MAX_BUTTONS_PER_ROOM) {
      throw new Error(`A room can have at most ${MAX_BUTTONS_PER_ROOM} buttons`);
    }

    await validateMediaStorage(ctx, args.fileStorageId);
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
      operationId,
      sortOrder,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await touchRoom(ctx, args.roomId, now);
    return { buttonId, replayed: false as const };
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
    participantToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMainDriver(ctx, args.roomId, args.participantToken);
    const button = await ctx.db.get(args.buttonId);
    if (!button || String(button.roomId) !== String(args.roomId)) {
      throw new Error("Button not found");
    }

    const patch: {
      label?: string;
      soundStorageId?: Id<"_storage">;
      sortOrder?: number;
      isEnabled?: boolean;
      updatedAt: number;
    } = { updatedAt: Date.now() };

    if (args.label != null) {
      patch.label = normalizeButtonLabel(args.label);
    }
    if (args.fileStorageId != null) {
      await validateMediaStorage(ctx, args.fileStorageId);
      patch.soundStorageId = args.fileStorageId;
    }
    if (args.sortOrder != null) {
      patch.sortOrder = args.sortOrder;
    }
    if (args.isEnabled != null) {
      patch.isEnabled = args.isEnabled;
    }

    await ctx.db.patch(args.buttonId, patch);
    if (
      args.fileStorageId &&
      String(args.fileStorageId) !== String(button.soundStorageId)
    ) {
      await deleteStorageIfUnreferenced(ctx, button.soundStorageId);
    }
    await touchRoom(ctx, args.roomId, patch.updatedAt);
    return { ok: true as const };
  },
});

export const deleteButton = mutation({
  args: {
    roomId: v.id("rooms"),
    buttonId: v.id("buttons"),
    participantToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMainDriver(ctx, args.roomId, args.participantToken);
    const button = await ctx.db.get(args.buttonId);
    if (!button || String(button.roomId) !== String(args.roomId)) {
      throw new Error("Button not found");
    }

    const [activeRequests, queuedRequests] = await Promise.all([
      ctx.db
        .query("requests")
        .withIndex("by_room_status_created", (q) =>
          q.eq("roomId", args.roomId).eq("status", "active"),
        )
        .collect(),
      ctx.db
        .query("requests")
        .withIndex("by_room_status_created", (q) =>
          q.eq("roomId", args.roomId).eq("status", "queued"),
        )
        .collect(),
    ]);
    const inUse = [...activeRequests, ...queuedRequests].some(
      (request) => String(request.buttonId) === String(args.buttonId),
    );
    if (inUse) {
      throw new Error("Cannot delete a button while it has an active or queued request");
    }

    await ctx.db.delete(args.buttonId);
    await deleteStorageIfUnreferenced(ctx, button.soundStorageId);
    await touchRoom(ctx, args.roomId);
    return { ok: true as const };
  },
});

export const setOutcomeSounds = mutation({
  args: {
    roomId: v.id("rooms"),
    acceptStorageId: v.union(v.id("_storage"), v.null()),
    rejectStorageId: v.union(v.id("_storage"), v.null()),
    participantToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMainDriver(ctx, args.roomId, args.participantToken);
    const room = await ctx.db.get(args.roomId);
    if (!room) {
      throw new Error("Room not found");
    }
    if (args.acceptStorageId) {
      await validateMediaStorage(ctx, args.acceptStorageId);
    }
    if (args.rejectStorageId) {
      await validateMediaStorage(ctx, args.rejectStorageId);
    }

    await ctx.db.patch(args.roomId, {
      acceptSoundStorageId: args.acceptStorageId ?? undefined,
      rejectSoundStorageId: args.rejectStorageId ?? undefined,
      lastActivityAt: Date.now(),
    });
    if (String(room.acceptSoundStorageId ?? "") !== String(args.acceptStorageId ?? "")) {
      await deleteStorageIfUnreferenced(ctx, room.acceptSoundStorageId);
    }
    if (String(room.rejectSoundStorageId ?? "") !== String(args.rejectStorageId ?? "")) {
      await deleteStorageIfUnreferenced(ctx, room.rejectSoundStorageId);
    }
    return { ok: true as const };
  },
});

export const listTemplates = query({
  args: { ownerToken: v.string() },
  handler: async (ctx, args) => {
    const ownerTokenHash = await hashSecret(args.ownerToken);
    const templates = await ctx.db
      .query("templates")
      .withIndex("by_owner_token_updated", (q) => q.eq("ownerTokenHash", ownerTokenHash))
      .order("desc")
      .collect();

    return templates.map((template) => ({
      id: String(template._id),
      name: template.name,
      buttonCount: template.buttonCount,
      hasOutcomeSounds: Boolean(template.acceptSoundStorageId || template.rejectSoundStorageId),
      updatedAt: template.updatedAt,
    }));
  },
});

export const saveRoomAsTemplate = mutation({
  args: {
    roomId: v.id("rooms"),
    participantToken: v.string(),
    ownerToken: v.string(),
    templateName: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMainDriver(ctx, args.roomId, args.participantToken);
    const templateName = normalizeTemplateName(args.templateName);
    if (!templateName) {
      throw new Error("Template name is required");
    }
    if (templateName.length > TEMPLATE_NAME_MAX_LENGTH) {
      throw new Error(`Template name must be ${TEMPLATE_NAME_MAX_LENGTH} characters or less`);
    }

    const [room, roomButtons, ownerTokenHash] = await Promise.all([
      ctx.db.get(args.roomId),
      ctx.db
        .query("buttons")
        .withIndex("by_room_sort", (q) => q.eq("roomId", args.roomId))
        .collect(),
      hashSecret(args.ownerToken),
    ]);
    if (!room) {
      throw new Error("Room not found");
    }
    if (!roomButtons.length && !room.acceptSoundStorageId && !room.rejectSoundStorageId) {
      throw new Error("Nothing to save yet. Add buttons or outcome sounds first.");
    }

    const now = Date.now();
    const existingTemplate = await ctx.db
      .query("templates")
      .withIndex("by_owner_token_name", (q) =>
        q.eq("ownerTokenHash", ownerTokenHash).eq("name", templateName),
      )
      .unique();

    let templateId = existingTemplate?._id;
    const replaced = Boolean(templateId);
    const replacedStorageIds = new Set<Id<"_storage">>();
    if (templateId) {
      const existingButtons = await ctx.db
        .query("template_buttons")
        .withIndex("by_template", (q) => q.eq("templateId", templateId as Id<"templates">))
        .collect();
      for (const button of existingButtons) {
        replacedStorageIds.add(button.soundStorageId);
        await ctx.db.delete(button._id);
      }
      if (existingTemplate?.acceptSoundStorageId) {
        replacedStorageIds.add(existingTemplate.acceptSoundStorageId);
      }
      if (existingTemplate?.rejectSoundStorageId) {
        replacedStorageIds.add(existingTemplate.rejectSoundStorageId);
      }
      await ctx.db.patch(templateId, {
        buttonCount: roomButtons.length,
        acceptSoundStorageId: room.acceptSoundStorageId ?? null,
        rejectSoundStorageId: room.rejectSoundStorageId ?? null,
        updatedAt: now,
      });
    } else {
      templateId = await ctx.db.insert("templates", {
        ownerTokenHash,
        name: templateName,
        buttonCount: roomButtons.length,
        acceptSoundStorageId: room.acceptSoundStorageId ?? null,
        rejectSoundStorageId: room.rejectSoundStorageId ?? null,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const button of roomButtons) {
      await ctx.db.insert("template_buttons", {
        templateId,
        label: button.label,
        soundStorageId: button.soundStorageId,
        sortOrder: button.sortOrder,
        isEnabled: button.isEnabled,
        createdAt: now,
      });
    }
    for (const storageId of replacedStorageIds) {
      await deleteStorageIfUnreferenced(ctx, storageId);
    }

    return { templateId, replaced, buttonCount: roomButtons.length };
  },
});

export const applyTemplateToRoom = mutation({
  args: {
    roomId: v.id("rooms"),
    templateId: v.id("templates"),
    participantToken: v.string(),
    ownerToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMainDriver(ctx, args.roomId, args.participantToken);
    const ownerTokenHash = await hashSecret(args.ownerToken);
    const [template, room] = await Promise.all([
      ctx.db.get(args.templateId),
      ctx.db.get(args.roomId),
    ]);
    if (!template || template.ownerTokenHash !== ownerTokenHash) {
      throw new Error("Template not found");
    }
    if (!room) {
      throw new Error("Room not found");
    }

    const [activeRequest, queuedRequest] = await Promise.all([
      ctx.db
        .query("requests")
        .withIndex("by_room_status_created", (q) =>
          q.eq("roomId", args.roomId).eq("status", "active"),
        )
        .take(1),
      ctx.db
        .query("requests")
        .withIndex("by_room_status_created", (q) =>
          q.eq("roomId", args.roomId).eq("status", "queued"),
        )
        .take(1),
    ]);
    if (activeRequest.length || queuedRequest.length) {
      throw new Error("Cannot apply template while requests are active or queued");
    }

    const [existingButtons, templateButtons] = await Promise.all([
      ctx.db
        .query("buttons")
        .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
        .collect(),
      ctx.db
        .query("template_buttons")
        .withIndex("by_template_sort", (q) => q.eq("templateId", args.templateId))
        .collect(),
    ]);
    if (templateButtons.length > MAX_BUTTONS_PER_ROOM) {
      throw new Error(`Template exceeds the ${MAX_BUTTONS_PER_ROOM}-button room limit`);
    }

    const replacedStorageIds = new Set<Id<"_storage">>();
    for (const button of existingButtons) {
      replacedStorageIds.add(button.soundStorageId);
      await ctx.db.delete(button._id);
    }
    if (room.acceptSoundStorageId) {
      replacedStorageIds.add(room.acceptSoundStorageId);
    }
    if (room.rejectSoundStorageId) {
      replacedStorageIds.add(room.rejectSoundStorageId);
    }

    const now = Date.now();
    for (const button of templateButtons) {
      await ctx.db.insert("buttons", {
        roomId: args.roomId,
        label: button.label,
        soundStorageId: button.soundStorageId,
        sortOrder: button.sortOrder,
        isEnabled: button.isEnabled,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch(args.roomId, {
      acceptSoundStorageId: template.acceptSoundStorageId ?? undefined,
      rejectSoundStorageId: template.rejectSoundStorageId ?? undefined,
      lastActivityAt: now,
    });
    for (const storageId of replacedStorageIds) {
      await deleteStorageIfUnreferenced(ctx, storageId);
    }

    return { appliedButtonCount: templateButtons.length };
  },
});

export const deleteTemplate = mutation({
  args: {
    templateId: v.id("templates"),
    ownerToken: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerTokenHash = await hashSecret(args.ownerToken);
    const template = await ctx.db.get(args.templateId);
    if (!template || template.ownerTokenHash !== ownerTokenHash) {
      throw new Error("Template not found");
    }

    const templateButtons = await ctx.db
      .query("template_buttons")
      .withIndex("by_template", (q) => q.eq("templateId", args.templateId))
      .collect();
    const storageIds = new Set<Id<"_storage">>();
    for (const button of templateButtons) {
      storageIds.add(button.soundStorageId);
      await ctx.db.delete(button._id);
    }
    if (template.acceptSoundStorageId) {
      storageIds.add(template.acceptSoundStorageId);
    }
    if (template.rejectSoundStorageId) {
      storageIds.add(template.rejectSoundStorageId);
    }
    await ctx.db.delete(args.templateId);
    for (const storageId of storageIds) {
      await deleteStorageIfUnreferenced(ctx, storageId);
    }
    return { ok: true as const };
  },
});
