<script setup lang="ts">
import type { Participant } from "~/types/soundboard";

defineProps<{
  participants: Participant[];
}>();

const formatAgo = (timestamp: number) => {
  const diffSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }
  const diffMinutes = Math.round(diffSeconds / 60);
  return `${diffMinutes}m ago`;
};
</script>

<template>
  <div class="card">
    <h3>Participants</h3>
    <p class="muted">
      Active: {{ participants.filter((participant) => participant.isActive).length }} /
      {{ participants.length }}
    </p>

    <ul class="presence-list">
      <li v-for="participant in participants" :key="participant.sessionId" class="presence-row">
        <div>
          <strong>{{ participant.displayName }}</strong>
          <span v-if="participant.isMainDriver" class="badge ok role-badge">Main driver</span>
        </div>
        <div>
          <span class="badge" :class="participant.isActive ? 'ok' : 'off'">
            {{ participant.isActive ? 'active' : `inactive (${formatAgo(participant.lastSeenAt)})` }}
          </span>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.presence-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.presence-row {
  align-items: center;
  border-top: 1px solid #274153;
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.55rem 0;
}

.presence-row:first-child {
  border-top: 0;
}

.role-badge {
  margin-left: 0.35rem;
}

@media (max-width: 760px) {
  .presence-row {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
