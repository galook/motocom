<script setup lang="ts">
import { api } from "~/convex/_generated/api";
import type { ButtonVisualState, Decision, RoomState } from "~/types/soundboard";
import { buildConnectivityHint, runMutation, toErrorMessage } from "~/utils/mutation";

const route = useRoute();
const sessionId = useSessionId();
const runtimeConfig = useRuntimeConfig();
const convexUrl = String(runtimeConfig.public.convexUrl || "");
const roomCode = computed(() => String(route.params.code || "").trim().toUpperCase());

const localDisplayName = ref("");
const claimPin = ref("");
const showSettings = ref(false);
const pageError = ref("");
const pageSuccess = ref("");
const isEnqueueing = ref(false);
const isRemovingButton = ref(false);
const isResolving = ref(false);
const isJoiningRoom = ref(false);
const isClaiming = ref(false);
const connectionWarning = computed(() => buildConnectivityHint(convexUrl));
const APP_LOCKED_MESSAGE = "Tap the speaker icon to unlock audio before using the app.";
const RESOLUTION_FEEDBACK_MS = 3_500;

const { isUnlocked, isUnlocking, unlockAudio, queuePlayback } = useAudioUnlock(convexUrl);
const feedbackNow = ref(Date.now());
let feedbackTicker: ReturnType<typeof setInterval> | null = null;

const roomQueryArgs = computed(() => ({
  roomCode: roomCode.value,
  sessionId: sessionId.value || undefined,
}));

const { data: roomData, isPending: roomPending } = useConvexQuery(
  api.rooms.getRoomState,
  roomQueryArgs,
);

const roomState = computed(() => (roomData.value ?? null) as RoomState | null);
const roomId = computed(() => roomState.value?.room.id ?? null);
const hasActiveRequest = computed(() => Boolean(roomState.value?.activeRequest));
const hasQueuedRequests = computed(() => (roomState.value?.queue.length ?? 0) > 0);
const showLiveRequestDock = computed(() => hasActiveRequest.value && hasQueuedRequests.value);
const buttonStates = computed<Record<string, ButtonVisualState>>(() => {
  const state = roomState.value;
  if (!state) {
    return {};
  }

  const now = feedbackNow.value;
  const visualByButton: Record<string, ButtonVisualState> = {};
  for (const button of state.buttons) {
    visualByButton[button.id] = "idle";
  }

  for (const event of state.events) {
    if (!event.buttonId || event.type !== "request_resolved" || !event.decision) {
      continue;
    }
    if (now - event.createdAt <= RESOLUTION_FEEDBACK_MS) {
      visualByButton[event.buttonId] = event.decision;
    }
  }

  if (state.activeRequest?.buttonId) {
    visualByButton[state.activeRequest.buttonId] = "pending";
  }

  return visualByButton;
});

usePresence(roomId, sessionId, isUnlocked);
useEventPlayback(roomState, sessionId, isUnlocked, queuePlayback);

const { mutate: joinRoomMutation } = useConvexMutation(api.rooms.joinRoom);
const { mutate: claimMainDriverMutation } = useConvexMutation(api.rooms.claimMainDriver);
const { mutate: enqueueRequestMutation } = useConvexMutation(api.requests.enqueueRequest);
const { mutate: deleteButtonMutation } = useConvexMutation(api.buttons.deleteButton);
const { mutate: resolveRequestMutation } = useConvexMutation(api.requests.resolveActiveRequest);

const participantRecord = computed(() =>
  roomState.value?.participants.find((participant) => participant.sessionId === sessionId.value) ?? null,
);
const joinedInRoom = computed(() => participantRecord.value != null);

const clearMessages = () => {
  pageError.value = "";
  pageSuccess.value = "";
};

