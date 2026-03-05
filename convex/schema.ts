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
    mainDriverPinHash: v.string(),
    acceptSoundStorageId: v.optional(v.id("_storage")),
    rejectSoundStorageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
  }).index("by_code", ["code"]),

  participants: defineTable({
    roomId: v.id("rooms"),
    sessionId: v.string(),
    displayName: v.string(),
    isMainDriver: v.boolean(),
    lastSeenAt: v.number(),
    audioUnlocked: v.boolean(),
    joinedAt: v.number(),
  })
    .index("by_room_session", ["roomId", "sessionId"])
    .index("by_room_last_seen", ["roomId", "lastSeenAt"])
    .index("by_room", ["roomId"]),

  buttons: defineTable({
    roomId: v.id("rooms"),
    label: v.string(),
    soundStorageId: v.id("_storage"),
    sortOrder: v.number(),
    isEnabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_room_sort", ["roomId", "sortOrder"])
    .index("by_room", ["roomId"]),

  requests: defineTable({
    roomId: v.id("rooms"),
    buttonId: v.id("buttons"),
    requestedBySessionId: v.string(),
    status: requestStatus,
    createdAt: v.number(),
    activatedAt: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
    resolvedBySessionId: v.optional(v.string()),
  })
    .index("by_room_status_created", ["roomId", "status", "createdAt"])
    .index("by_room_created", ["roomId", "createdAt"]),

  events: defineTable({
    roomId: v.id("rooms"),
    seq: v.number(),
    type: eventType,
    requestId: v.id("requests"),
    buttonId: v.optional(v.id("buttons")),
    decision: v.optional(decisionType),
    actorSessionId: v.string(),
    createdAt: v.number(),
  }).index("by_room_seq", ["roomId", "seq"]),

  room_state: defineTable({
    roomId: v.id("rooms"),
    activeRequestId: v.union(v.id("requests"), v.null()),
    nextSeq: v.number(),
  }).index("by_room", ["roomId"]),
});
