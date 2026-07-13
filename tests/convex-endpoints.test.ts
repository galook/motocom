import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.*s");
const DRIVER_TOKEN = "a".repeat(64);
const RIDER_TOKEN = "b".repeat(64);

async function createTestRoom(t: ReturnType<typeof convexTest>, suffix = "001") {
  return await t.mutation(api.rooms.createRoom, {
    roomCode: `SEC${suffix}`,
    roomName: "Secure Ride",
    displayName: "Driver",
    mainDriverPin: "123456",
    participantToken: DRIVER_TOKEN,
    operationId: `create-room-${suffix}`,
  });
}

describe("Convex endpoint security and integrity", () => {
  it("never returns room credentials in public state and safely replays room creation", async () => {
    const t = convexTest(schema, modules);
    const created = await createTestRoom(t);
    const replayed = await createTestRoom(t);

    expect(replayed.roomId).toEqual(created.roomId);
    expect(replayed.participantId).toEqual(created.participantId);
    expect(replayed.replayed).toBe(true);

    const publicState = await t.query(api.rooms.getRoomState, {
      roomCode: "SEC001",
    });
    const authorizedState = await t.query(api.rooms.getRoomState, {
      roomCode: "SEC001",
      participantToken: DRIVER_TOKEN,
    });
    const presence = await t.query(api.rooms.getRoomPresence, {
      roomCode: "SEC001",
    });

    const serializedPublicData = JSON.stringify({ publicState, presence });
    expect(serializedPublicData).not.toContain(DRIVER_TOKEN);
    expect(serializedPublicData).not.toContain("authTokenHash");
    expect(serializedPublicData).not.toContain("sessionId");
    expect(serializedPublicData).not.toContain("mainDriverPinHash");
    expect(publicState?.currentParticipantId).toBeNull();
    expect(authorizedState?.currentParticipantId).toBe(String(created.participantId));
    expect(authorizedState?.isMainDriver).toBe(true);
    expect(presence).toEqual([
      expect.objectContaining({
        id: String(created.participantId),
        displayName: "Driver",
        isMainDriver: true,
      }),
    ]);

    const rooms = await t.run(async (ctx) => await ctx.db.query("rooms").collect());
    expect(rooms).toHaveLength(1);
    expect(rooms[0].mainDriverPinHash).not.toContain("123456");
    expect(rooms[0].mainDriverPinSalt).toBeTruthy();
  });

  it("transfers the exclusive main-driver role after a valid PIN claim", async () => {
    const t = convexTest(schema, modules);
    const created = await createTestRoom(t, "004");
    const joined = await t.mutation(api.rooms.joinRoom, {
      roomCode: "SEC004",
      displayName: "Replacement Driver",
      participantToken: RIDER_TOKEN,
    });

    await expect(
      t.mutation(api.rooms.claimMainDriver, {
        roomId: created.roomId,
        pin: "123456",
        participantToken: RIDER_TOKEN,
      }),
    ).resolves.toEqual({ granted: true });

    const presence = await t.query(api.rooms.getRoomPresence, {
      roomCode: "SEC004",
    });
    expect(presence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: String(created.participantId),
        displayName: "Driver",
        isMainDriver: false,
      }),
      expect.objectContaining({
        id: String(joined.participantId),
        displayName: "Replacement Driver",
        isMainDriver: true,
      }),
    ]));
    expect(presence.filter((participant) => participant.isMainDriver)).toHaveLength(1);
  });

  it("rejects main-driver mutations when a public participant id is used as a credential", async () => {
    const t = convexTest(schema, modules);
    const created = await createTestRoom(t, "002");

    await expect(
      t.mutation(api.rooms.claimMainDriver, {
        roomId: created.roomId,
        pin: "123456",
        participantToken: String(created.participantId),
      }),
    ).rejects.toThrow("Participant authorization is invalid or expired");
  });

  it("prevents deleting a button referenced by a queued request", async () => {
    const t = convexTest(schema, modules);
    const created = await createTestRoom(t, "003");
    await t.mutation(api.rooms.joinRoom, {
      roomCode: "SEC003",
      displayName: "Rider",
      participantToken: RIDER_TOKEN,
    });

    const firstStorageId = await t.run(async (ctx) =>
      await ctx.storage.store(new Blob(["first"], { type: "audio/mpeg" })),
    );
    const secondStorageId = await t.run(async (ctx) =>
      await ctx.storage.store(new Blob(["second"], { type: "audio/mpeg" })),
    );

    const [firstButtonId, secondButtonId] = await t.run(async (ctx) => {
      const now = Date.now();
      const firstButtonId = await ctx.db.insert("buttons", {
        roomId: created.roomId,
        label: "First",
        soundStorageId: firstStorageId,
        sortOrder: 0,
        isEnabled: true,
        createdAt: now,
        updatedAt: now,
      });
      const secondButtonId = await ctx.db.insert("buttons", {
        roomId: created.roomId,
        label: "Second",
        soundStorageId: secondStorageId,
        sortOrder: 1,
        isEnabled: true,
        createdAt: now,
        updatedAt: now,
      });
      return [firstButtonId, secondButtonId] as const;
    });

    await t.mutation(api.requests.enqueueRequest, {
      roomId: created.roomId,
      buttonId: firstButtonId,
      participantToken: RIDER_TOKEN,
      operationId: "enqueue-first-request",
    });
    await t.mutation(api.requests.enqueueRequest, {
      roomId: created.roomId,
      buttonId: secondButtonId,
      participantToken: RIDER_TOKEN,
      operationId: "enqueue-second-request",
    });

    await expect(
      t.mutation(api.buttons.deleteButton, {
        roomId: created.roomId,
        buttonId: secondButtonId,
        participantToken: DRIVER_TOKEN,
      }),
    ).rejects.toThrow("active or queued request");

    const storedButton = await t.run(async (ctx) => await ctx.db.get(secondButtonId));
    expect(storedButton).not.toBeNull();
  });
});
