<script setup lang="ts">
import { api } from "~/convex/_generated/api";
import type { ButtonVisualState, Decision, RoomState } from "~/types/soundboard";
import { buildConnectivityHint, runMutation, toErrorMessage } from "~/utils/mutation";
import {
  createClientSecretToken,
  createOperationId,
  getRoomParticipantToken,
  setRoomParticipantToken,
} from "~/utils/participantToken";
import { rememberRecentRoom } from "~/utils/recentRooms";

const route = useRoute();
const ownerToken = useSessionId();
const participantToken = ref("");
const runtimeConfig = useRuntimeConfig();
const convexUrl = String(runtimeConfig.public.convexUrl || "");
const roomCode = computed(() => String(route.params.code || "").trim().toUpperCase());

const localDisplayName = ref("");
const claimPin = ref("");
const showSettings = ref(false);
const settingsTab = ref<"room" | "people" | "activity" | "manage">("room");
const soundSearch = ref("");
const gridDensity = ref<"comfortable" | "compact">("comfortable");
const pageError = ref("");
const pageSuccess = ref("");
const isEnqueueing = ref(false);
const isRemovingButton = ref(false);
const isResolving = ref(false);
const isJoiningRoom = ref(false);
const pendingEnqueueOperationByButton = reactive<Record<string, string>>({});
const isClaiming = ref(false);
const connectionWarning = computed(() => buildConnectivityHint(convexUrl));
const APP_LOCKED_MESSAGE = "Tap the speaker icon to unlock audio before using the app.";
const RESOLUTION_FEEDBACK_MS = 3_500;
const AUDIO_AVAILABILITY_POLL_MS = 900;

const {
  isUnlocked,
  isUnlocking,
  playbackVolume,
  setPlaybackVolume,
  unlockAudio,
  refreshAudioAvailability,
  queuePlayback,
} = useAudioUnlock(convexUrl);
const { isWakeLockSupported, isWakeLockActive } = useScreenWakeLock();
const { systemDiagnosticsLog, clearSystemDiagnosticsLog } = useSystemDiagnosticsLog();
const feedbackNow = ref(Date.now());
let feedbackTicker: number | null = null;
let audioAvailabilityTicker: number | null = null;

const roomQueryArgs = computed(() => ({
  roomCode: roomCode.value,
  participantToken: participantToken.value || undefined,
}));
const presenceQueryArgs = computed(() => ({ roomCode: roomCode.value }));

const { data: roomData, isPending: roomPending } = useConvexQuery(
  api.rooms.getRoomState,
  roomQueryArgs,
);
const { data: presenceData } = useConvexQuery(
  api.rooms.getRoomPresence,
  presenceQueryArgs,
);

type RoomStateWithoutPresence = Omit<RoomState, "participants">;
const roomState = computed<RoomState | null>(() => {
  const state = (roomData.value ?? null) as RoomStateWithoutPresence | null;
  if (!state) {
    return null;
  }
  return {
    ...state,
    participants: Array.isArray(presenceData.value) ? presenceData.value : [],
  } as RoomState;
});
useHead(() => ({
  title: roomState.value?.room.name
    ? `${roomState.value.room.name} — Motocom`
    : `Room ${roomCode.value} — Motocom`,
  meta: [
    {
      name: "description",
      content: `Join Motocom room ${roomCode.value} and use the synchronized ride soundboard.`,
    },
  ],
}));

const roomId = computed(() => roomState.value?.room.id ?? null);
const hasActiveRequest = computed(() => Boolean(roomState.value?.activeRequest));
const showLiveRequestDock = computed(() => hasActiveRequest.value);
const activeParticipantCount = computed(() =>
  roomState.value?.participants.filter((participant) => participant.isActive).length ?? 0,
);
const filteredButtons = computed(() => {
  const buttons = roomState.value?.buttons ?? [];
  const query = soundSearch.value.trim().toLocaleLowerCase();
  if (!query) {
    return buttons;
  }
  return buttons.filter((button) => button.label.toLocaleLowerCase().includes(query));
});
const roomShareUrl = computed(() => {
  if (!process.client) {
    return "";
  }
  return `${window.location.origin}/?code=${encodeURIComponent(roomCode.value)}`;
});
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

usePresence(roomId, participantToken, isUnlocked);
useEventPlayback(roomState, isUnlocked, queuePlayback);

const { mutate: joinRoomMutation } = useConvexMutation(api.rooms.joinRoom);
const { mutate: claimMainDriverMutation } = useConvexMutation(api.rooms.claimMainDriver);
const { mutate: enqueueRequestMutation } = useConvexMutation(api.requests.enqueueRequest);
const { mutate: deleteButtonMutation } = useConvexMutation(api.buttons.deleteButton);
const { mutate: resolveRequestMutation } = useConvexMutation(api.requests.resolveActiveRequest);

const participantRecord = computed(() =>
  roomState.value?.participants.find(
    (participant) => participant.id === roomState.value?.currentParticipantId,
  ) ?? null,
);
const playbackVolumePercent = computed(() => Math.round(playbackVolume.value * 100));
const joinedInRoom = computed(() => Boolean(roomState.value?.currentParticipantId));
const participantNameById = computed<Record<string, string>>(() => {
  const mapping: Record<string, string> = {};
  for (const participant of roomState.value?.participants ?? []) {
    mapping[participant.id] = participant.displayName;
  }
  return mapping;
});
const currentDisplayName = computed(() => {
  const joinedName = participantRecord.value?.displayName?.trim();
  if (joinedName) {
    return joinedName;
  }

  const localName = localDisplayName.value.trim();
  return localName || null;
});

