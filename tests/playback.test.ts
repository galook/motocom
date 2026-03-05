import { describe, expect, it } from "vitest";
import type { RoomEvent } from "../types/soundboard";
import { planPlayback } from "../utils/playback";

const events: RoomEvent[] = [
  {
    seq: 1,
    type: "request_started",
    requestId: "r1",
    buttonId: "b1",
    decision: null,
    actorSessionId: "other",
    createdAt: 1,
  },
  {
    seq: 2,
    type: "request_resolved",
    requestId: "r1",
    buttonId: "b1",
    decision: "accepted",
    actorSessionId: "other",
    createdAt: 2,
  },
  {
    seq: 3,
    type: "request_resolved",
    requestId: "r2",
    buttonId: "b2",
    decision: "rejected",
    actorSessionId: "self",
    createdAt: 3,
  },
];

describe("planPlayback", () => {
  it("returns no playback when there are no new events", () => {
    const result = planPlayback({
      events,
      lastSeq: 3,
      sessionId: "self",
      audioUnlocked: true,
      selfIsActive: true,
      buttons: [],
      outcomeSounds: { acceptUrl: null, rejectUrl: null },
    });

    expect(result).toEqual({ nextSeq: 3, urls: [] });
  });

  it("advances sequence without audio when self is inactive", () => {
    const result = planPlayback({
      events,
      lastSeq: 0,
      sessionId: "self",
      audioUnlocked: true,
      selfIsActive: false,
      buttons: [],
      outcomeSounds: { acceptUrl: "accept.mp3", rejectUrl: "reject.mp3" },
    });

    expect(result).toEqual({ nextSeq: 3, urls: [] });
  });

  it("collects button + outcome urls for remote events only", () => {
    const result = planPlayback({
      events,
      lastSeq: 0,
      sessionId: "self",
      audioUnlocked: true,
      selfIsActive: true,
      buttons: [
        {
          id: "b1",
          label: "Horn",
          sortOrder: 0,
          isEnabled: true,
          soundUrl: "horn.mp3",
        },
      ],
      outcomeSounds: { acceptUrl: "accept.mp3", rejectUrl: "reject.mp3" },
    });

    expect(result.nextSeq).toBe(3);
    expect(result.urls).toEqual(["horn.mp3", "accept.mp3"]);
  });

  it("still returns urls when audio is locked so playback can resume after unlock", () => {
    const result = planPlayback({
      events,
      lastSeq: 0,
      sessionId: "self",
      audioUnlocked: false,
      selfIsActive: true,
      buttons: [
        {
          id: "b1",
          label: "Horn",
          sortOrder: 0,
          isEnabled: true,
          soundUrl: "horn.mp3",
        },
      ],
      outcomeSounds: { acceptUrl: "accept.mp3", rejectUrl: "reject.mp3" },
    });

    expect(result).toEqual({ nextSeq: 3, urls: ["horn.mp3", "accept.mp3"] });
  });
});
