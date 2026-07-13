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
import {
  forgetRecentRoom,
  getRecentRooms,
  rememberRecentRoom,
  type RecentRoom,
} from "~/utils/recentRooms";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const route = useRoute();
useHead({
  title: "Motocom — Group ride soundboard",
  meta: [
    {
      name: "description",
      content: "Create or join a synchronized soundboard for your motorcycle group ride.",
    },
  ],
});
const runtimeConfig = useRuntimeConfig();
const convexUrl = String(runtimeConfig.public.convexUrl || "");

const activeMode = ref<"join" | "create">("join");
const createRoomName = ref("");
const createDisplayName = ref("");
const createPin = ref("");
const joinRoomCode = ref("");
const joinDisplayName = ref("");
const isCreating = ref(false);
const isJoining = ref(false);
const isInstalling = ref(false);
const errorMessage = ref("");
const recentRooms = ref<RecentRoom[]>([]);
const installPrompt = ref<InstallPromptEvent | null>(null);
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

const normalizedJoinCode = computed(() =>
  trimToString(joinRoomCode.value).toUpperCase().replace(/\s+/g, ""),
);

const selectRecentRoom = (room: RecentRoom) => {
  joinRoomCode.value = room.code;
  activeMode.value = "join";
  document.querySelector<HTMLInputElement>("#join-display-name")?.focus();
};

const removeRecentRoom = (code: string) => {
  recentRooms.value = forgetRecentRoom(code);
};

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
        rememberRecentRoom(createAttempt.roomCode, roomName);
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
    const selectedCode = normalizedJoinCode.value;
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
    rememberRecentRoom(selectedCode, `Room ${selectedCode}`);
    pendingJoin.value = null;
    if (process.client) {
      window.localStorage.setItem("motocom.display-name", displayName);
    }
    await navigateTo(`/room/${selectedCode}`);
  } catch (error) {
    const message = toErrorMessage(error);
    errorMessage.value = /\[CONVEX\b[\s\S]*Server Error|Called by client|The request could not be completed/i.test(message)
      ? "Room not found or no longer available. Check the invitation code and try again."
      : message;
  } finally {
    isJoining.value = false;
  }
};

const installApp = async () => {
  if (!installPrompt.value) {
    return;
  }
  isInstalling.value = true;
  try {
    await installPrompt.value.prompt();
    const choice = await installPrompt.value.userChoice;
    if (choice.outcome === "accepted") {
      installPrompt.value = null;
    }
  } finally {
    isInstalling.value = false;
  }
};

const onInstallPrompt = (event: Event) => {
  event.preventDefault();
  installPrompt.value = event as InstallPromptEvent;
};

onMounted(() => {
  const storedDisplayName = window.localStorage.getItem("motocom.display-name");
  if (storedDisplayName) {
    createDisplayName.value = storedDisplayName;
    joinDisplayName.value = storedDisplayName;
  }

  const queryCode = String(route.query.code ?? "").trim().toUpperCase();
  if (queryCode) {
    joinRoomCode.value = queryCode;
    activeMode.value = "join";
  }

  recentRooms.value = getRecentRooms();
  window.addEventListener("beforeinstallprompt", onInstallPrompt);
});

onUnmounted(() => {
  if (process.client) {
    window.removeEventListener("beforeinstallprompt", onInstallPrompt);
  }
});
</script>

