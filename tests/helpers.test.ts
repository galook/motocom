import { describe, expect, it } from "vitest";
import {
  hashPin,
  isParticipantActive,
  normalizeRoomCode,
} from "../convex/lib/helpers";

describe("helpers", () => {
  it("normalizes room code by trimming, uppercasing, and removing spaces", () => {
    expect(normalizeRoomCode("  ride 01 ")).toBe("RIDE01");
  });

  it("hashes identical pin values and salts deterministically", async () => {
    const first = await hashPin("123456", "salt-a");
    const second = await hashPin("123456", "salt-a");
    const differentPin = await hashPin("654321", "salt-a");
    const differentSalt = await hashPin("123456", "salt-b");

    expect(first).toBe(second);
    expect(first).not.toBe(differentPin);
    expect(first).not.toBe(differentSalt);
  });

  it("marks participant active when heartbeat is within timeout", () => {
    const now = 1_000_000;
    expect(isParticipantActive(now - 60_000, now)).toBe(true);
    expect(isParticipantActive(now - 121_000, now)).toBe(false);
  });
});
