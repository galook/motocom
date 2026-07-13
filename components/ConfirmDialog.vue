<script setup lang="ts">
import { nextTick, ref, useId, watch } from "vue";

const props = withDefaults(defineProps<{
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "warning" | "primary";
  busy?: boolean;
}>(), {
  confirmLabel: "Confirm",
  cancelLabel: "Cancel",
  tone: "danger",
  busy: false,
});

const emit = defineEmits<{
  (event: "confirm"): void;
  (event: "cancel"): void;
}>();

const dialog = ref<HTMLDialogElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);
const confirmButton = ref<HTMLButtonElement | null>(null);
const titleId = useId();
const descriptionId = useId();
let previouslyFocused: HTMLElement | null = null;

watch(
  () => props.open,
  async (open) => {
    if (!process.client || !dialog.value) {
      return;
    }
    if (open && !dialog.value.open) {
      previouslyFocused = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      dialog.value.showModal();
      await nextTick();
      cancelButton.value?.focus();
    } else if (!open && dialog.value.open) {
      dialog.value.close();
      await nextTick();
      previouslyFocused?.focus();
      previouslyFocused = null;
    }
  },
  { immediate: true },
);

const cancel = () => {
  if (!props.busy) {
    emit("cancel");
  }
};

const onCancel = (event: Event) => {
  event.preventDefault();
  cancel();
};

const confirm = () => {
  if (!props.busy) {
    emit("confirm");
  }
};

const onBackdropClick = (event: MouseEvent) => {
  if (event.target === dialog.value) {
    cancel();
  }
};

const onKeydown = (event: KeyboardEvent) => {
  if (event.key !== "Tab") {
    return;
  }
  const first = cancelButton.value;
  const last = confirmButton.value;
  if (!first || !last) {
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};
</script>

<template>
  <dialog
    ref="dialog"
    class="confirm-dialog"
    data-testid="confirm-dialog"
    :aria-labelledby="titleId"
    :aria-describedby="descriptionId"
    @cancel="onCancel"
    @click="onBackdropClick"
    @keydown="onKeydown"
  >
    <div class="confirm-dialog__panel">
      <span class="confirm-dialog__icon" :class="`confirm-dialog__icon--${tone}`" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M12 8v5m0 3.5h.01M10.3 4.8L2.8 18a1.5 1.5 0 001.3 2.2h15.8a1.5 1.5 0 001.3-2.2L13.7 4.8a2 2 0 00-3.4 0z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" />
        </svg>
      </span>
      <div>
        <h2 :id="titleId">{{ title }}</h2>
        <p :id="descriptionId">{{ description }}</p>
      </div>
      <div class="confirm-dialog__actions">
        <button ref="cancelButton" type="button" class="ghost" data-testid="confirm-cancel" :disabled="busy" @click="cancel">
          {{ cancelLabel }}
        </button>
        <button
          ref="confirmButton"
          type="button"
          :class="tone === 'danger' ? 'danger' : tone === 'warning' ? 'warn' : ''"
          data-testid="confirm-submit"
          :disabled="busy"
          @click="confirm"
        >
          {{ busy ? 'Working…' : confirmLabel }}
        </button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.confirm-dialog {
  background: transparent;
  border: 0;
  max-width: min(92vw, 460px);
  padding: 0;
  width: 100%;
}

.confirm-dialog::backdrop {
  background: var(--overlay);
  backdrop-filter: blur(4px);
}

.confirm-dialog__panel {
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  display: grid;
  gap: var(--space-4);
  padding: var(--space-5);
}

.confirm-dialog__icon {
  align-items: center;
  background: var(--danger-surface);
  border-radius: var(--radius-md);
  color: var(--danger-text);
  display: inline-flex;
  height: 44px;
  justify-content: center;
  width: 44px;
}

.confirm-dialog__icon--warning {
  background: var(--warning-surface);
  color: var(--warning-text);
}

.confirm-dialog__icon--primary {
  background: var(--accent-surface);
  color: var(--accent);
}

.confirm-dialog__icon svg {
  height: 24px;
  width: 24px;
}

.confirm-dialog h2 {
  font-size: var(--font-size-lg);
}

.confirm-dialog p {
  color: var(--text-muted);
  margin-bottom: 0;
}

.confirm-dialog__actions {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}

@media (max-width: 520px) {
  .confirm-dialog__panel {
    border-radius: var(--radius-lg);
    padding: var(--space-4);
  }

  .confirm-dialog__actions {
    flex-direction: column-reverse;
  }

  .confirm-dialog__actions button {
    width: 100%;
  }
}
</style>
