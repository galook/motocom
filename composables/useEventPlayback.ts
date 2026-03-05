import type { RoomState } from "~/types/soundboard";
import { freshEvents, latestSeq } from "~/utils/events";
import { planPlayback } from "~/utils/playback";

export function useEventPlayback(
  roomState: Ref<RoomState | null>,
  sessionId: Ref<string>,
  audioUnlocked: Ref<boolean>,
  queuePlayback: (url: string | null) => void,
) {
  const lastSeqByRoom = useState<Record<string, number>>(
    "event-last-seq-by-room",
    () => ({}),
  );

  watch(
    roomState,
    (state) => {
      if (!state) {
        return;
      }

      const roomId = state.room.id;
      const roomLatestSeq = latestSeq(state.events);

      if (lastSeqByRoom.value[roomId] == null) {
        // Baseline on first load to avoid replaying historical events.
        lastSeqByRoom.value[roomId] = roomLatestSeq;
        return;
      }

      const lastSeq = lastSeqByRoom.value[roomId] ?? 0;
      const incomingEvents = freshEvents(state.events, lastSeq);
      if (!incomingEvents.length) {
        return;
      }

      const selfParticipant = state.participants.find(
        (participant) => participant.sessionId === sessionId.value,
      );

      const playback = planPlayback({
        events: state.events,
        lastSeq,
        sessionId: sessionId.value,
        audioUnlocked: audioUnlocked.value,
        selfIsActive: Boolean(selfParticipant?.isActive),
        buttons: state.buttons,
        outcomeSounds: state.outcomeSounds,
      });

      for (const url of playback.urls) {
        queuePlayback(url);
      }

      lastSeqByRoom.value[roomId] = playback.nextSeq;
    },
    { deep: true },
  );
}
