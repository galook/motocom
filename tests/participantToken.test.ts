// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRoomParticipantToken,
  createClientSecretToken,
  createOperationId,
  getRoomParticipantToken,
  setRoomParticipantToken,
} from "../utils/participantToken";

describe("participant token utilities", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("stores room credentials under a normalized versioned key", () => {
    setRoomParticipantToken(" ride01 ", "secret-token");

    expect(getRoomParticipantToken("RIDE01")).toBe("secret-token");
    expect(window.localStorage.getItem("motocom.room-participant-token.v2.RIDE01")).toBe(
      "secret-token",
    );

    clearRoomParticipantToken("ride01");
    expect(getRoomParticipantToken("RIDE01")).toBe("");
  });

  it("creates high-entropy client credentials without exposing UUID punctuation", () => {
    const first = createClientSecretToken();
    const second = createClientSecretToken();

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toMatch(/^[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
  });

  it("creates retry operation identifiers", () => {
    const first = createOperationId();
    const second = createOperationId();

    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(second).not.toBe(first);
  });
});
