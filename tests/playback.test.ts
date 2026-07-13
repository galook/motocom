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
    actorParticipantId: "other",
    createdAt: 1,
  },
  {
    seq: 2,
    type: "request_resolved",
    requestId: "r1",
    buttonId: "b1",
    decision: "accepted",
    actorParticipantId: "other",
    createdAt: 2,
  },
  {
    seq: 3,
    type: "request_resolved",
    requestId: "r2",
    buttonId: "b2",
    decision: "rejected",
    actorParticipantId: "self",
    createdAt: 3,
  },
];

describe("planPlayback", () => {
  it("returns no playback when there are no new events", () => {
    const result = planPlayback({
      events,
      lastSeq: 3,
      currentParticipantId: "self",
      selfIsActive: true,
      buttons: [],
      outcomeSounds: { acceptUrl: null, rejectUrl: null },
    });

    expect(result).toEqual({ nextSeq: 3, items: [] });
  });

  it("advances sequence without audio when self is inactive", () => {
    const result = planPlayback({
      events,
      lastSeq: 0,
      currentParticipantId: "self",
      selfIsActive: false,
      buttons: [],
      outcomeSounds: { acceptUrl: "accept.mp3", rejectUrl: "reject.mp3" },
    });

    expect(result).toEqual({ nextSeq: 3, items: [] });
  });

  it("collects structured button and outcome playback for remote events only", () => {
    const result = planPlayback({
      events,
      lastSeq: 0,
      currentParticipantId: "self",
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

    expect(result).toEqual({
      nextSeq: 3,
      items: [
        { url: "horn.mp3", createdAt: 1, eventSeq: 1 },
        { url: "accept.mp3", createdAt: 2, eventSeq: 2 },
      ],
    });
  });

  it("keeps event timestamps so the audio layer can expire stale items", () => {
    const result = planPlayback({
      events,
      lastSeq: 0,
      currentParticipantId: null,
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

    expect(result.items.map((item) => item.createdAt)).toEqual([1, 2, 3]);
  });
});
