import type { RoomButton, RoomEvent } from "../types/soundboard";

export interface PlaybackPlanInput {
  events: RoomEvent[];
  lastSeq: number;
  currentParticipantId: string | null;
  selfIsActive: boolean;
  buttons: RoomButton[];
  outcomeSounds: {
    acceptUrl: string | null;
    rejectUrl: string | null;
  };
}

export interface PlannedPlaybackItem {
  url: string;
  createdAt: number;
  eventSeq: number;
}

export interface PlaybackPlan {
  nextSeq: number;
  items: PlannedPlaybackItem[];
}

export function planPlayback(input: PlaybackPlanInput): PlaybackPlan {
  const freshEvents = input.events.filter((event) => event.seq > input.lastSeq);
  if (!freshEvents.length) {
    return { nextSeq: input.lastSeq, items: [] };
  }

  const nextSeq = freshEvents[freshEvents.length - 1].seq;
  if (!input.selfIsActive) {
    return { nextSeq, items: [] };
  }

  const items: PlannedPlaybackItem[] = [];
  for (const event of freshEvents) {
    if (
      input.currentParticipantId &&
      event.actorParticipantId === input.currentParticipantId
    ) {
      continue;
    }

    if (event.type === "request_started") {
      const button = input.buttons.find((candidate) => candidate.id === event.buttonId);
      if (button?.soundUrl) {
        items.push({
          url: button.soundUrl,
          createdAt: event.createdAt,
          eventSeq: event.seq,
        });
      }
      continue;
    }

    const outcomeUrl =
      event.decision === "accepted"
        ? input.outcomeSounds.acceptUrl
        : input.outcomeSounds.rejectUrl;
    if (outcomeUrl) {
      items.push({
        url: outcomeUrl,
        createdAt: event.createdAt,
        eventSeq: event.seq,
      });
    }
  }

  return { nextSeq, items };
}
