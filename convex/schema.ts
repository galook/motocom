import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const requestStatus = v.union(
  v.literal("queued"),
  v.literal("active"),
  v.literal("accepted"),
  v.literal("rejected"),
);

const eventType = v.union(
  v.literal("request_started"),
  v.literal("request_resolved"),
);

const decisionType = v.union(v.literal("accepted"), v.literal("rejected"));

export default defineSchema({
  rooms: defineTable({
    code: v.string(),
    name: v.string(),
    creationOperationId: v.optional(v.string()),
    mainDriverPinHash: v.string(),
    mainDriverPinSalt: v.optional(v.string()),
    mainDriverPinHashVersion: v.optional(v.number()),
    pinFailureCount: v.optional(v.number()),
    pinLockedUntil: v.optional(v.number()),
    acceptSoundStorageId: v.optional(v.id("_storage")),
    rejectSoundStorageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
    lastActivityAt: v.optional(v.number()),
  })
    .index("by_code", ["code"])
    .index("by_creation_operation", ["creationOperationId"])
    .index("by_last_activity", ["lastActivityAt"])
    .index("by_accept_storage", ["acceptSoundStorageId"])
    .index("by_reject_storage", ["rejectSoundStorageId"]),

  participants: defineTable({
    roomId: v.id("rooms"),
    // Legacy field retained only so existing deployments can migrate safely.
    sessionId: v.optional(v.string()),
    authTokenHash: v.optional(v.string()),
    displayName: v.string(),
    isMainDriver: v.boolean(),
    lastSeenAt: v.number(),
    audioUnlocked: v.boolean(),
    joinedAt: v.number(),
  })
    .index("by_room_session", ["roomId", "sessionId"])
    .index("by_room_auth", ["roomId", "authTokenHash"])
    .index("by_room_last_seen", ["roomId", "lastSeenAt"])
    .index("by_room", ["roomId"]),

  buttons: defineTable({
    roomId: v.id("rooms"),
    label: v.string(),
    soundStorageId: v.id("_storage"),
    operationId: v.optional(v.string()),
    sortOrder: v.number(),
    isEnabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_room_sort", ["roomId", "sortOrder"])
    .index("by_room_operation", ["roomId", "operationId"])
    .index("by_sound_storage", ["soundStorageId"])
    .index("by_room", ["roomId"]),

  templates: defineTable({
    // Legacy field retained only so existing deployments can migrate safely.
    ownerSessionId: v.optional(v.string()),
    ownerTokenHash: v.optional(v.string()),
    name: v.string(),
    buttonCount: v.number(),
    acceptSoundStorageId: v.union(v.id("_storage"), v.null()),
    rejectSoundStorageId: v.union(v.id("_storage"), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_updated", ["ownerSessionId", "updatedAt"])
    .index("by_owner_name", ["ownerSessionId", "name"])
    .index("by_owner_token_updated", ["ownerTokenHash", "updatedAt"])
    .index("by_owner_token_name", ["ownerTokenHash", "name"]),

  template_buttons: defineTable({
    templateId: v.id("templates"),
    label: v.string(),
    soundStorageId: v.id("_storage"),
    sortOrder: v.number(),
    isEnabled: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_template_sort", ["templateId", "sortOrder"])
    .index("by_sound_storage", ["soundStorageId"])
    .index("by_template", ["templateId"]),

  requests: defineTable({
    roomId: v.id("rooms"),
    buttonId: v.id("buttons"),
    requestedByParticipantId: v.optional(v.id("participants")),
    // Legacy field retained only so existing requests remain readable.
    requestedBySessionId: v.optional(v.string()),
    operationId: v.optional(v.string()),
    status: requestStatus,
    createdAt: v.number(),
    activatedAt: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
    resolvedBySessionId: v.optional(v.string()),
  })
    .index("by_room_status_created", ["roomId", "status", "createdAt"])
    .index("by_room_created", ["roomId", "createdAt"])
    .index("by_room_operation", ["roomId", "operationId"]),

  events: defineTable({
    roomId: v.id("rooms"),
    seq: v.number(),
    type: eventType,
    requestId: v.id("requests"),
    buttonId: v.optional(v.id("buttons")),
    decision: v.optional(decisionType),
    actorParticipantId: v.optional(v.id("participants")),
    // Legacy field retained only so existing events remain readable.
    actorSessionId: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_room_seq", ["roomId", "seq"]),

  room_state: defineTable({
    roomId: v.id("rooms"),
    activeRequestId: v.union(v.id("requests"), v.null()),
    nextSeq: v.number(),
  }).index("by_room", ["roomId"]),
});
