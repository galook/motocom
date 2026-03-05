import { describe, expect, it } from "vitest";
import { freshEvents, latestSeq } from "../utils/events";
import type { RoomEvent } from "../types/soundboard";

const sampleEvents: RoomEvent[] = [
  {
    seq: 1,
    type: "request_started",
    requestId: "r1",
    buttonId: "b1",
    decision: null,
    actorSessionId: "s1",
    createdAt: 100,
  },
  {
    seq: 2,
    type: "request_resolved",
    requestId: "r1",
    buttonId: "b1",
    decision: "accepted",
    actorSessionId: "s2",
    createdAt: 200,
  },
  {
    seq: 3,
    type: "request_started",
    requestId: "r2",
    buttonId: "b2",
    decision: null,
    actorSessionId: "s3",
    createdAt: 300,
  },
];

describe("event helpers", () => {
  it("returns latest sequence number", () => {
    expect(latestSeq(sampleEvents)).toBe(3);
    expect(latestSeq([])).toBe(0);
  });

  it("returns only fresh events newer than last seq", () => {
    expect(freshEvents(sampleEvents, 2).map((event) => event.seq)).toEqual([3]);
    expect(freshEvents(sampleEvents, 0).map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(freshEvents(sampleEvents, 3)).toEqual([]);
  });
});
