<script setup lang="ts">
import type { ButtonVisualState, RoomButton } from "~/types/soundboard";

const props = withDefaults(defineProps<{
  buttons: RoomButton[];
  activeButtonId: string | null;
  disablePress: boolean;
  buttonStates?: Record<string, ButtonVisualState>;
  removable?: boolean;
}>(), {
  buttonStates: () => ({}),
  removable: false,
});

const emit = defineEmits<{
  (event: "press", buttonId: string): void;
  (event: "remove", buttonId: string): void;
}>();

const stateLabelByStatus: Record<ButtonVisualState, string> = {
  idle: "Ready",
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
};

const buttonState = (buttonId: string, isEnabled: boolean): ButtonVisualState => {
  if (!isEnabled) {
    return "idle";
  }
  return props.buttonStates[buttonId] ?? "idle";
};
</script>

<template>
  <div class="sound-grid">
    <div
      v-for="button in buttons"
      :key="button.id"
      class="sound-cell-wrap"
    >
      <button
        :disabled="disablePress || !button.isEnabled"
        :class="[
          'sound-cell',
          `sound-cell--${buttonState(button.id, button.isEnabled)}`,
          { 'sound-cell--active': activeButtonId === button.id },
          { 'sound-cell--disabled': !button.isEnabled },
        ]"
        @click="emit('press', button.id)"
      >
        <span class="sound-cell__label">{{ button.label }}</span>
        <span class="sound-cell__meta">
          {{ button.isEnabled ? stateLabelByStatus[buttonState(button.id, button.isEnabled)] : 'Disabled' }}
        </span>
      </button>

      <button
        v-if="removable"
        class="sound-cell-remove"
        type="button"
        :disabled="disablePress"
        :aria-label="`Remove ${button.label}`"
        @click="emit('remove', button.id)"
      >
        Remove
      </button>
    </div>
  </div>
</template>

<style scoped>
.sound-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.sound-cell-wrap {
  position: relative;
}

.sound-cell {
  align-items: center;
  --glow-soft: rgba(0, 0, 0, 0);
  --glow-strong: rgba(0, 0, 0, 0);
  background: #ffffff;
  border: 2px solid #d2dce9;
  box-shadow: 0 0 0 0 rgba(0 0 0 / 0);
  color: #132032;
  display: flex;
  flex-direction: column;
  font-size: 1.22rem;
  font-weight: 800;
  justify-content: center;
  min-height: 130px;
  padding: 0.75rem;
  text-align: center;
  transition: border-color 0.22s ease, box-shadow 0.22s ease;
  width: 100%;
}

.sound-cell__label {
  line-height: 1.2;
}

.sound-cell__meta {
  display: inline-block;
  font-size: 0.78rem;
  font-weight: 600;
  margin-top: 0.5rem;
  opacity: 0.76;
}

.sound-cell--idle {
  border-color: #d2dce9;
}

.sound-cell--pending {
  --glow-soft: rgba(255, 154, 28, 0.32);
  --glow-strong: rgba(255, 154, 28, 0.24);
  border-color: #ff9a1c;
  animation: glow-intensity 0.95s ease-in-out infinite;
}

.sound-cell--accepted {
  --glow-soft: rgba(45, 178, 110, 0.34);
  --glow-strong: rgba(45, 178, 110, 0.26);
  border-color: #2db26e;
  animation: glow-intensity 1.15s ease-in-out infinite;
}

.sound-cell--rejected {
  --glow-soft: rgba(226, 80, 80, 0.34);
  --glow-strong: rgba(226, 80, 80, 0.26);
  border-color: #e25050;
  animation: glow-intensity 1.1s ease-in-out infinite;
}

.sound-cell--active {
  transform: translateY(-1px);
}

.sound-cell--disabled {
  border-color: #d9e1ec;
  filter: grayscale(0.2);
  opacity: 0.7;
}

.sound-cell-remove {
  background: #fff3f2;
  border: 1px solid #e8b8b5;
  border-radius: 999px;
  color: #ae3e3a;
  font-size: 0.68rem;
  font-weight: 700;
  padding: 0.18rem 0.5rem;
  position: absolute;
  right: 0.45rem;
  top: 0.45rem;
}

@keyframes glow-intensity {
  0% {
    box-shadow: 0 0 0 0 var(--glow-soft), 0 0 0 0 var(--glow-strong);
  }
  50% {
    box-shadow: 0 0 0 2px var(--glow-soft), 0 0 20px 6px var(--glow-strong);
  }
  100% {
    box-shadow: 0 0 0 0 var(--glow-soft), 0 0 0 0 var(--glow-strong);
  }
}

@media (max-width: 640px) {
  .sound-cell {
    min-height: 115px;
  }
}
</style>