<template>
  <main class="home-page" data-testid="home-page">
    <header class="home-nav">
      <NuxtLink class="brand" to="/" aria-label="Motocom home">
        <span class="brand__mark" aria-hidden="true">
          <svg viewBox="0 0 32 32">
            <path d="M6 18.5h5.2l3.8-3.8v8.6l-3.8-3.8H6v-1z" fill="currentColor" />
            <path d="M19.5 12.5a5 5 0 010 7M22.5 9.5a9 9 0 010 13" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" />
          </svg>
        </span>
        <span>Motocom</span>
      </NuxtLink>
      <button v-if="installPrompt" class="ghost home-nav__install" data-testid="install-app" :disabled="isInstalling" @click="installApp">
        {{ isInstalling ? 'Installing…' : 'Install app' }}
      </button>
    </header>

    <section class="home-hero">
      <div class="home-hero__copy">
        <span class="eyebrow">Group ride communication</span>
        <h1>One tap. Every rider hears it.</h1>
        <p>
          A synchronized soundboard for motorcycle groups. No accounts, no complicated setup—just share a code and ride.
        </p>
        <div class="hero-points" aria-label="Product highlights">
          <span><i aria-hidden="true">✓</i> Private room codes</span>
          <span><i aria-hidden="true">✓</i> Synchronized audio</span>
          <span><i aria-hidden="true">✓</i> Built for gloves</span>
        </div>
      </div>

      <section class="entry-card" data-testid="entry-card" aria-labelledby="entry-title">
        <div class="mode-switch" role="tablist" aria-label="Room action">
          <button
            role="tab"
            :aria-selected="activeMode === 'join'"
            :class="{ 'mode-switch__button--active': activeMode === 'join' }"
            data-testid="mode-join"
            @click="activeMode = 'join'"
          >
            Join a ride
          </button>
          <button
            role="tab"
            :aria-selected="activeMode === 'create'"
            :class="{ 'mode-switch__button--active': activeMode === 'create' }"
            data-testid="mode-create"
            @click="activeMode = 'create'"
          >
            Create a room
          </button>
        </div>

        <div v-if="activeMode === 'join'" class="entry-card__body">
          <div class="entry-heading">
            <span class="entry-heading__icon" aria-hidden="true">→</span>
            <div>
              <h2 id="entry-title">Join your group</h2>
              <p class="muted">Enter the code shared by your ride organizer.</p>
            </div>
          </div>

          <form class="entry-form" data-testid="join-form" @submit.prevent="joinRoom">
            <div>
              <label for="join-room-code">Room code</label>
              <input
                id="join-room-code"
                v-model="joinRoomCode"
                data-testid="join-room-code"
                class="code-input"
                maxlength="12"
                autocapitalize="characters"
                autocomplete="off"
                inputmode="text"
                placeholder="ABC123"
              />
            </div>
            <div>
              <label for="join-display-name">Your name</label>
              <input id="join-display-name" v-model="joinDisplayName" data-testid="join-display-name" maxlength="48" autocomplete="name" placeholder="Alex" />
            </div>
            <button class="entry-submit" data-testid="join-submit" :disabled="!canJoinRoom" type="submit">
              <span>{{ isJoining ? 'Joining…' : 'Join room' }}</span>
              <span aria-hidden="true">→</span>
            </button>
          </form>
        </div>

        <div v-else class="entry-card__body">
          <div class="entry-heading">
            <span class="entry-heading__icon entry-heading__icon--create" aria-hidden="true">＋</span>
            <div>
              <h2 id="entry-title">Start a new ride</h2>
              <p class="muted">You become the main driver and receive a shareable code.</p>
            </div>
          </div>

          <form class="entry-form" data-testid="create-form" @submit.prevent="createRoom">
            <div>
              <label for="create-room-name">Ride name</label>
              <input id="create-room-name" v-model="createRoomName" data-testid="create-room-name" maxlength="80" placeholder="Sunday mountain ride" />
            </div>
            <div class="entry-form__split">
              <div>
                <label for="create-display-name">Your name</label>
                <input id="create-display-name" v-model="createDisplayName" data-testid="create-display-name" maxlength="48" autocomplete="name" placeholder="Alex" />
              </div>
              <div>
                <label for="create-pin">Driver PIN</label>
                <input
                  id="create-pin"
                  v-model="createPin"
                  data-testid="create-pin"
                  type="password"
                  minlength="6"
                  autocomplete="new-password"
                  placeholder="6+ characters"
                />
              </div>
            </div>
            <p class="form-hint">The PIN lets another trusted rider take over as main driver.</p>
            <button class="entry-submit" data-testid="create-submit" :disabled="!canCreateRoom" type="submit">
              <span>{{ isCreating ? 'Creating…' : 'Create room' }}</span>
              <span aria-hidden="true">→</span>
            </button>
          </form>
        </div>

        <p v-if="connectionWarning" class="error entry-alert" data-testid="entry-error">{{ connectionWarning }}</p>
        <p v-else-if="errorMessage" class="error entry-alert" data-testid="entry-error">{{ errorMessage }}</p>
      </section>
    </section>

    <section v-if="recentRooms.length" class="recent-section" data-testid="recent-rooms">
      <div class="section-heading">
        <div>
          <span class="eyebrow">Quick access</span>
          <h2>Recent rooms</h2>
        </div>
        <span class="muted">Stored only on this device</span>
      </div>
      <div class="recent-grid">
        <article v-for="room in recentRooms" :key="room.code" class="recent-room" data-testid="recent-room" :data-room-code="room.code">
          <button class="recent-room__main" @click="selectRecentRoom(room)">
            <span class="recent-room__name">{{ room.name }}</span>
            <span class="recent-room__code">{{ room.code }}</span>
          </button>
          <button class="recent-room__remove" :aria-label="`Forget ${room.code}`" @click="removeRecentRoom(room.code)">×</button>
        </article>
      </div>
    </section>

    <section class="how-it-works">
      <div class="section-heading">
        <div>
          <span class="eyebrow">Simple by design</span>
          <h2>Ready in three steps</h2>
        </div>
      </div>
      <div class="steps-grid">
        <article><span>1</span><h3>Create or join</h3><p>Use a short private code. No account required.</p></article>
        <article><span>2</span><h3>Enable audio</h3><p>One tap prepares synchronized playback and keeps the screen awake.</p></article>
        <article><span>3</span><h3>Ride and signal</h3><p>Large controls are easy to identify and quick to trigger.</p></article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.home-page {
  margin: 0 auto;
  max-width: 1180px;
  min-height: 100vh;
  padding: 0 1.2rem 4rem;
}