const joinRoom = async () => {
  clearMessages();
  if (connectionWarning.value) {
    pageError.value = connectionWarning.value;
    return;
  }
  if (!isUnlocked.value) {
    pageError.value = APP_LOCKED_MESSAGE;
    return;
  }

  if (!roomCode.value || !localDisplayName.value.trim()) {
    pageError.value = "Display name is required to join this room.";
    return;
  }

  isJoiningRoom.value = true;
  try {
    await runMutation(joinRoomMutation, {
      roomCode: roomCode.value,
      displayName: localDisplayName.value.trim(),
      sessionId: sessionId.value,
    }, {
      operationName: "Join room",
      convexUrl,
    });

    if (process.client) {
      window.localStorage.setItem("motocom.display-name", localDisplayName.value.trim());
    }

    pageSuccess.value = "Joined room.";
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    isJoiningRoom.value = false;
  }
};

const claimMainDriver = async () => {
  clearMessages();
  if (connectionWarning.value) {
    pageError.value = connectionWarning.value;
    return;
  }
  if (!isUnlocked.value) {
    pageError.value = APP_LOCKED_MESSAGE;
    return;
  }
  if (!roomId.value || !claimPin.value.trim()) {
    pageError.value = "PIN is required.";
    return;
  }

  isClaiming.value = true;
  try {
    const result = await runMutation<{ roomId: string; pin: string; sessionId: string }, { granted: boolean }>(
      claimMainDriverMutation,
      {
        roomId: roomId.value,
        pin: claimPin.value.trim(),
        sessionId: sessionId.value,
      },
      {
        operationName: "Claim main driver",
        convexUrl,
      },
    );

    if (!result.granted) {
      pageError.value = "PIN is incorrect.";
      return;
    }

    claimPin.value = "";
    pageSuccess.value = "Main driver role granted.";
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    isClaiming.value = false;
  }
};

const enqueue = async (buttonId: string) => {
  clearMessages();
  if (connectionWarning.value) {
    pageError.value = connectionWarning.value;
    return;
  }
  if (!isUnlocked.value) {
    pageError.value = APP_LOCKED_MESSAGE;
    return;
  }
  if (!roomId.value || !joinedInRoom.value) {
    pageError.value = "Join this room first from Settings.";
    return;
  }

  isEnqueueing.value = true;
  try {
    const result = await runMutation<
      { roomId: string; buttonId: string; sessionId: string },
      { requestId: string; status: "active" | "queued" }
    >(enqueueRequestMutation, {
      roomId: roomId.value,
      buttonId,
      sessionId: sessionId.value,
    }, {
      operationName: "Enqueue request",
      convexUrl,
    });

    pageSuccess.value =
      result.status === "active"
        ? "Request is now active."
        : `Request added to queue (${roomState.value?.queue.length ?? 0} waiting).`;
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    isEnqueueing.value = false;
  }
};

const resolveActiveRequest = async (decision: Decision) => {
  clearMessages();
  if (connectionWarning.value) {
    pageError.value = connectionWarning.value;
    return;
  }
  if (!isUnlocked.value) {
    pageError.value = APP_LOCKED_MESSAGE;
    return;
  }
  if (!roomId.value) {
    return;
  }

  isResolving.value = true;
  try {
    await runMutation(resolveRequestMutation, {
      roomId: roomId.value,
      decision,
      sessionId: sessionId.value,
    }, {
      operationName: "Resolve request",
      convexUrl,
    });
    pageSuccess.value = `Request ${decision}.`;
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    isResolving.value = false;
  }
};

const removeButtonFromBoard = async (buttonId: string) => {
  clearMessages();
  if (connectionWarning.value) {
    pageError.value = connectionWarning.value;
    return;
  }
  if (!isUnlocked.value) {
    pageError.value = APP_LOCKED_MESSAGE;
    return;
  }
  if (!roomId.value || !roomState.value?.isMainDriver) {
    pageError.value = "Only main drivers can remove buttons.";
    return;
  }

  const targetButton = roomState.value.buttons.find((button) => button.id === buttonId);
  if (process.client) {
    const label = targetButton?.label ?? "this button";
    const confirmed = window.confirm(`Delete "${label}"?`);
    if (!confirmed) {
      return;
    }
  }

  isRemovingButton.value = true;
  try {
    await runMutation(deleteButtonMutation, {
      roomId: roomId.value,
      buttonId,
      sessionId: sessionId.value,
    }, {
      operationName: "Delete button",
      convexUrl,
    });
    pageSuccess.value = "Button removed.";
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    isRemovingButton.value = false;
  }
};

const formatTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const eventLabel = (event: RoomState["events"][number]) => {
  if (event.type === "request_started") {
    const button = roomState.value?.buttons.find((candidate) => candidate.id === event.buttonId);
    return `Started ${button?.label ?? "sound"}`;
  }
  return event.decision === "accepted" ? "Accepted active request" : "Rejected active request";
};

onMounted(() => {
  if (!process.client) {
    return;
  }

  feedbackTicker = window.setInterval(() => {
    feedbackNow.value = Date.now();
  }, 500);

  const storedName = window.localStorage.getItem("motocom.display-name");
  if (storedName) {
    localDisplayName.value = storedName;
  }
});

onUnmounted(() => {
  if (feedbackTicker) {
    clearInterval(feedbackTicker);
    feedbackTicker = null;
  }
});
</script>

<template>
  <main
    class="page room-page"
    :class="{
      'room-page--with-dock': showLiveRequestDock,
      'room-page--with-audio-prompt': !isUnlocked,
    }"
  >
    <button
      class="audio-icon-button"
      :class="[
        isUnlocked ? 'audio-icon-button--ready' : 'audio-icon-button--locked',
        { 'audio-icon-button--above-dock': showLiveRequestDock },
        { 'audio-icon-button--above-prompt': !isUnlocked },
      ]"
      :disabled="Boolean(connectionWarning) || isUnlocking"
      :aria-label="isUnlocked ? 'Audio unlocked' : 'Unlock audio'"
      @click="unlockAudio"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M3 10h4l5-4v12l-5-4H3v-4zm12.5-2.5a6 6 0 010 9m2.5-12a9.5 9.5 0 010 15"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
        />
      </svg>
      <span class="audio-icon-button__status">{{ isUnlocked ? 'on' : isUnlocking ? '...' : 'off' }}</span>
    </button>

    <section
      v-if="!isUnlocked"
      class="audio-prompt-banner"
      :class="{ 'audio-prompt-banner--above-dock': showLiveRequestDock }"
    >
      <div class="card audio-prompt-banner__card">
        <div>
          <strong>Audio is disabled.</strong>
          <p class="muted audio-prompt-banner__text">
            Enable audio to continue and hear synchronized sounds.
          </p>
        </div>
        <button
          class="warn"
          :disabled="Boolean(connectionWarning) || isUnlocking"
          @click="unlockAudio"
        >
          {{ isUnlocking ? 'Enabling...' : 'Enable Audio' }}
        </button>
      </div>
    </section>

    <section class="card room-topbar">
      <div>
        <h1>{{ roomState?.room.name ?? `Room ${roomCode}` }}</h1>
        <p class="muted">Code: {{ roomCode }}</p>
      </div>
      <div class="row room-topbar__actions">
        <button class="secondary" @click="showSettings = !showSettings">
          {{ showSettings ? 'Hide Settings' : 'Show Settings' }}
        </button>
        <NuxtLink class="muted topbar-link" to="/">Back</NuxtLink>
      </div>
    </section>

    <section v-if="connectionWarning" class="card">
      <p class="error">{{ connectionWarning }}</p>
    </section>

    <section class="card" v-if="roomPending">
      <p>Loading room state...</p>
    </section>

    <section class="card" v-else-if="!roomState">
      <h2>Room not found</h2>
      <p class="muted">This room code does not exist yet.</p>
    </section>

    <template v-else>
      <section class="card soundboard-card">
        <h2>Soundboard</h2>
        <p class="muted" v-if="!isUnlocked">
          {{ APP_LOCKED_MESSAGE }}
        </p>
        <p class="muted" v-else-if="!joinedInRoom">
          Join this room from Settings to enable button presses.
        </p>
        <SoundGrid
          :buttons="roomState.buttons"
          :active-button-id="roomState.activeRequest?.buttonId ?? null"
          :button-states="buttonStates"
          :removable="roomState.isMainDriver && showSettings"
          :disable-press="Boolean(connectionWarning) || !isUnlocked || !joinedInRoom || isEnqueueing || isRemovingButton"
          @press="enqueue"
          @remove="removeButtonFromBoard"
        />
      </section>

      <section v-if="hasActiveRequest && !showLiveRequestDock" class="card inline-active-panel">
        <ActiveRequestPanel
          :active-request="roomState.activeRequest"
          :is-main-driver="roomState.isMainDriver"
          :is-resolving="Boolean(connectionWarning) || !isUnlocked || isResolving"
          :queue-length="roomState.queue.length"
          @resolve="resolveActiveRequest"
        />
      </section>

      <section class="card" v-if="showSettings">
        <h2>Settings</h2>
        <p class="muted">Session: {{ sessionId }}</p>
        <p class="muted" v-if="participantRecord">
          Role:
          <span class="badge" :class="participantRecord.isMainDriver ? 'ok' : 'off'">
            {{ participantRecord.isMainDriver ? 'main driver' : 'rider' }}
          </span>
        </p>

        <section class="settings-section" v-if="!joinedInRoom">
          <h3>Join this room</h3>
          <div class="row">
            <div class="field-col">
              <label>Display name</label>
              <input v-model="localDisplayName" placeholder="Your name" />
            </div>
          </div>
          <button :disabled="Boolean(connectionWarning) || !isUnlocked || isJoiningRoom || !localDisplayName.trim()" @click="joinRoom">
            {{ isJoiningRoom ? 'Joining...' : 'Join Room' }}
          </button>
        </section>

        <section class="settings-section" v-if="joinedInRoom && !roomState.isMainDriver">
          <h3>Claim Main Driver</h3>
          <div class="row">
            <div class="field-col">
              <label>PIN</label>
              <input v-model="claimPin" type="password" placeholder="Enter room PIN" />
            </div>
          </div>
          <button
            class="warn"
            :disabled="Boolean(connectionWarning) || !isUnlocked || isClaiming || !claimPin.trim()"
            @click="claimMainDriver"
          >
            {{ isClaiming ? 'Checking...' : 'Claim Main Driver' }}
          </button>
        </section>

        <section class="settings-section">
          <h3>Queue</h3>
          <p v-if="!roomState.queue.length" class="muted">Queue is empty.</p>
          <ul class="history" v-else>
            <li v-for="queued in roomState.queue" :key="queued.id">
              <strong>{{ queued.buttonLabel }}</strong> requested by {{ queued.requestedBySessionId }} at
              {{ formatTime(queued.createdAt) }}
            </li>
          </ul>
        </section>

        <section class="settings-section">
          <h3>Recent Events (last 50)</h3>
          <p v-if="!roomState.events.length" class="muted">No events yet.</p>
          <ul class="history" v-else>
            <li v-for="event in roomState.events" :key="event.seq">
              #{{ event.seq }} · {{ eventLabel(event) }} · {{ event.actorSessionId }} ·
              {{ formatTime(event.createdAt) }}
            </li>
          </ul>
        </section>

        <section class="settings-section">
          <PresenceList :participants="roomState.participants" />
        </section>

        <section class="settings-section" v-if="roomState.isMainDriver">
          <MainDriverPanel
            :room-id="roomState.room.id"
            :session-id="sessionId"
            :buttons="roomState.buttons"
            :outcome-sounds="roomState.outcomeSounds"
            :app-enabled="isUnlocked"
          />
        </section>
      </section>

      <section v-if="showLiveRequestDock" class="live-request-dock">
        <ActiveRequestPanel
          :active-request="roomState.activeRequest"
          :is-main-driver="roomState.isMainDriver"
          :is-resolving="Boolean(connectionWarning) || !isUnlocked || isResolving"
          :queue-length="roomState.queue.length"
          @resolve="resolveActiveRequest"
        />
      </section>
    </template>

    <p v-if="pageError" class="error">{{ pageError }}</p>
    <p v-if="pageSuccess" class="success">{{ pageSuccess }}</p>
  </main>
