import { HEARTBEAT_INTERVAL_MS } from "~/convex/constants";
import { api } from "~/convex/_generated/api";
import { runMutation } from "~/utils/mutation";

export function usePresence(
  roomId: Ref<string | null>,
  sessionId: Ref<string>,
  audioUnlocked: Ref<boolean>,
) {
  const { mutate } = useConvexMutation(api.rooms.heartbeat);
  let timer: ReturnType<typeof setInterval> | null = null;

  const sendHeartbeat = async () => {
    if (!roomId.value) {
      return;
    }

    try {
      await runMutation(mutate, {
        roomId: roomId.value,
        sessionId: sessionId.value,
        audioUnlocked: audioUnlocked.value,
      });
    } catch {
      // Ignore heartbeat failures and retry on the next interval.
    }
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const start = () => {
    stop();
    if (!process.client || !roomId.value) {
      return;
    }
    void sendHeartbeat();
    timer = setInterval(() => {
      void sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  };

  watch(
    () => [roomId.value, audioUnlocked.value],
    () => {
      if (roomId.value) {
        start();
      }
    },
    { immediate: true },
  );

  onUnmounted(() => {
    stop();
  });
}