const resolveParticipantName = (targetParticipantId: string | null | undefined) => {
  if (!targetParticipantId) {
    return "Unknown rider";
  }

  const knownName = participantNameById.value[targetParticipantId];
  if (knownName) {
    return knownName;
  }

  if (
    targetParticipantId === roomState.value?.currentParticipantId &&
    currentDisplayName.value
  ) {
    return currentDisplayName.value;
  }

  return "Unknown rider";
};

const clearMessages = () => {
  pageError.value = "";
  pageSuccess.value = "";
};

const showToast = (message: string, kind: "success" | "error" = "success") => {
  if (kind === "success") {
    pageSuccess.value = message;
    pageError.value = "";
  } else {
    pageError.value = message;
    pageSuccess.value = "";
  }
  if (process.client) {
    window.setTimeout(() => {
      if (kind === "success" && pageSuccess.value === message) {
        pageSuccess.value = "";
      }
      if (kind === "error" && pageError.value === message) {
        pageError.value = "";
      }
    }, 4_500);
  }
};

const copyRoomCode = async () => {
  clearMessages();
  try {
    await navigator.clipboard.writeText(roomCode.value);
    showToast("Room code copied.");
  } catch {
    showToast(`Room code: ${roomCode.value}`);
  }
};

const shareRoom = async () => {
  clearMessages();
  const roomName = roomState.value?.room.name ?? "Motocom ride";
  const text = `Join ${roomName} on Motocom with code ${roomCode.value}`;
  try {
    if (typeof navigator.share === "function") {
      await navigator.share({ title: roomName, text, url: roomShareUrl.value });
      return;
    }
    await navigator.clipboard.writeText(`${text}\n${roomShareUrl.value}`);
    showToast("Invite link copied.");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }
    showToast("Could not share the room.", "error");
  }
};

