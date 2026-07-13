<script setup lang="ts">
import type { ActiveRequest, Decision } from "~/types/soundboard";

defineProps<{
  activeRequest: ActiveRequest | null;
  isMainDriver: boolean;
  isResolving: boolean;
  queueLength: number;
  requesterName?: string | null;
}>();

const emit = defineEmits<{
  (event: "resolve", decision: Decision): void;
}>();
</script>

<template>
  <div class="active-panel card" data-testid="active-request-panel" :data-active="Boolean(activeRequest)" :class="{ 'active-panel--idle': !activeRequest }">
    <div class="active-panel__status" aria-hidden="true">
      <span></span>
    </div>

    <div class="active-panel__content">
      <span class="active-panel__eyebrow">{{ activeRequest ? 'Live request' : 'Queue status' }}</span>
      <template v-if="activeRequest">
        <strong class="active-panel__signal">{{ activeRequest.buttonLabel }}</strong>
        <span class="active-panel__requester">Requested by: {{ requesterName ?? "Unknown rider" }}</span>
      </template>
      <template v-else>
        <strong class="active-panel__signal">Ready for the next signal</strong>
        <span class="active-panel__requester">No active request right now.</span>
      </template>
    </div>

    <div v-if="activeRequest && isMainDriver" class="active-panel__actions">
      <button
        class="active-panel__accept"
        data-testid="request-accept"
        :disabled="isResolving"
        @click="emit('resolve', 'accepted')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4L19 7" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4" /></svg>
        Accept
      </button>
      <button
        class="danger active-panel__reject"
        data-testid="request-reject"
        :disabled="isResolving"
        @click="emit('resolve', 'rejected')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2.4" /></svg>
        Reject
      </button>
    </div>

    <div v-else class="active-panel__waiting">
      <span v-if="activeRequest">Waiting for a main driver</span>
      <span v-else>Queued: {{ queueLength }}</span>
    </div>

    <span v-if="activeRequest && queueLength" class="active-panel__queue">+{{ queueLength }} waiting</span>
  </div>
</template>

<style scoped>
.active-panel {
  align-items: center;
  background: rgb(255 255 255 / 98%);
  display: grid;
  gap: 0.85rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  padding: 0.75rem 0.85rem;
  position: relative;
}

.active-panel__status {
  align-items: center;
  background: var(--warning-surface);
  border-radius: 13px;
  display: inline-flex;
  height: 44px;
  justify-content: center;
  width: 44px;
}

.active-panel__status span {
  animation: request-pulse 1.1s ease-in-out infinite;
  background: var(--warning);
  border: 5px solid color-mix(in srgb, var(--warning) 22%, white);
  border-radius: 999px;
  height: 18px;
  width: 18px;
}

.active-panel--idle .active-panel__status {
  background: var(--neutral-surface);
}

.active-panel--idle .active-panel__status span {
  animation: none;
  background: var(--neutral-text);
  border-color: var(--neutral-border);
}

.active-panel__content {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.active-panel__eyebrow {
  color: var(--warning-text);
  font-size: 0.66rem;
  font-weight: 900;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.active-panel--idle .active-panel__eyebrow {
  color: var(--text-muted);
}

.active-panel__signal {
  font-size: 1.05rem;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.active-panel__requester,
.active-panel__waiting,
.active-panel__queue {
  color: var(--text-muted);
  font-size: 0.73rem;
  font-weight: 700;
}

.active-panel__actions {
  display: flex;
  gap: 0.5rem;
}

.active-panel__actions button {
  gap: 0.35rem;
  min-height: var(--control-height);
  min-width: 106px;
}

.active-panel__actions svg {
  height: 18px;
  width: 18px;
}

.active-panel__accept {
  background: var(--success);
}

.active-panel__accept:hover:not(:disabled) {
  background: var(--success-text);
}

.active-panel__waiting {
  background: var(--surface-muted);
  border-radius: 999px;
  padding: 0.4rem 0.65rem;
  white-space: nowrap;
}

.active-panel__queue {
  position: absolute;
  right: 0.9rem;
  top: -1.45rem;
}

@keyframes request-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--warning) 20%, transparent); }
  50% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--warning) 8%, transparent); }
}

@media (max-width: 620px) {
  .active-panel {
    gap: 0.6rem;
    grid-template-columns: auto minmax(0, 1fr);
  }

  .active-panel__status {
    height: 38px;
    width: 38px;
  }

  .active-panel__actions,
  .active-panel__waiting {
    grid-column: 1 / -1;
  }

  .active-panel__actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .active-panel__actions button {
    min-width: 0;
  }

  .active-panel__waiting {
    text-align: center;
  }
}
</style>
