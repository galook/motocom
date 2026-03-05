import { describe, expect, it } from "vitest";
import { generateRoomCode } from "../utils/roomCode";

describe("generateRoomCode", () => {
  it("generates six-character uppercase room codes by default", () => {
    const code = generateRoomCode();

    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[A-Z2-9]+$/);
    expect(code.includes("I")).toBe(false);
    expect(code.includes("O")).toBe(false);
    expect(code.includes("1")).toBe(false);
    expect(code.includes("0")).toBe(false);
  });

  it("supports custom length", () => {
    expect(generateRoomCode(8)).toHaveLength(8);
  });

  it("rejects short length", () => {
    expect(() => generateRoomCode(2)).toThrow("Room code length must be at least 3");
  });
});