const setGridDensity = (density: "comfortable" | "compact") => {
  gridDensity.value = density;
  if (process.client) {
    window.localStorage.setItem("motocom.grid-density", density);
  }
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
    if (!participantToken.value) {
      participantToken.value = createClientSecretToken();
    }
    const result = await runMutation<
      { roomCode: string; displayName: string; participantToken: string },
      { participantToken: string }
    >(joinRoomMutation, {
      roomCode: roomCode.value,
      displayName: localDisplayName.value.trim(),
      participantToken: participantToken.value,
    }, {
      operationName: "Join room",
      convexUrl,
    });

    participantToken.value = result.participantToken;
    setRoomParticipantToken(roomCode.value, result.participantToken);
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
    const result = await runMutation<
      { roomId: string; pin: string; participantToken: string },
      { granted: boolean }
    >(
      claimMainDriverMutation,
      {
        roomId: roomId.value,
        pin: claimPin.value.trim(),
        participantToken: participantToken.value,
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
  if (process.client && typeof navigator.vibrate === "function") {
    navigator.vibrate(28);
  }
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
    const operationId = pendingEnqueueOperationByButton[buttonId] ?? createOperationId();
    pendingEnqueueOperationByButton[buttonId] = operationId;
    const result = await runMutation<
      { roomId: string; buttonId: string; participantToken: string; operationId: string },
      { requestId: string; status: "active" | "queued"; replayed: boolean }
    >(enqueueRequestMutation, {
      roomId: roomId.value,
      buttonId,
      participantToken: participantToken.value,
      operationId,
    }, {
      operationName: "Enqueue request",
      convexUrl,
    });

    delete pendingEnqueueOperationByButton[buttonId];
    showToast(
      result.status === "active"
        ? "Request is now active."
        : `Request added to queue (${(roomState.value?.queue.length ?? 0) + 1} waiting).`,
    );
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
      participantToken: participantToken.value,
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
      participantToken: participantToken.value,
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

const onPlaybackVolumeInput = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const nextPercent = Number(input.value);
  if (!Number.isFinite(nextPercent)) {
    return;
  }
  setPlaybackVolume(nextPercent / 100);
};

const onVisibilityChange = () => {
  if (!process.client || document.visibilityState !== "visible") {
    return;
  }

  refreshAudioAvailability();
};

onMounted(() => {
  if (!process.client) {
    return;
  }

  feedbackTicker = window.setInterval(() => {
    feedbackNow.value = Date.now();
  }, 500);

  participantToken.value = getRoomParticipantToken(roomCode.value);
  const storedDensity = window.localStorage.getItem("motocom.grid-density");
  if (storedDensity === "compact" || storedDensity === "comfortable") {
    gridDensity.value = storedDensity;
  }
  const storedName = window.localStorage.getItem("motocom.display-name");
  if (storedName) {
    localDisplayName.value = storedName;
  }

  refreshAudioAvailability();
  audioAvailabilityTicker = window.setInterval(() => {
    if (!isUnlocked.value) {
      return;
    }
    refreshAudioAvailability();
  }, AUDIO_AVAILABILITY_POLL_MS);
  document.addEventListener("visibilitychange", onVisibilityChange);
});

watch(
  () => roomState.value?.room.name,
  (roomName) => {
    if (process.client && roomName) {
      rememberRecentRoom(roomCode.value, roomName);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (feedbackTicker) {
    clearInterval(feedbackTicker);
    feedbackTicker = null;
  }

  if (audioAvailabilityTicker) {
    clearInterval(audioAvailabilityTicker);
    audioAvailabilityTicker = null;
  }

  if (process.client) {
    document.removeEventListener("visibilitychange", onVisibilityChange);
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
    <header class="card room-header">
      <NuxtLink class="icon-control" to="/" aria-label="Back to rooms">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14.5 5.5L8 12l6.5 6.5M9 12h11" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
        </svg>
      </NuxtLink>

      <div class="room-header__identity">
        <div class="room-header__title-line">
          <h1>{{ roomState?.room.name ?? `Room ${roomCode}` }}</h1>
          <span v-if="roomState?.isMainDriver" class="badge ok">Main driver</span>
        </div>
        <button type="button" class="room-code" title="Copy room code" @click="copyRoomCode">
          <span>{{ roomCode }}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="8" y="8" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" />
            <path d="M15 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7a2 2 0 002 2h2" fill="none" stroke="currentColor" stroke-width="1.8" />
          </svg>
        </button>
      </div>

      <div class="room-header__actions">
        <button type="button" class="icon-control" aria-label="Share room" @click="shareRoom">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="18" cy="5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8" />
            <circle cx="6" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8" />
            <circle cx="18" cy="19" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8" />
            <path d="M8.2 10.8l7.6-4.5M8.2 13.2l7.6 4.5" fill="none" stroke="currentColor" stroke-width="1.8" />
          </svg>
        </button>
        <button
          type="button"
          class="icon-control"
          :class="{ 'icon-control--active': showSettings }"
          :aria-label="showSettings ? 'Hide room controls' : 'Show room controls'"
          @click="showSettings = !showSettings"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h10m4 0h2M4 17h2m4 0h10M14 4v6M6 14v6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" />
          </svg>
        </button>
      </div>

      <div class="room-status-strip">
        <button
          type="button"
          class="status-pill"
          :class="isUnlocked ? 'status-pill--ok' : 'status-pill--warn'"
          :disabled="Boolean(connectionWarning) || isUnlocking"
          @click="unlockAudio"
        >
          <span class="status-pill__dot"></span>
          {{ isUnlocked ? 'Audio ready' : isUnlocking ? 'Enabling audio…' : 'Enable audio' }}
        </button>
        <span class="status-pill status-pill--neutral">
          <span class="status-pill__dot"></span>
          {{ activeParticipantCount }} online
        </span>
        <span class="status-pill status-pill--neutral">
          {{ roomState?.queue.length ?? 0 }} queued
        </span>
        <span v-if="isWakeLockSupported" class="status-pill" :class="isWakeLockActive ? 'status-pill--ok' : 'status-pill--neutral'">
          Screen {{ isWakeLockActive ? 'awake' : 'normal' }}
        </span>
      </div>
    </header>

    <section v-if="connectionWarning" class="card connection-card">
      <strong>Connection issue</strong>
      <p class="error">{{ connectionWarning }}</p>
    </section>

    <section v-if="roomPending" class="card loading-card">
      <span class="loading-spinner" aria-hidden="true"></span>
      <div><strong>Connecting to the room</strong><p class="muted">Loading live state and audio controls…</p></div>
    </section>

    <section v-else-if="!roomState" class="card empty-state">
      <span class="empty-state__icon" aria-hidden="true">?</span>
      <h2>Room not found</h2>
      <p class="muted">Check the invitation code or ask the organizer for a new link.</p>
      <NuxtLink class="empty-state__link" to="/">Return home</NuxtLink>
    </section>

    <template v-else>
      <section v-if="!joinedInRoom" class="card join-gate">
        <div class="join-gate__copy">
          <span class="join-gate__icon" aria-hidden="true">→</span>
          <div>
            <h2>Join before sending signals</h2>
            <p class="muted">Your display name helps the main driver identify requests.</p>
          </div>
        </div>
        <form class="join-gate__form" @submit.prevent="joinRoom">
          <input v-model="localDisplayName" maxlength="48" autocomplete="name" placeholder="Your name" aria-label="Your display name" />
          <button :disabled="Boolean(connectionWarning) || !isUnlocked || isJoiningRoom || !localDisplayName.trim()" type="submit">
            {{ isJoiningRoom ? 'Joining…' : 'Join room' }}
          </button>
        </form>
      </section>

      <section class="card soundboard-card">
        <div class="soundboard-header">
          <div>
            <span class="section-kicker">Ride signals</span>
            <h2>Soundboard</h2>
            <p class="muted">
              {{ joinedInRoom ? 'Tap a signal to send it to the main driver.' : 'Join the room to activate signals.' }}
            </p>
          </div>
          <div class="soundboard-tools">
            <label v-if="roomState.buttons.length > 6" class="sound-search">
              <span class="sr-only">Search signals</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2" /><path d="M15 15l5 5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" /></svg>
              <input v-model="soundSearch" type="search" placeholder="Find signal" />
            </label>
            <div class="density-switch" role="group" aria-label="Soundboard layout">
              <button type="button" :class="{ 'density-switch__active': gridDensity === 'comfortable' }" title="Comfortable layout" @click="setGridDensity('comfortable')">
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg>
              </button>
              <button type="button" :class="{ 'density-switch__active': gridDensity === 'compact' }" title="Compact layout" @click="setGridDensity('compact')">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h4v4H4zM10 4h4v4h-4zM16 4h4v4h-4zM4 10h4v4H4zM10 10h4v4h-4zM16 10h4v4h-4zM4 16h4v4H4zM10 16h4v4h-4zM16 16h4v4h-4z" /></svg>
              </button>
            </div>
          </div>
        </div>

        <div v-if="!isUnlocked" class="soundboard-notice soundboard-notice--warn">
          <strong>Audio must be enabled first.</strong>
          <button class="warn" :disabled="isUnlocking" @click="unlockAudio">{{ isUnlocking ? 'Enabling…' : 'Enable audio' }}</button>
        </div>

        <SoundGrid
          v-if="filteredButtons.length"
          :buttons="filteredButtons"
          :active-button-id="roomState.activeRequest?.buttonId ?? null"
          :button-states="buttonStates"
          :density="gridDensity"
          :removable="roomState.isMainDriver && showSettings && settingsTab === 'manage'"
          :disable-press="Boolean(connectionWarning) || !isUnlocked || !joinedInRoom || isEnqueueing || isRemovingButton"
          @press="enqueue"
          @remove="removeButtonFromBoard"
        />
        <div v-else class="empty-board">
          <strong>{{ soundSearch ? 'No matching signals' : 'No signals configured yet' }}</strong>
          <p class="muted">{{ soundSearch ? 'Try another search.' : 'A main driver can add sounds from Manage.' }}</p>
          <button v-if="soundSearch" class="ghost" @click="soundSearch = ''">Clear search</button>
        </div>
      </section>

      <section v-if="roomState.queue.length" class="queue-preview" aria-label="Request queue">
        <div class="queue-preview__title"><span>{{ roomState.queue.length }}</span> waiting</div>
        <div class="queue-preview__items">
          <span v-for="(queued, index) in roomState.queue.slice(0, 4)" :key="queued.id" class="queue-chip">
            <b>{{ index + 1 }}</b>{{ queued.buttonLabel }}
          </span>
          <span v-if="roomState.queue.length > 4" class="queue-chip queue-chip--more">+{{ roomState.queue.length - 4 }} more</span>
        </div>
      </section>

      <section v-if="showSettings" class="card control-center">
        <div class="control-center__header">
          <div>
            <span class="section-kicker">Room controls</span>
            <h2>Control center</h2>
          </div>
          <button class="ghost control-center__close" @click="showSettings = false">Done</button>
        </div>

        <nav class="settings-tabs" aria-label="Room settings">
          <button :class="{ 'settings-tabs__active': settingsTab === 'room' }" @click="settingsTab = 'room'">Room</button>
          <button :class="{ 'settings-tabs__active': settingsTab === 'people' }" @click="settingsTab = 'people'">
            People <span>{{ roomState.participants.length }}</span>
          </button>
          <button :class="{ 'settings-tabs__active': settingsTab === 'activity' }" @click="settingsTab = 'activity'">Activity</button>
          <button :class="{ 'settings-tabs__active': settingsTab === 'manage' }" @click="settingsTab = 'manage'">Manage</button>
        </nav>

        <div v-if="settingsTab === 'room'" class="settings-pane settings-grid">
          <section class="settings-tile settings-tile--invite">
            <div>
              <span class="settings-tile__label">Invite code</span>
              <strong class="settings-code">{{ roomCode }}</strong>
              <p class="muted">Share this code or invite link with your riders.</p>
            </div>
            <div class="settings-tile__actions">
              <button class="ghost" @click="copyRoomCode">Copy code</button>
              <button @click="shareRoom">Share invite</button>
            </div>
          </section>

          <section class="settings-tile">
            <span class="settings-tile__label">Your identity</span>
            <strong>{{ currentDisplayName ?? 'Not joined' }}</strong>
            <p class="muted">{{ participantRecord?.isMainDriver ? 'Main driver' : joinedInRoom ? 'Rider' : 'Join to send signals' }}</p>
          </section>

          <section v-if="joinedInRoom && !roomState.isMainDriver" class="settings-tile">
            <span class="settings-tile__label">Driver controls</span>
            <h3>Claim main driver</h3>
            <p class="muted">Use the PIN provided by the room creator.</p>
            <form class="inline-form" @submit.prevent="claimMainDriver">
              <input v-model="claimPin" type="password" minlength="6" autocomplete="current-password" placeholder="Room PIN" />
              <button class="warn" :disabled="isClaiming || !claimPin.trim()" type="submit">{{ isClaiming ? 'Checking…' : 'Claim' }}</button>
            </form>
          </section>

          <section class="settings-tile settings-tile--wide">
            <div class="volume-heading">
              <div><span class="settings-tile__label">This device</span><h3>Playback volume</h3></div>
              <span class="volume-value">{{ playbackVolumePercent }}%</span>
            </div>
            <div class="volume-control">
              <span aria-hidden="true">−</span>
              <input type="range" min="0" max="200" step="5" :value="playbackVolumePercent" aria-label="Playback volume" @input="onPlaybackVolumeInput" />
              <span aria-hidden="true">＋</span>
            </div>
          </section>
        </div>

        <div v-else-if="settingsTab === 'people'" class="settings-pane">
          <div class="pane-intro"><div><h3>Riders</h3><p class="muted">Live presence from the last two minutes.</p></div><span class="badge ok">{{ activeParticipantCount }} online</span></div>
          <PresenceList :participants="roomState.participants" />
        </div>

        <div v-else-if="settingsTab === 'activity'" class="settings-pane activity-grid">
          <section class="activity-section">
            <div class="pane-intro"><div><h3>Queue</h3><p class="muted">Requests waiting behind the current signal.</p></div><span class="badge off">{{ roomState.queue.length }}</span></div>
            <p v-if="!roomState.queue.length" class="empty-copy">Nothing is waiting.</p>
            <ol v-else class="activity-list activity-list--queue">
              <li v-for="queued in roomState.queue" :key="queued.id">
                <span class="activity-list__number"></span>
                <div><strong>{{ queued.buttonLabel }}</strong><span>{{ resolveParticipantName(queued.requestedByParticipantId) }} · {{ formatTime(queued.createdAt) }}</span></div>
              </li>
            </ol>
          </section>

          <section class="activity-section">
            <div class="pane-intro"><div><h3>Recent activity</h3><p class="muted">Latest room decisions and signals.</p></div></div>
            <p v-if="!roomState.events.length" class="empty-copy">No activity yet.</p>
            <ul v-else class="activity-list">
              <li v-for="event in roomState.events.slice().reverse().slice(0, 20)" :key="event.seq">
                <span class="activity-dot" :class="event.decision ? `activity-dot--${event.decision}` : ''"></span>
                <div><strong>{{ eventLabel(event) }}</strong><span>{{ resolveParticipantName(event.actorParticipantId) }} · {{ formatTime(event.createdAt) }}</span></div>
              </li>
            </ul>
          </section>

          <details class="diagnostics settings-tile--wide">
            <summary>Audio and screen diagnostics</summary>
            <div class="diagnostics__status">
              <span class="badge" :class="isUnlocked ? 'ok' : 'off'">Audio {{ isUnlocked ? 'ready' : 'locked' }}</span>
              <span class="badge" :class="isWakeLockActive ? 'ok' : 'off'">Screen {{ isWakeLockActive ? 'awake' : 'normal' }}</span>
              <button class="ghost" :disabled="!systemDiagnosticsLog.length" @click="clearSystemDiagnosticsLog">Clear log</button>
            </div>
            <p v-if="!systemDiagnosticsLog.length" class="muted">No diagnostic entries.</p>
            <ul v-else class="diagnostic-list">
              <li v-for="entry in systemDiagnosticsLog" :key="entry.id" :class="{ 'diagnostic-list__error': entry.level === 'error' }">
                <span>{{ formatTime(entry.createdAt) }} · {{ entry.scope }}</span>
                <strong>{{ entry.message }}</strong>
                <small v-if="entry.detail">{{ entry.detail }}</small>
              </li>
            </ul>
          </details>
        </div>

        <div v-else class="settings-pane">
          <MainDriverPanel
            v-if="roomState.isMainDriver"
            :room-id="roomState.room.id"
            :participant-token="participantToken"
            :owner-token="ownerToken"
            :buttons="roomState.buttons"
            :outcome-sounds="roomState.outcomeSounds"
            :app-enabled="isUnlocked"
          />
          <div v-else class="permission-state">
            <span aria-hidden="true">🔒</span>
            <h3>Main driver access</h3>
            <p class="muted">Claim the main driver role from the Room tab to edit signals, sounds, and templates.</p>
            <button class="ghost" @click="settingsTab = 'room'">Go to Room controls</button>
          </div>
        </div>
      </section>

      <section v-if="showLiveRequestDock" class="live-request-dock">
        <ActiveRequestPanel
          :active-request="roomState.activeRequest"
          :is-main-driver="roomState.isMainDriver"
          :is-resolving="Boolean(connectionWarning) || !isUnlocked || isResolving"
          :queue-length="roomState.queue.length"
          :requester-name="resolveParticipantName(roomState.activeRequest?.requestedByParticipantId)"
          @resolve="resolveActiveRequest"
        />
      </section>
    </template>

    <section v-if="!isUnlocked && roomState" class="audio-prompt-banner" :class="{ 'audio-prompt-banner--above-dock': showLiveRequestDock }">
      <div class="audio-prompt-banner__card">
        <span class="audio-prompt-banner__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M4 10h4l5-4v12l-5-4H4v-4zm12-2a6 6 0 010 8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" /></svg>
        </span>
        <div><strong>Enable sound to use Motocom</strong><p>Synchronized audio needs one tap after opening the app.</p></div>
        <button class="warn" :disabled="Boolean(connectionWarning) || isUnlocking" @click="unlockAudio">{{ isUnlocking ? 'Enabling…' : 'Enable audio' }}</button>
      </div>
    </section>

    <Transition name="toast">
      <div v-if="pageError || pageSuccess" class="page-toast" :class="pageError ? 'page-toast--error' : 'page-toast--success'" role="status">
        <span>{{ pageError || pageSuccess }}</span>
        <button aria-label="Dismiss message" @click="clearMessages">×</button>
      </div>
    </Transition>
  </main>
</template>

<style scoped>
.room-page {
  max-width: 1040px;
  padding-top: 1rem;
}

.room-page--with-dock {
  padding-bottom: 12rem;
}

.room-page--with-audio-prompt {
  padding-bottom: 10rem;
}

.room-header {
  display: grid;
  gap: 0.9rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  padding: 0.85rem;
  position: sticky;
  top: 0.65rem;
  z-index: 35;
}

.icon-control {
  align-items: center;
  align-self: start;
  background: #f5f8fb;
  border: 1px solid var(--panel-border);
  border-radius: 12px;
  color: #40556f;
  display: inline-flex;
  height: 42px;
  justify-content: center;
  min-height: 42px;
  padding: 0;
  text-decoration: none;
  width: 42px;
}

.icon-control svg {
  height: 20px;
  width: 20px;
}

.icon-control:hover:not(:disabled) {
  background: var(--blue-soft);
  border-color: #bfd0e3;
  box-shadow: none;
  color: var(--blue);
}

.icon-control--active {
  background: var(--accent-soft);
  border-color: #acd5c5;
  color: var(--accent);
}

.room-header__identity {
  min-width: 0;
}

.room-header__title-line {
  align-items: center;
  display: flex;
  gap: 0.6rem;
  min-width: 0;
}

.room-header__title-line h1 {
  font-size: clamp(1.15rem, 3vw, 1.55rem);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.room-code {
  background: transparent;
  border: 0;
  color: var(--text-muted);
  gap: 0.35rem;
  min-height: 44px;
  padding: 0.35rem 0;
}

.room-code:hover:not(:disabled) {
  background: transparent;
  box-shadow: none;
  color: var(--accent);
  transform: none;
}

.room-code span {
  font-size: 0.78rem;
  font-weight: 850;
  letter-spacing: 0.13em;
}

.room-code svg {
  height: 14px;
  width: 14px;
}

.room-header__actions {
  display: flex;
  gap: 0.45rem;
}

.room-status-strip {
  border-top: 1px solid var(--panel-border);
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  grid-column: 1 / -1;
  padding-top: 0.75rem;
}

.status-pill {
  align-items: center;
  background: #f3f6fa;
  border: 1px solid #e0e6ef;
  border-radius: 999px;
  color: #596a80;
  display: inline-flex;
  font-size: 0.72rem;
  font-weight: 800;
  gap: 0.42rem;
  min-height: 29px;
  padding: 0.28rem 0.62rem;
}

button.status-pill {
  min-height: 40px;
  padding-left: 0.72rem;
  padding-right: 0.72rem;
}

button.status-pill:hover:not(:disabled) {
  box-shadow: none;
  transform: none;
}

.status-pill__dot {
  background: currentColor;
  border-radius: 999px;
  height: 7px;
  width: 7px;
}

.status-pill--ok {
  background: var(--ok-soft);
  border-color: #c8e6d2;
  color: #287246;
}

.status-pill--warn {
  background: var(--warn-soft);
  border-color: #efd5a8;
  color: #925d17;
}

.status-pill--neutral {
  background: #f3f6fa;
  border-color: #e0e6ef;
  color: #596a80;
}

.connection-card,
.loading-card,
.empty-state,
.join-gate,
.soundboard-card,
.control-center {
  margin-top: 0.85rem;
}

.connection-card > .error {
  margin-bottom: 0;
}

.loading-card {
  align-items: center;
  display: flex;
  gap: 0.9rem;
}

.loading-card p {
  margin: 0.15rem 0 0;
}

.loading-spinner {
  animation: spin 0.8s linear infinite;
  border: 3px solid #dfe7f0;
  border-radius: 999px;
  border-top-color: var(--accent);
  height: 28px;
  width: 28px;
}

.empty-state {
  align-items: center;
  display: flex;
  flex-direction: column;
  padding: 3.5rem 1rem;
  text-align: center;
}

.empty-state__icon {
  align-items: center;
  background: var(--blue-soft);
  border-radius: 18px;
  color: var(--blue);
  display: inline-flex;
  font-size: 1.4rem;
  font-weight: 900;
  height: 56px;
  justify-content: center;
  margin-bottom: 1rem;
  width: 56px;
}

.empty-state__link {
  background: var(--accent);
  border-radius: 12px;
  color: #fff;
  font-weight: 800;
  margin-top: 0.8rem;
  padding: 0.65rem 1rem;
  text-decoration: none;
}

.join-gate {
  align-items: center;
  background: linear-gradient(135deg, #fff, #f1f8f5);
  border-color: #c9e0d7;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.join-gate__copy {
  align-items: center;
  display: flex;
  gap: 0.75rem;
}

.join-gate__copy p {
  margin: 0.2rem 0 0;
}

.join-gate__icon {
  align-items: center;
  background: var(--accent-soft);
  border-radius: 12px;
  color: var(--accent);
  display: inline-flex;
  flex: 0 0 auto;
  font-weight: 900;
  height: 42px;
  justify-content: center;
  width: 42px;
}

.join-gate__form {
  display: flex;
  flex: 0 1 420px;
  gap: 0.55rem;
}

.join-gate__form input {
  min-width: 0;
}

.soundboard-card {
  padding: 1rem;
}

.soundboard-header {
  align-items: flex-end;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.section-kicker {
  color: var(--accent);
  display: block;
  font-size: 0.69rem;
  font-weight: 900;
  letter-spacing: 0.11em;
  margin-bottom: 0.18rem;
  text-transform: uppercase;
}

.soundboard-header p {
  font-size: 0.84rem;
  margin: 0.2rem 0 0;
}

.soundboard-tools {
  align-items: center;
  display: flex;
  gap: 0.55rem;
}

.sound-search {
  margin: 0;
  position: relative;
  width: 190px;
}

.sound-search svg {
  color: #75859a;
  height: 17px;
  left: 0.7rem;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 17px;
}

.sound-search input {
  min-height: 40px;
  padding-left: 2rem;
}

.density-switch {
  background: #f0f4f8;
  border: 1px solid #dce4ee;
  border-radius: 11px;
  display: flex;
  padding: 3px;
}

.density-switch button {
  background: transparent;
  border-radius: 8px;
  color: #748399;
  height: 40px;
  min-height: 40px;
  padding: 0;
  width: 40px;
}

.density-switch button:hover:not(:disabled) {
  background: #fff;
  box-shadow: none;
  transform: none;
}

.density-switch .density-switch__active {
  background: #fff;
  box-shadow: var(--shadow-sm);
  color: var(--accent);
}

.density-switch svg {
  fill: currentColor;
  height: 17px;
  width: 17px;
}

.soundboard-notice {
  align-items: center;
  border-radius: 13px;
  display: flex;
  gap: 0.8rem;
  justify-content: space-between;
  margin-bottom: 0.8rem;
  padding: 0.7rem 0.8rem;
}

.soundboard-notice--warn {
  background: var(--warn-soft);
  border: 1px solid #efd5a8;
  color: #825315;
}

.soundboard-notice button {
  min-height: 38px;
  padding: 0.4rem 0.7rem;
}

.empty-board {
  align-items: center;
  background: var(--panel-soft);
  border: 1px dashed var(--panel-border-strong);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  padding: 3rem 1rem;
  text-align: center;
}

.empty-board p {
  margin: 0.2rem 0 0.8rem;
}

.queue-preview {
  align-items: center;
  background: rgb(255 255 255 / 78%);
  border: 1px solid var(--panel-border);
  border-radius: 14px;
  display: flex;
  gap: 0.75rem;
  margin-top: 0.7rem;
  overflow: hidden;
  padding: 0.6rem 0.75rem;
}

.queue-preview__title {
  align-items: center;
  color: var(--text-muted);
  display: flex;
  flex: 0 0 auto;
  font-size: 0.75rem;
  font-weight: 800;
  gap: 0.35rem;
}

.queue-preview__title span {
  align-items: center;
  background: var(--warn-soft);
  border-radius: 7px;
  color: var(--warn);
  display: inline-flex;
  height: 25px;
  justify-content: center;
  width: 25px;
}

.queue-preview__items {
  display: flex;
  gap: 0.4rem;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.queue-chip {
  align-items: center;
  background: #f2f5f9;
  border-radius: 999px;
  color: #53647a;
  display: inline-flex;
  flex: 0 0 auto;
  font-size: 0.73rem;
  font-weight: 750;
  gap: 0.35rem;
  padding: 0.28rem 0.55rem;
}

.queue-chip b {
  color: var(--warn);
}

.queue-chip--more {
  color: var(--text-muted);
}

.control-center {
  padding: 1rem;
}

.control-center__header,
.pane-intro,
.volume-heading {
  align-items: center;
  display: flex;
  gap: 0.8rem;
  justify-content: space-between;
}

.control-center__close {
  min-height: 40px;
  padding: 0.4rem 0.75rem;
}

.settings-tabs {
  border-bottom: 1px solid var(--panel-border);
  display: flex;
  gap: 0.2rem;
  margin: 1rem -1rem 0;
  overflow-x: auto;
  padding: 0 1rem;
  scrollbar-width: none;
}

.settings-tabs button {
  background: transparent;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  color: var(--text-muted);
  gap: 0.35rem;
  min-height: 44px;
  padding: 0.6rem 0.75rem;
  white-space: nowrap;
}

.settings-tabs button:hover:not(:disabled) {
  background: transparent;
  box-shadow: none;
  color: var(--text-main);
  transform: none;
}

.settings-tabs .settings-tabs__active {
  border-bottom-color: var(--accent);
  color: var(--accent);
}

.settings-tabs button span {
  align-items: center;
  background: #edf1f5;
  border-radius: 999px;
  display: inline-flex;
  font-size: 0.65rem;
  height: 20px;
  justify-content: center;
  min-width: 20px;
  padding: 0 0.3rem;
}

.settings-pane {
  padding-top: 1rem;
}

.settings-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.settings-tile {
  background: var(--panel-soft);
  border: 1px solid var(--panel-border);
  border-radius: 14px;
  padding: 0.9rem;
}

.settings-tile--invite,
.settings-tile--wide {
  grid-column: 1 / -1;
}

.settings-tile--invite {
  align-items: center;
  background: linear-gradient(135deg, #f8fbff, #f0f8f5);
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.settings-tile__label {
  color: var(--text-muted);
  display: block;
  font-size: 0.7rem;
  font-weight: 850;
  letter-spacing: 0.08em;
  margin-bottom: 0.25rem;
  text-transform: uppercase;
}

.settings-code {
  font-size: 1.35rem;
  letter-spacing: 0.16em;
}

.settings-tile p {
  font-size: 0.8rem;
  margin: 0.25rem 0 0;
}

.settings-tile__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.inline-form {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.inline-form input {
  min-width: 0;
}

.volume-value {
  color: var(--accent);
  font-size: 1.1rem;
  font-weight: 900;
}

.volume-control {
  align-items: center;
  display: grid;
  gap: 0.65rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  margin-top: 0.7rem;
}

.volume-control input[type="range"] {
  min-height: auto;
  padding: 0;
}

.activity-grid {
  display: grid;
  gap: 0.8rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.activity-section {
  background: var(--panel-soft);
  border: 1px solid var(--panel-border);
  border-radius: 14px;
  min-width: 0;
  padding: 0.9rem;
}

.pane-intro p {
  font-size: 0.8rem;
  margin: 0.2rem 0 0;
}

.empty-copy {
  color: var(--text-muted);
  font-size: 0.84rem;
  margin: 1rem 0 0;
}

.activity-list {
  list-style: none;
  margin: 0.75rem 0 0;
  max-height: 22rem;
  overflow: auto;
  padding: 0;
}

.activity-list li {
  align-items: flex-start;
  border-top: 1px solid #e1e7ef;
  display: flex;
  gap: 0.6rem;
  padding: 0.65rem 0;
}

.activity-list li:first-child {
  border-top: 0;
  padding-top: 0;
}

.activity-list li > div {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.activity-list strong {
  font-size: 0.82rem;
}

.activity-list li span:not(.activity-dot):not(.activity-list__number) {
  color: var(--text-muted);
  font-size: 0.72rem;
}

.activity-dot,
.activity-list__number {
  background: #9aabba;
  border: 4px solid #e8edf3;
  border-radius: 999px;
  flex: 0 0 auto;
  height: 14px;
  margin-top: 0.18rem;
  width: 14px;
}

.activity-dot--accepted {
  background: var(--ok);
  border-color: #dcefe3;
}

.activity-dot--rejected {
  background: var(--danger);
  border-color: #f7dddc;
}

.activity-list--queue {
  counter-reset: queue;
}

.activity-list--queue .activity-list__number {
  align-items: center;
  background: var(--warn-soft);
  border: 0;
  color: var(--warn);
  counter-increment: queue;
  display: inline-flex;
  font-size: 0.68rem;
  font-weight: 900;
  height: 23px;
  justify-content: center;
  margin-top: 0;
  width: 23px;
}

.activity-list--queue .activity-list__number::before {
  content: counter(queue);
}

.diagnostics {
  background: var(--panel-soft);
  border: 1px solid var(--panel-border);
  border-radius: 14px;
  grid-column: 1 / -1;
  padding: 0.8rem;
}

.diagnostics summary {
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 850;
}

.diagnostics__status {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin: 0.75rem 0;
}

.diagnostics__status button {
  margin-left: auto;
  min-height: 32px;
  padding: 0.3rem 0.55rem;
}

.diagnostic-list {
  list-style: none;
  margin: 0;
  max-height: 14rem;
  overflow: auto;
  padding: 0;
}

.diagnostic-list li {
  border-top: 1px solid var(--panel-border);
  display: flex;
  flex-direction: column;
  font-size: 0.75rem;
  padding: 0.55rem 0;
}

.diagnostic-list li > span,
.diagnostic-list small {
  color: var(--text-muted);
}

.diagnostic-list__error strong {
  color: var(--danger);
}

.permission-state {
  align-items: center;
  display: flex;
  flex-direction: column;
  padding: 2.5rem 1rem;
  text-align: center;
}

.permission-state > span {
  font-size: 1.7rem;
  margin-bottom: 0.6rem;
}

.permission-state p {
  max-width: 450px;
}

.live-request-dock {
  bottom: 0;
  left: 0;
  padding: 0 0.7rem max(0.7rem, env(safe-area-inset-bottom));
  position: fixed;
  right: 0;
  z-index: 60;
}

.live-request-dock :deep(.active-panel.card) {
  border-color: #c8d6e6;
  box-shadow: var(--shadow-lg);
  margin: 0 auto;
  max-width: 1020px;
}

.audio-prompt-banner {
  bottom: 0;
  left: 0;
  padding: 0 0.7rem max(0.7rem, env(safe-area-inset-bottom));
  position: fixed;
  right: 0;
  z-index: 70;
}

.audio-prompt-banner--above-dock {
  bottom: 7.1rem;
}

.audio-prompt-banner__card {
  align-items: center;
  background: #fffaf1;
  border: 1px solid #e8c88f;
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  display: grid;
  gap: 0.75rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  margin: 0 auto;
  max-width: 1020px;
  padding: 0.75rem;
}

.audio-prompt-banner__icon {
  align-items: center;
  background: var(--warn-soft);
  border-radius: 11px;
  color: var(--warn);
  display: inline-flex;
  height: 40px;
  justify-content: center;
  width: 40px;
}

.audio-prompt-banner__icon svg {
  height: 22px;
  width: 22px;
}

.audio-prompt-banner p {
  color: #806236;
  font-size: 0.76rem;
  margin: 0.1rem 0 0;
}

.page-toast {
  align-items: center;
  border: 1px solid;
  border-radius: 13px;
  bottom: 1rem;
  box-shadow: var(--shadow-lg);
  display: flex;
  font-size: 0.84rem;
  font-weight: 750;
  gap: 0.75rem;
  justify-content: space-between;
  left: 50%;
  max-width: min(92vw, 520px);
  padding: 0.65rem 0.75rem 0.65rem 0.9rem;
  position: fixed;
  transform: translateX(-50%);
  width: max-content;
  z-index: 100;
}

.page-toast--success {
  background: #effaf3;
  border-color: #b6dec4;
  color: #286c43;
}

.page-toast--error {
  background: #fff2f1;
  border-color: #ebbbb8;
  color: #983834;
}

.page-toast button {
  background: transparent;
  color: currentColor;
  font-size: 1rem;
  height: 28px;
  min-height: 28px;
  padding: 0;
  width: 28px;
}

.page-toast button:hover:not(:disabled) {
  background: rgb(0 0 0 / 5%);
  box-shadow: none;
  transform: none;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 10px);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 760px) {
  .room-page {
    padding-top: 0.55rem;
  }

  .room-header {
    gap: 0.6rem;
    grid-template-columns: auto minmax(0, 1fr) auto;
    padding: 0.65rem;
    top: 0.35rem;
  }

  .room-header__title-line .badge {
    display: none;
  }

  .room-header__actions {
    gap: 0.3rem;
  }

  .icon-control {
    border-radius: 10px;
    height: 38px;
    min-height: 38px;
    width: 38px;
  }

  .room-status-strip {
    gap: 0.35rem;
    flex-wrap: wrap;
    overflow-x: visible;
  }

  .status-pill {
    flex: 0 0 auto;
  }

  .join-gate,
  .soundboard-header,
  .settings-tile--invite {
    align-items: stretch;
    flex-direction: column;
  }

  .join-gate__form {
    flex-basis: auto;
  }

  .soundboard-tools {
    justify-content: space-between;
  }

  .sound-search {
    flex: 1 1 auto;
    width: auto;
  }

  .settings-grid,
  .activity-grid {
    grid-template-columns: 1fr;
  }

  .settings-tile--invite,
  .settings-tile--wide,
  .diagnostics {
    grid-column: auto;
  }

  .audio-prompt-banner--above-dock {
    bottom: 7.6rem;
  }

  .audio-prompt-banner__card {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .audio-prompt-banner__card > button {
    grid-column: 1 / -1;
    width: 100%;
  }
}

@media (max-width: 520px) {
  .room-header__actions .icon-control:first-child {
    display: none;
  }

  .join-gate__copy {
    align-items: flex-start;
  }

  .join-gate__form,
  .inline-form {
    flex-direction: column;
  }

  .soundboard-card,
  .control-center {
    padding: 0.8rem;
  }

  .settings-tabs {
    margin-left: -0.8rem;
    margin-right: -0.8rem;
    padding-left: 0.8rem;
    padding-right: 0.8rem;
  }

  .page-toast {
    bottom: 0.65rem;
    width: calc(100vw - 1.3rem);
  }
}
</style>
