<script setup lang="ts">
import type { ActiveRequest, Decision } from "~/types/soundboard";

defineProps<{
  activeRequest: ActiveRequest | null;
  isMainDriver: boolean;
  isResolving: boolean;
  queueLength: number;
}>();

const emit = defineEmits<{
  (event: "resolve", decision: Decision): void;
}>();
</script>

<template>
  <div class="active-panel card">
    <div class="active-panel__header">
      <h2>Live Request</h2>
      <span class="badge" :class="activeRequest ? 'ok' : 'off'">
        {{ activeRequest ? 'Active' : 'Idle' }}
      </span>
    </div>

    <template v-if="activeRequest">
      <p class="active-panel__line">
        <strong>{{ activeRequest.buttonLabel }}</strong>
      </p>
      <p class="muted active-panel__line">Requested by: {{ activeRequest.requestedBySessionId }}</p>

      <div class="row active-panel__actions" v-if="isMainDriver">
        <button
          class="secondary"
          :disabled="isResolving"
          @click="emit('resolve', 'accepted')"
        >
          Accept
        </button>
        <button
          class="danger"
          :disabled="isResolving"
          @click="emit('resolve', 'rejected')"
        >
          Reject
        </button>
      </div>
      <p class="muted" v-else>
        Waiting for a main driver to accept or reject.
      </p>
    </template>

    <p v-else class="muted">No active request right now.</p>
    <p class="muted">Queued: {{ queueLength }}</p>
  </div>
</template>

<style scoped>
.active-panel__header {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.active-panel__line {
  margin-bottom: 0.4rem;
  margin-top: 0.45rem;
}

.active-panel__actions {
  margin-top: 0.8rem;
}
</style>
