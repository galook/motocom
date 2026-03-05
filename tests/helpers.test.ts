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

  it("hashes identical pin values to the same stable hash", () => {
    expect(hashPin("1234")).toBe(hashPin("1234"));
    expect(hashPin("1234")).not.toBe(hashPin("4321"));
  });

  it("marks participant active when heartbeat is within timeout", () => {
    const now = 1_000_000;
    expect(isParticipantActive(now - 60_000, now)).toBe(true);
    expect(isParticipantActive(now - 121_000, now)).toBe(false);
  });
});
