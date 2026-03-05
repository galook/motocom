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

const { data: activeRoomsData, isPending: activeRoomsPending } = useConvexQuery(
  api.rooms.listActiveRooms,
  {},
);

const activeRooms = computed(() => (activeRoomsData.value ?? []) as ActiveRoomSummary[]);

watch(
  activeRooms,
  (rooms) => {
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

    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const generatedCode = generateRoomCode();

      try {
        await runMutation(createRoomMutation, {
          roomCode: generatedCode,
          roomName: createRoomName.value.trim(),
          displayName: createDisplayName.value.trim(),
          mainDriverPin: createPin.value,
          sessionId: sessionId.value,
        }, {
          operationName: "Create room",
          convexUrl,
        });

        if (process.client) {
          window.localStorage.setItem("motocom.display-name", createDisplayName.value.trim());
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

    const selectedCode = joinRoomCode.value.trim().toUpperCase();
    await runMutation(joinRoomMutation, {
      roomCode: selectedCode,
      displayName: joinDisplayName.value.trim(),
      sessionId: sessionId.value,
    }, {
      operationName: "Join room",
      convexUrl,
    });

    if (process.client) {
      window.localStorage.setItem("motocom.display-name", joinDisplayName.value.trim());
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
      <p class="muted">Session: {{ sessionId || 'initializing...' }}</p>
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
        :disabled="Boolean(connectionWarning) || isCreating || !createRoomName.trim() || !createDisplayName.trim() || !createPin.trim()"
        @click="createRoom"
      >
        {{ isCreating ? 'Creating...' : 'Create Room' }}
      </button>
    </section>

    <section class="card">
      <h2>Join Active Room</h2>
      <p class="muted" v-if="activeRoomsPending">Loading active rooms...</p>
      <p class="muted" v-else-if="!activeRooms.length">
        No active rooms right now.
      </p>

      <div class="row">
        <div class="field-col">
          <label>Active room</label>
          <select v-model="joinRoomCode" :disabled="!activeRooms.length">
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
        :disabled="Boolean(connectionWarning) || isJoining || !joinRoomCode.trim() || !joinDisplayName.trim()"
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