</template>

<style scoped>
.room-page {
  max-width: 980px;
}

.room-page--with-dock {
  padding-bottom: 12rem;
}

.room-page--with-audio-prompt {
  padding-bottom: 11rem;
}

.room-topbar {
  align-items: center;
  display: flex;
  justify-content: space-between;
  gap: 0.8rem;
}

.room-topbar__actions {
  align-items: center;
}

.topbar-link {
  align-items: center;
  display: inline-flex;
}

.soundboard-card {
  margin-top: 0.5rem;
}

.inline-active-panel {
  margin-top: 0.8rem;
}

.audio-icon-button {
  align-items: center;
  background: #ffffff;
  border: 1px solid #d7deea;
  border-radius: 999px;
  bottom: 1rem;
  color: #6f7f96;
  display: inline-flex;
  gap: 0.45rem;
  height: 46px;
  justify-content: center;
  padding: 0 0.75rem;
  position: fixed;
  right: 1rem;
  width: auto;
  z-index: 70;
}

.audio-icon-button svg {
  height: 18px;
  width: 18px;
}

.audio-icon-button__status {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.audio-icon-button--locked {
  animation: audio-lock-pulse 1.15s ease-in-out infinite;
  border-color: #cb8a2f;
  box-shadow: 0 0 0 1px rgba(203, 138, 47, 0.28), 0 0 14px rgba(203, 138, 47, 0.2);
  color: #9c6823;
}

.audio-icon-button--ready {
  border-color: #3b9759;
  box-shadow: 0 0 0 1px rgba(59, 151, 89, 0.22), 0 0 12px rgba(59, 151, 89, 0.18);
  color: #2f7e48;
}

.audio-icon-button--above-dock {
  bottom: 7.2rem;
}

.audio-icon-button--above-prompt {
  bottom: 7.8rem;
}

.settings-section {
  border-top: 1px solid #d7deea;
  margin-top: 1rem;
  padding-top: 1rem;
}

.field-col {
  flex: 1 1 220px;
}

.history {
  margin: 0;
  padding-left: 1rem;
}

.history li {
  margin-bottom: 0.42rem;
}

.audio-prompt-banner {
  bottom: 0;
  left: 0;
  padding: 0 0.8rem max(0.8rem, env(safe-area-inset-bottom));
  position: fixed;
  right: 0;
  z-index: 75;
}

.audio-prompt-banner--above-dock {
  bottom: 6.4rem;
}

.audio-prompt-banner__card {
  align-items: center;
  border-color: #e5c48f;
  box-shadow: 0 10px 24px rgba(82, 62, 22, 0.2);
  display: flex;
  gap: 0.8rem;
  justify-content: space-between;
  margin: 0 auto;
  max-width: 980px;
}

.audio-prompt-banner__text {
  margin: 0.25rem 0 0;
}

.live-request-dock {
  bottom: 0;
  left: 0;
  padding: 0 0.8rem max(0.8rem, env(safe-area-inset-bottom));
  position: fixed;
  right: 0;
  z-index: 60;
}

.live-request-dock :deep(.active-panel.card) {
  border-color: #c8d7eb;
  box-shadow: 0 10px 24px rgba(52, 78, 108, 0.2);
  margin: 0 auto;
  max-width: 980px;
}

@keyframes audio-lock-pulse {
  0% {
    box-shadow: 0 0 0 1px rgba(203, 138, 47, 0.24), 0 0 9px rgba(203, 138, 47, 0.14);
  }
  50% {
    box-shadow: 0 0 0 1px rgba(203, 138, 47, 0.32), 0 0 18px rgba(203, 138, 47, 0.26);
  }
  100% {
    box-shadow: 0 0 0 1px rgba(203, 138, 47, 0.24), 0 0 9px rgba(203, 138, 47, 0.14);
  }
}

@media (max-width: 700px) {
  .room-topbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .audio-icon-button {
    bottom: 0.8rem;
    right: 0.8rem;
  }

  .audio-icon-button--above-dock {
    bottom: 7rem;
  }

  .audio-icon-button--above-prompt {
    bottom: 7.3rem;
  }

  .live-request-dock {
    padding-left: 0.5rem;
    padding-right: 0.5rem;
  }

  .audio-prompt-banner {
    padding-left: 0.5rem;
    padding-right: 0.5rem;
  }

  .audio-prompt-banner--above-dock {
    bottom: 6.1rem;
  }

  .audio-prompt-banner__card {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
