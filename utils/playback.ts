import type { RoomButton, RoomEvent } from "../types/soundboard";

export interface PlaybackPlanInput {
  events: RoomEvent[];
  lastSeq: number;
  sessionId: string;
  audioUnlocked: boolean;
  selfIsActive: boolean;
  buttons: RoomButton[];
  outcomeSounds: {
    acceptUrl: string | null;
    rejectUrl: string | null;
  };
}

export interface PlaybackPlan {
  nextSeq: number;
  urls: string[];
}

export function planPlayback(input: PlaybackPlanInput): PlaybackPlan {
  const freshEvents = input.events.filter((event) => event.seq > input.lastSeq);
  if (!freshEvents.length) {
    return {
      nextSeq: input.lastSeq,
      urls: [],
    };
  }

  const nextSeq = freshEvents[freshEvents.length - 1].seq;

  if (!input.selfIsActive) {
    return {
      nextSeq,
      urls: [],
    };
  }

  const urls: string[] = [];

  for (const event of freshEvents) {
    if (event.actorSessionId === input.sessionId) {
      continue;
    }

    if (event.type === "request_started") {
      const button = input.buttons.find((candidate) => candidate.id === event.buttonId);
      if (button?.soundUrl) {
        urls.push(button.soundUrl);
      }
      continue;
    }

    const outcomeUrl =
      event.decision === "accepted"
        ? input.outcomeSounds.acceptUrl
        : input.outcomeSounds.rejectUrl;
    if (outcomeUrl) {
      urls.push(outcomeUrl);
    }
  }

  return {
    nextSeq,
    urls,
  };
}