.home-nav {
  align-items: center;
  display: flex;
  justify-content: space-between;
  min-height: 76px;
}

.brand {
  align-items: center;
  color: var(--text-main);
  display: inline-flex;
  font-size: 1.05rem;
  font-weight: 850;
  gap: 0.58rem;
  letter-spacing: -0.02em;
  min-height: 44px;
  text-decoration: none;
}

.brand__mark {
  align-items: center;
  background: var(--accent);
  border-radius: 11px;
  color: var(--text-inverse);
  display: inline-flex;
  height: 36px;
  justify-content: center;
  width: 36px;
}

.brand__mark svg {
  height: 25px;
  width: 25px;
}

.home-nav__install {
  min-height: 40px;
  padding: 0.5rem 0.8rem;
}

.home-hero {
  align-items: center;
  display: grid;
  gap: clamp(2rem, 6vw, 5rem);
  grid-template-columns: minmax(0, 0.9fr) minmax(420px, 1fr);
  min-height: 600px;
  padding: 2.5rem 0 4rem;
}

.home-hero__copy {
  max-width: 540px;
}

.home-hero__copy h1 {
  font-size: clamp(2.8rem, 6vw, 5rem);
  line-height: 0.98;
  margin-top: 0.75rem;
}

.home-hero__copy > p {
  color: var(--text-muted);
  font-size: clamp(1.02rem, 1.8vw, 1.2rem);
  margin: 1.35rem 0 1.5rem;
  max-width: 500px;
}

.eyebrow {
  color: var(--accent);
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 850;
  letter-spacing: 0.11em;
  text-transform: uppercase;
}

.hero-points {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem 1rem;
}

.hero-points span {
  align-items: center;
  color: #42546b;
  display: inline-flex;
  font-size: 0.88rem;
  font-weight: 700;
  gap: 0.4rem;
}

.hero-points i {
  align-items: center;
  background: var(--accent-soft);
  border-radius: 999px;
  color: var(--accent);
  display: inline-flex;
  font-size: 0.7rem;
  font-style: normal;
  height: 20px;
  justify-content: center;
  width: 20px;
}

