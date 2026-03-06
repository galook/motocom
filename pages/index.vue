<script setup lang="ts">
import { api } from "~/convex/_generated/api";
import type { ActiveRoomSummary } from "~/types/soundboard";
import { generateRoomCode } from "~/utils/roomCode";
import { buildConnectivityHint, runMutation, toErrorMessage } from "~/utils/mutation";

const sessionId = useSessionId();
const runtimeConfig = useRuntimeConfig();
const convexUrl = String(runtimeConfig.public.convexUrl || "");

const createRoomName = ref("");
const createDisplayName = ref("");
const createPin = ref("");

const joinRoomCode = ref("");
const joinDisplayName = ref("");

const isCreating = ref(false);
const isJoining = ref(false);
const errorMessage = ref("");
const connectionWarning = computed(() => buildConnectivityHint(convexUrl));

function trimToString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function hasText(value: unknown): boolean {
  return trimToString(value).length > 0;
}

function toActiveRooms(value: unknown): ActiveRoomSummary[] {
  return Array.isArray(value) ? value as ActiveRoomSummary[] : [];
}

const { data: activeRoomsData, isPending: activeRoomsPending } = useConvexQuery(
  api.rooms.listActiveRooms,
  {},
);

const activeRooms = computed<ActiveRoomSummary[]>(() => toActiveRooms(activeRoomsData.value));
const hasActiveRooms = computed(() => activeRooms.value.length > 0);

watch(
  activeRooms,
  (roomsValue) => {
    const rooms = toActiveRooms(roomsValue);
    if (!joinRoomCode.value && rooms.length > 0) {
      joinRoomCode.value = rooms[0].code;
    }

    if (joinRoomCode.value && !rooms.find((room) => room.code === joinRoomCode.value)) {
      joinRoomCode.value = rooms[0]?.code ?? "";
    }
  },
  { immediate: true },
);

const { mutate: createRoomMutation } = useConvexMutation(api.rooms.createRoom);
const { mutate: joinRoomMutation } = useConvexMutation(api.rooms.joinRoom);

const canCreateRoom = computed(() => (
  !connectionWarning.value &&
  !isCreating.value &&
  hasText(createRoomName.value) &&
  hasText(createDisplayName.value) &&
  hasText(createPin.value)
));

const canJoinRoom = computed(() => (
  !connectionWarning.value &&
  !isJoining.value &&
  hasText(joinRoomCode.value) &&
  hasText(joinDisplayName.value)
));

const requireSessionId = () => {
  if (!sessionId.value) {
    throw new Error("Session is not ready yet. Refresh and try again.");
  }
};

const createRoom = async () => {
  errorMessage.value = "";
  isCreating.value = true;

  try {
    requireSessionId();
    const roomName = trimToString(createRoomName.value);
    const displayName = trimToString(createDisplayName.value);
    const mainDriverPin = trimToString(createPin.value);

    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const generatedCode = generateRoomCode();

      try {
        await runMutation(createRoomMutation, {
          roomCode: generatedCode,
          roomName,
          displayName,
          mainDriverPin,
          sessionId: sessionId.value,
        }, {
          operationName: "Create room",
          convexUrl,
        });

        if (process.client) {
          window.localStorage.setItem("motocom.display-name", displayName);
        }

        await navigateTo(`/room/${generatedCode}`);
        return;
      } catch (error) {
        const message = toErrorMessage(error);
        const isCollision = message.toLowerCase().includes("already in use");
        if (!isCollision || attempt === maxAttempts - 1) {
          throw error;
        }
      }
    }
  } catch (error) {
    errorMessage.value = toErrorMessage(error);
  } finally {
    isCreating.value = false;
  }
};

const joinRoom = async () => {
  errorMessage.value = "";
  isJoining.value = true;

  try {
    requireSessionId();
    const selectedCode = trimToString(joinRoomCode.value).toUpperCase();
    const displayName = trimToString(joinDisplayName.value);
    await runMutation(joinRoomMutation, {
      roomCode: selectedCode,
      displayName,
      sessionId: sessionId.value,
    }, {
      operationName: "Join room",
      convexUrl,
    });

    if (process.client) {
      window.localStorage.setItem("motocom.display-name", displayName);
    }

    await navigateTo(`/room/${selectedCode}`);
  } catch (error) {
    errorMessage.value = toErrorMessage(error);
  } finally {
    isJoining.value = false;
  }
};

onMounted(() => {
  const storedDisplayName = window.localStorage.getItem("motocom.display-name");
  if (storedDisplayName) {
    createDisplayName.value = storedDisplayName;
    joinDisplayName.value = storedDisplayName;
  }
});
</script>

<template>
  <main class="page">
    <section class="card">
      <h1>Motocom Sync Board</h1>
      <p class="muted">
        Create a room with an auto-generated code or join one of the currently active rooms.
      </p>
      <p v-if="connectionWarning" class="error">{{ connectionWarning }}</p>
    </section>

    <section class="card">
      <h2>Create Room</h2>
      <p class="muted">Room code is generated automatically when you create.</p>
      <div class="row">
        <div class="field-col">
          <label>Room name</label>
          <input v-model="createRoomName" placeholder="Sunday Group" />
        </div>
      </div>
      <div class="row">
        <div class="field-col">
          <label>Your display name</label>
          <input v-model="createDisplayName" placeholder="Alex" />
        </div>
        <div class="field-col">
          <label>Main driver PIN</label>
          <input v-model="createPin" type="password" placeholder="Create PIN" />
        </div>
      </div>
      <button
        :disabled="!canCreateRoom"
        @click="createRoom"
      >
        {{ isCreating ? 'Creating...' : 'Create Room' }}
      </button>
    </section>

    <section class="card">
      <h2>Join Active Room</h2>
      <p class="muted" v-if="activeRoomsPending">Loading active rooms...</p>
      <p class="muted" v-else-if="!hasActiveRooms">
        No active rooms right now.
      </p>

      <div class="row">
        <div class="field-col">
          <label>Active room</label>
          <select v-model="joinRoomCode" :disabled="!hasActiveRooms">
            <option v-for="room in activeRooms" :key="room.id" :value="room.code">
              {{ room.name }} ({{ room.code }}) · {{ room.activeParticipants }} active
            </option>
          </select>
        </div>
        <div class="field-col">
          <label>Your display name</label>
          <input v-model="joinDisplayName" placeholder="Alex" />
        </div>
      </div>

      <button
        class="secondary"
        :disabled="!canJoinRoom"
        @click="joinRoom"
      >
        {{ isJoining ? 'Joining...' : 'Join Room' }}
      </button>
    </section>

    <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
  </main>
</template>

<style scoped>
.field-col {
  flex: 1 1 250px;
}
</style>
