<script setup lang="ts">
import { api } from "~/convex/_generated/api";
import { generateRoomCode } from "~/utils/roomCode";
import { buildConnectivityHint, runMutation, toErrorMessage } from "~/utils/mutation";
import {
  createClientSecretToken,
  createOperationId,
  getRoomParticipantToken,
  setRoomParticipantToken,
} from "~/utils/participantToken";

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
const pendingCreate = ref<{
  fingerprint: string;
  roomCode: string;
  participantToken: string;
  operationId: string;
} | null>(null);
const pendingJoin = ref<{ roomCode: string; participantToken: string } | null>(null);
const connectionWarning = computed(() => buildConnectivityHint(convexUrl));

function trimToString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function hasText(value: unknown): boolean {
  return trimToString(value).length > 0;
}

const { mutate: createRoomMutation } = useConvexMutation(api.rooms.createRoom);
const { mutate: joinRoomMutation } = useConvexMutation(api.rooms.joinRoom);

const canCreateRoom = computed(() => (
  !connectionWarning.value &&
  !isCreating.value &&
  hasText(createRoomName.value) &&
  hasText(createDisplayName.value) &&
  trimToString(createPin.value).length >= 6
));

const canJoinRoom = computed(() => (
  !connectionWarning.value &&
  !isJoining.value &&
  hasText(joinRoomCode.value) &&
  hasText(joinDisplayName.value)
));

const createRoom = async () => {
  errorMessage.value = "";
  isCreating.value = true;

  try {
    const roomName = trimToString(createRoomName.value);
    const displayName = trimToString(createDisplayName.value);
    const mainDriverPin = trimToString(createPin.value);
    const fingerprint = [roomName, displayName, mainDriverPin].join("|");
    if (pendingCreate.value?.fingerprint !== fingerprint) {
      pendingCreate.value = {
        fingerprint,
        roomCode: generateRoomCode(),
        participantToken: createClientSecretToken(),
        operationId: createOperationId(),
      };
    }
    const maxAttempts = 8;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const createAttempt = pendingCreate.value;
      if (!createAttempt) {
        throw new Error("Unable to prepare room creation");
      }
      try {
        const result = await runMutation<
          {
            roomCode: string;
            roomName: string;
            displayName: string;
            mainDriverPin: string;
            participantToken: string;
            operationId: string;
          },
          { participantToken: string }
        >(createRoomMutation, {
          roomCode: createAttempt.roomCode,
          roomName,
          displayName,
          mainDriverPin,
          participantToken: createAttempt.participantToken,
          operationId: createAttempt.operationId,
        }, {
          operationName: "Create room",
          convexUrl,
        });

        setRoomParticipantToken(createAttempt.roomCode, result.participantToken);
        if (process.client) {
          window.localStorage.setItem("motocom.display-name", displayName);
        }
        const createdRoomCode = createAttempt.roomCode;
        pendingCreate.value = null;
        await navigateTo(`/room/${createdRoomCode}`);
        return;
      } catch (error) {
        const message = toErrorMessage(error);
        const isCollision = message.toLowerCase().includes("already in use");
        if (!isCollision || attempt === maxAttempts - 1) {
          throw error;
        }
        if (pendingCreate.value) {
          pendingCreate.value.roomCode = generateRoomCode();
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
    const selectedCode = trimToString(joinRoomCode.value).toUpperCase().replace(/\s+/g, "");
    const displayName = trimToString(joinDisplayName.value);
    const existingToken = getRoomParticipantToken(selectedCode);
    if (pendingJoin.value?.roomCode !== selectedCode) {
      pendingJoin.value = {
        roomCode: selectedCode,
        participantToken: existingToken || createClientSecretToken(),
      };
    }
    const candidateToken = pendingJoin.value.participantToken;
    const result = await runMutation<
      { roomCode: string; displayName: string; participantToken: string },
      { participantToken: string }
    >(joinRoomMutation, {
      roomCode: selectedCode,
      displayName,
      participantToken: candidateToken,
    }, {
      operationName: "Join room",
      convexUrl,
    });

    setRoomParticipantToken(selectedCode, result.participantToken);
    pendingJoin.value = null;
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
        Create a private ride room or join one using its invitation code.
      </p>
      <p v-if="connectionWarning" class="error">{{ connectionWarning }}</p>
    </section>

    <section class="card">
      <h2>Create Room</h2>
      <p class="muted">A private room code is generated after creation.</p>
      <div class="row">
        <div class="field-col">
          <label>Room name</label>
          <input v-model="createRoomName" maxlength="80" placeholder="Sunday Group" />
        </div>
      </div>
      <div class="row">
        <div class="field-col">
          <label>Your display name</label>
          <input v-model="createDisplayName" maxlength="48" placeholder="Alex" />
        </div>
        <div class="field-col">
          <label>Main driver PIN</label>
          <input
            v-model="createPin"
            type="password"
            minlength="6"
            autocomplete="new-password"
            placeholder="At least 6 characters"
          />
        </div>
      </div>
      <button :disabled="!canCreateRoom" @click="createRoom">
        {{ isCreating ? 'Creating...' : 'Create Room' }}
      </button>
    </section>

    <section class="card">
      <h2>Join Room</h2>
      <p class="muted">Enter the room code shared by your ride organizer.</p>
      <div class="row">
        <div class="field-col">
          <label>Room code</label>
          <input
            v-model="joinRoomCode"
            maxlength="12"
            autocapitalize="characters"
            autocomplete="off"
            placeholder="ABC123"
          />
        </div>
        <div class="field-col">
          <label>Your display name</label>
          <input v-model="joinDisplayName" maxlength="48" placeholder="Alex" />
        </div>
      </div>

      <button class="secondary" :disabled="!canJoinRoom" @click="joinRoom">
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