.entry-card {
  background: rgb(255 255 255 / 96%);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.mode-switch {
  background: var(--surface-hover);
  display: grid;
  gap: 4px;
  grid-template-columns: 1fr 1fr;
  padding: 5px;
}

.mode-switch button {
  background: transparent;
  border-radius: 13px;
  color: var(--text-muted);
  min-height: 45px;
}

.mode-switch button:hover:not(:disabled) {
  background: rgb(255 255 255 / 60%);
  box-shadow: none;
  color: var(--text-main);
  transform: none;
}

.mode-switch .mode-switch__button--active {
  background: var(--surface-raised);
  box-shadow: var(--shadow-sm);
  color: var(--text-main);
}

.entry-card__body {
  padding: clamp(1.2rem, 3vw, 2rem);
}

.entry-heading {
  align-items: flex-start;
  display: flex;
  gap: 0.85rem;
  margin-bottom: 1.35rem;
}

.entry-heading p {
  margin: 0.25rem 0 0;
}

.entry-heading__icon {
  align-items: center;
  background: var(--blue-soft);
  border-radius: 12px;
  color: var(--blue);
  display: inline-flex;
  flex: 0 0 auto;
  font-size: 1.15rem;
  font-weight: 900;
  height: 42px;
  justify-content: center;
  width: 42px;
}

.entry-heading__icon--create {
  background: var(--accent-soft);
  color: var(--accent);
}

.entry-form {
  display: grid;
  gap: 1rem;
}

.entry-form__split {
  display: grid;
  gap: 0.8rem;
  grid-template-columns: 1fr 1fr;
}

.code-input {
  font-size: 1.1rem;
  font-weight: 850;
  letter-spacing: 0.15em;
  text-transform: uppercase;
}

.entry-submit {
  justify-content: space-between;
  margin-top: 0.25rem;
  min-height: 52px;
  padding-left: 1.1rem;
  padding-right: 1.1rem;
  width: 100%;
}

.form-hint {
  color: var(--text-soft);
  font-size: 0.78rem;
  margin: -0.3rem 0 0;
}

.entry-alert {
  border-radius: 0;
  border-width: 1px 0 0;
  margin: 0;
}

.recent-section,
.how-it-works {
  padding: 2rem 0;
}

.section-heading {
  align-items: flex-end;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.section-heading h2 {
  margin-top: 0.3rem;
}

.section-heading > .muted {
  font-size: 0.8rem;
}

.recent-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.recent-room {
  background: var(--surface-raised);
  border: 1px solid var(--panel-border);
  border-radius: 14px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  overflow: hidden;
}

.recent-room__main,
.recent-room__remove {
  background: transparent;
  border-radius: 0;
  color: var(--text-main);
  min-height: 64px;
}

.recent-room__main {
  align-items: flex-start;
  flex-direction: column;
  padding: 0.75rem 0.9rem;
}

.recent-room__main:hover:not(:disabled),
.recent-room__remove:hover:not(:disabled) {
  background: var(--panel-soft);
  box-shadow: none;
  transform: none;
}

.recent-room__name {
  font-size: 0.88rem;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}

.recent-room__code {
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.1em;
}

.recent-room__remove {
  border-left: 1px solid var(--panel-border);
  color: var(--text-soft);
  font-size: 1.15rem;
  padding: 0 0.85rem;
}

.steps-grid {
  display: grid;
  gap: 0.8rem;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.steps-grid article {
  background: rgb(255 255 255 / 72%);
  border: 1px solid var(--panel-border);
  border-radius: 16px;
  padding: 1.15rem;
}

.steps-grid article > span {
  align-items: center;
  background: var(--accent-soft);
  border-radius: 10px;
  color: var(--accent);
  display: inline-flex;
  font-size: 0.8rem;
  font-weight: 900;
  height: 30px;
  justify-content: center;
  margin-bottom: 0.8rem;
  width: 30px;
}

.steps-grid p {
  color: var(--text-muted);
  font-size: 0.86rem;
  margin-bottom: 0;
}

@media (max-width: 900px) {
  .home-hero {
    grid-template-columns: 1fr;
    min-height: auto;
    padding: 2rem 0 3rem;
  }

  .home-hero__copy {
    max-width: 680px;
  }

  .home-hero__copy h1 {
    font-size: clamp(2.6rem, 11vw, 4.5rem);
  }
}

@media (max-width: 700px) {
  .home-page {
    padding: 0 0.75rem 2.5rem;
  }

  .home-nav {
    min-height: 64px;
  }

  .home-hero {
    gap: 1.8rem;
    padding-top: 1.2rem;
  }

  .home-hero__copy h1 {
    font-size: clamp(2.45rem, 13vw, 3.8rem);
  }

  .entry-card {
    border-radius: 18px;
  }

  .entry-form__split,
  .recent-grid,
  .steps-grid {
    grid-template-columns: 1fr;
  }

  .section-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 0.25rem;
  }
}
</style>
