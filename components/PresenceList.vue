<script setup lang="ts">
import type { Participant } from "~/types/soundboard";

defineProps<{
  participants: Participant[];
}>();

const initials = (displayName: string) => {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return "?";
  }
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");
};

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
  <div class="presence-panel">
    <div class="presence-summary sr-only">
      Participants · Active: {{ participants.filter((participant) => participant.isActive).length }} /
      {{ participants.length }}
    </div>

    <ul v-if="participants.length" class="presence-list">
      <li v-for="participant in participants" :key="participant.id" class="presence-row">
        <span class="presence-avatar" :class="{ 'presence-avatar--driver': participant.isMainDriver }">
          {{ initials(participant.displayName) }}
          <i :class="participant.isActive ? 'presence-dot--active' : 'presence-dot--inactive'"></i>
        </span>
        <div class="presence-identity">
          <div class="presence-name-line">
            <strong>{{ participant.displayName }}</strong>
            <span v-if="participant.isMainDriver" class="badge ok role-badge">Main driver</span>
          </div>
          <span class="presence-meta">
            {{ participant.isActive ? 'Online now' : `inactive (${formatAgo(participant.lastSeenAt)})` }}
          </span>
        </div>
        <span class="badge" :class="participant.isActive ? 'ok' : 'off'">
          {{ participant.isActive ? 'Online' : 'Offline' }}
        </span>
      </li>
    </ul>
    <p v-else class="presence-empty">No riders have joined yet.</p>
  </div>
</template>

<style scoped>
.presence-panel {
  background: var(--panel-soft);
  border: 1px solid var(--panel-border);
  border-radius: 14px;
  margin-top: 0.8rem;
  overflow: hidden;
}

.presence-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.presence-row {
  align-items: center;
  border-top: 1px solid var(--panel-border);
  display: grid;
  gap: 0.75rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  padding: 0.75rem;
}

.presence-row:first-child {
  border-top: 0;
}

.presence-avatar {
  align-items: center;
  background: #e7edf5;
  border-radius: 12px;
  color: #52667e;
  display: inline-flex;
  font-size: 0.72rem;
  font-weight: 900;
  height: 40px;
  justify-content: center;
  position: relative;
  width: 40px;
}

.presence-avatar--driver {
  background: var(--accent-soft);
  color: var(--accent);
}

.presence-avatar i {
  border: 2px solid #fff;
  border-radius: 999px;
  bottom: -1px;
  height: 11px;
  position: absolute;
  right: -1px;
  width: 11px;
}

.presence-dot--active {
  background: var(--ok);
}

.presence-dot--inactive {
  background: #9aa6b5;
}

.presence-identity {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.presence-name-line {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.presence-name-line strong {
  font-size: 0.88rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.presence-meta {
  color: var(--text-muted);
  font-size: 0.72rem;
  margin-top: 0.1rem;
}

.role-badge {
  font-size: 0.62rem;
  min-height: 20px;
}

.presence-empty {
  color: var(--text-muted);
  margin: 0;
  padding: 1rem;
  text-align: center;
}

@media (max-width: 560px) {
  .presence-row {
    gap: 0.6rem;
    grid-template-columns: auto minmax(0, 1fr);
  }

  .presence-row > .badge {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
