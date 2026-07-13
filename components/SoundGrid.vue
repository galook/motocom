<script setup lang="ts">
import type { ButtonVisualState, RoomButton } from "~/types/soundboard";

const props = withDefaults(defineProps<{
  buttons: RoomButton[];
  activeButtonId: string | null;
  disablePress: boolean;
  buttonStates?: Record<string, ButtonVisualState>;
  removable?: boolean;
  density?: "comfortable" | "compact";
}>(), {
  buttonStates: () => ({}),
  removable: false,
  density: "comfortable",
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
  <div class="sound-grid" :class="`sound-grid--${density}`">
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
        <span class="sound-cell__pulse" aria-hidden="true"></span>
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
        ×
      </button>
    </div>
  </div>
</template>

<style scoped>
.sound-grid {
  display: grid;
  gap: 0.8rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.sound-grid--compact {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.65rem;
}

.sound-cell-wrap {
  min-width: 0;
  position: relative;
}

.sound-cell {
  --state: #718096;
  --state-soft: #edf2f7;
  align-items: center;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 98%), rgb(248 250 253 / 98%));
  border: 1px solid #d7e0eb;
  border-radius: 18px;
  box-shadow: 0 5px 14px rgb(40 61 86 / 7%);
  color: #142033;
  display: flex;
  flex-direction: column;
  font-size: clamp(1.05rem, 2.5vw, 1.32rem);
  font-weight: 850;
  justify-content: center;
  min-height: 142px;
  overflow: hidden;
  padding: 1rem 0.8rem;
  position: relative;
  text-align: center;
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.12s ease,
    background 0.16s ease;
  width: 100%;
}

.sound-grid--compact .sound-cell {
  border-radius: 15px;
  font-size: clamp(0.92rem, 2vw, 1.1rem);
  min-height: 112px;
  padding: 0.8rem 0.55rem;
}

.sound-cell:hover:not(:disabled) {
  background: #fff;
  border-color: #b8c7d9;
  box-shadow: 0 10px 24px rgb(40 61 86 / 12%);
  transform: translateY(-2px);
}

.sound-cell:active:not(:disabled) {
  box-shadow: 0 3px 10px rgb(40 61 86 / 10%);
  transform: translateY(0) scale(0.985);
}

.sound-cell__pulse {
  background: var(--state);
  border: 4px solid var(--state-soft);
  border-radius: 999px;
  height: 16px;
  margin-bottom: 0.75rem;
  width: 16px;
}

.sound-grid--compact .sound-cell__pulse {
  height: 13px;
  margin-bottom: 0.55rem;
  width: 13px;
}

.sound-cell__label {
  line-height: 1.12;
  max-width: 100%;
}

.sound-cell__meta {
  color: #69788c;
  display: inline-block;
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.025em;
  margin-top: 0.48rem;
  text-transform: uppercase;
}

.sound-cell--idle {
  --state: #6b7f96;
  --state-soft: #e7edf4;
}

.sound-cell--pending {
  --state: #dd8b22;
  --state-soft: #fff0d8;
  background: linear-gradient(180deg, #fffdf8, #fff7eb);
  border-color: #e8b66e;
  box-shadow: 0 0 0 3px rgb(221 139 34 / 9%), 0 10px 24px rgb(181 110 26 / 12%);
}

.sound-cell--accepted {
  --state: #2d9b5d;
  --state-soft: #dcf3e5;
  background: linear-gradient(180deg, #fbfffc, #eef9f2);
  border-color: #8bcaa4;
}

.sound-cell--rejected {
  --state: #d25450;
  --state-soft: #fde5e3;
  background: linear-gradient(180deg, #fffdfd, #fff0ef);
  border-color: #e4a19e;
}

.sound-cell--pending .sound-cell__pulse,
.sound-cell--accepted .sound-cell__pulse,
.sound-cell--rejected .sound-cell__pulse {
  animation: state-pulse 1.15s ease-in-out infinite;
}

.sound-cell--active {
  box-shadow: 0 0 0 3px rgb(221 139 34 / 10%), 0 14px 30px rgb(181 110 26 / 15%);
}

.sound-cell--disabled {
  filter: grayscale(0.45);
  opacity: 0.58;
}

.sound-cell-remove {
  align-items: center;
  background: #fff;
  border: 1px solid #e5b9b6;
  border-radius: 999px;
  box-shadow: 0 3px 9px rgb(94 48 45 / 10%);
  color: #b13f3b;
  display: inline-flex;
  font-size: 1rem;
  height: 30px;
  justify-content: center;
  min-height: 30px;
  padding: 0;
  position: absolute;
  right: 0.55rem;
  top: 0.55rem;
  width: 30px;
  z-index: 2;
}

.sound-cell-remove:hover:not(:disabled) {
  background: #fff0ef;
  box-shadow: 0 4px 12px rgb(94 48 45 / 14%);
}

@keyframes state-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--state) 22%, transparent);
  }
  50% {
    box-shadow: 0 0 0 7px color-mix(in srgb, var(--state) 10%, transparent);
  }
}

@media (max-width: 700px) {
  .sound-grid {
    gap: 0.65rem;
  }

  .sound-grid--compact {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .sound-cell,
  .sound-grid--compact .sound-cell {
    min-height: 118px;
  }
}
</style>
