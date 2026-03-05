<script setup lang="ts">
import { api } from "~/convex/_generated/api";
import {
  buildConnectivityHint,
  rewriteLoopbackUrlForClient,
  runMutation,
  toErrorMessage,
} from "~/utils/mutation";
import type { RoomButton } from "~/types/soundboard";

const props = withDefaults(defineProps<{
  roomId: string;
  sessionId: string;
  buttons: RoomButton[];
  outcomeSounds: {
    acceptUrl: string | null;
    rejectUrl: string | null;
  };
  appEnabled?: boolean;
}>(), {
  appEnabled: true,
});

const draftLabel = ref("");
const draftFile = ref<File | null>(null);
const acceptFile = ref<File | null>(null);
const rejectFile = ref<File | null>(null);
const panelError = ref("");
const panelSuccess = ref("");
const isSaving = ref(false);
const runtimeConfig = useRuntimeConfig();
const convexUrl = String(runtimeConfig.public.convexUrl || "");
const connectionWarning = computed(() => buildConnectivityHint(convexUrl));
const APP_LOCKED_MESSAGE = "Unlock audio from the speaker icon to enable controls.";
const SOURCE_FILE_ACCEPT =
  "audio/*,video/*,.m4a,.mp4,.mov,.m4v,.3gp,.3gpp,.aac,.wav,.mp3";
const SUPPORTED_EXTENSION_SET = new Set([
  "m4a",
  "mp3",
  "wav",
  "aac",
  "ogg",
  "oga",
  "webm",
  "mp4",
  "mov",
  "m4v",
  "3gp",
  "3gpp",
]);
const UNSUPPORTED_MEDIA_MESSAGE =
  "Unsupported file format. Use audio (.m4a/.mp3/.wav) or video (.mov/.mp4) so the app can use the audio track.";

const buttonDrafts = reactive<Record<string, { label: string; isEnabled: boolean }>>({});
const replacementFiles = reactive<Record<string, File | null>>({});

watch(
  () => props.buttons,
  (buttons) => {
    for (const button of buttons) {
      if (!buttonDrafts[button.id]) {
        buttonDrafts[button.id] = {
          label: button.label,
          isEnabled: button.isEnabled,
        };
      } else {
        buttonDrafts[button.id].label = button.label;
        buttonDrafts[button.id].isEnabled = button.isEnabled;
      }
      if (!(button.id in replacementFiles)) {
        replacementFiles[button.id] = null;
      }
    }

    for (const id of Object.keys(buttonDrafts)) {
      if (!buttons.find((button) => button.id === id)) {
        delete buttonDrafts[id];
      }
    }
    for (const id of Object.keys(replacementFiles)) {
      if (!buttons.find((button) => button.id === id)) {
        delete replacementFiles[id];
      }
    }
  },
  { immediate: true, deep: true },
);

const { mutate: generateUploadUrl } = useConvexMutation(api.uploads.generateUploadUrl);
const { mutate: createButton } = useConvexMutation(api.buttons.createButton);
const { mutate: updateButton } = useConvexMutation(api.buttons.updateButton);
const { mutate: deleteButton } = useConvexMutation(api.buttons.deleteButton);
const { mutate: setOutcomeSounds } = useConvexMutation(api.buttons.setOutcomeSounds);

const clearMessages = () => {
  panelError.value = "";
  panelSuccess.value = "";
};

const onSelectFile = (event: Event, target: "draft" | "accept" | "reject") => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;

  if (target === "draft") {
    draftFile.value = file;
    return;
  }
  if (target === "accept") {
    acceptFile.value = file;
    return;
  }
  rejectFile.value = file;
};

const onSelectReplacementFile = (event: Event, buttonId: string) => {
  const input = event.target as HTMLInputElement;
  replacementFiles[buttonId] = input.files?.[0] ?? null;
};

const inferExtension = (name: string): string | null => {
  const index = name.lastIndexOf(".");
  if (index < 0 || index === name.length - 1) {
    return null;
  }
  return name.slice(index + 1).toLowerCase();
};

const isSupportedSourceFile = (file: File): boolean => {
  const mimeType = (file.type || "").toLowerCase();
  if (mimeType.startsWith("audio/") || mimeType.startsWith("video/")) {
    return true;
  }
  const extension = inferExtension(file.name);
  return extension ? SUPPORTED_EXTENSION_SET.has(extension) : false;
};

const uploadFile = async (file: File) => {
  if (!props.appEnabled) {
    throw new Error(APP_LOCKED_MESSAGE);
  }
  if (!isSupportedSourceFile(file)) {
    throw new Error(UNSUPPORTED_MEDIA_MESSAGE);
  }
  if (connectionWarning.value) {
    throw new Error(connectionWarning.value);
  }

  const uploadUrlResult = await runMutation<
    { roomId: string; sessionId: string },
    { uploadUrl: string }
  >(generateUploadUrl, {
    roomId: props.roomId,
    sessionId: props.sessionId,
  }, {
    operationName: "Get upload URL",
    convexUrl,
  });

  const uploadUrl = rewriteLoopbackUrlForClient(uploadUrlResult.uploadUrl, undefined, convexUrl);
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error("File upload failed");
  }

  const payload = (await response.json()) as { storageId?: string };
  if (!payload.storageId) {
    throw new Error("Upload response is missing storageId");
  }

  return payload.storageId;
};

const createNewButton = async () => {
  clearMessages();
  if (!props.appEnabled) {
    panelError.value = APP_LOCKED_MESSAGE;
    return;
  }
  if (connectionWarning.value) {
    panelError.value = connectionWarning.value;
    return;
  }
  if (!draftLabel.value.trim() || !draftFile.value) {
    panelError.value = "New button needs both label and a source file (audio or video).";
    return;
  }

  isSaving.value = true;
  try {
    const fileStorageId = await uploadFile(draftFile.value);
    await runMutation(createButton, {
      roomId: props.roomId,
      sessionId: props.sessionId,
      label: draftLabel.value.trim(),
      fileStorageId,
      sortOrder: props.buttons.length ? props.buttons[props.buttons.length - 1].sortOrder + 1 : 0,
    }, {
      operationName: "Create button",
      convexUrl,
    });

    draftLabel.value = "";
    draftFile.value = null;
    panelSuccess.value = "Button created.";
  } catch (error) {
    panelError.value = toErrorMessage(error);
  } finally {
    isSaving.value = false;
  }
};

const saveButton = async (buttonId: string) => {
  clearMessages();
  if (!props.appEnabled) {
    panelError.value = APP_LOCKED_MESSAGE;
    return;
  }
  if (connectionWarning.value) {
    panelError.value = connectionWarning.value;
    return;
  }
  const draft = buttonDrafts[buttonId];
  if (!draft) {
    return;
  }

  isSaving.value = true;
  try {
    let fileStorageId: string | undefined;
    if (replacementFiles[buttonId]) {
      fileStorageId = await uploadFile(replacementFiles[buttonId] as File);
    }

    await runMutation(updateButton, {
      roomId: props.roomId,
      buttonId,
      sessionId: props.sessionId,
      label: draft.label,
      isEnabled: draft.isEnabled,
      fileStorageId,
    }, {
      operationName: "Update button",
      convexUrl,
    });

    replacementFiles[buttonId] = null;
    panelSuccess.value = "Button updated.";
  } catch (error) {
    panelError.value = toErrorMessage(error);
  } finally {
    isSaving.value = false;
  }
};

const removeButton = async (buttonId: string) => {
  clearMessages();
  if (!props.appEnabled) {
    panelError.value = APP_LOCKED_MESSAGE;
    return;
  }
  if (connectionWarning.value) {
    panelError.value = connectionWarning.value;
    return;
  }
  isSaving.value = true;
  try {
    await runMutation(deleteButton, {
      roomId: props.roomId,
      buttonId,
      sessionId: props.sessionId,
    }, {
      operationName: "Delete button",
      convexUrl,
    });
    panelSuccess.value = "Button deleted.";
  } catch (error) {
    panelError.value = toErrorMessage(error);
  } finally {
    isSaving.value = false;
  }
};

const saveOutcomeSounds = async () => {
  clearMessages();
  if (!props.appEnabled) {
    panelError.value = APP_LOCKED_MESSAGE;
    return;
  }
  if (connectionWarning.value) {
    panelError.value = connectionWarning.value;
    return;
  }
  if (!acceptFile.value || !rejectFile.value) {
    panelError.value = "Please pick both accept and reject source files (audio or video).";
    return;
  }

  isSaving.value = true;
  try {
    const acceptStorageId = await uploadFile(acceptFile.value);
    const rejectStorageId = await uploadFile(rejectFile.value);

    await runMutation(setOutcomeSounds, {
      roomId: props.roomId,
      sessionId: props.sessionId,
      acceptStorageId,
      rejectStorageId,
    }, {
      operationName: "Save outcome sounds",
      convexUrl,
    });

    acceptFile.value = null;
    rejectFile.value = null;
    panelSuccess.value = "Outcome sounds saved.";
  } catch (error) {
    panelError.value = toErrorMessage(error);
  } finally {
    isSaving.value = false;
  }
};
</script>

<template>
  <div class="card">
    <h3>Main Driver Panel</h3>
    <p class="muted">Upload and manage sound buttons for this room.</p>
    <p class="muted">You can upload audio files (.m4a supported) or videos; playback uses the video's audio track.</p>
    <p v-if="!props.appEnabled" class="muted">{{ APP_LOCKED_MESSAGE }}</p>
    <p v-if="connectionWarning" class="error">{{ connectionWarning }}</p>

    <div class="card driver-subcard">
      <h4>Create button</h4>
      <div class="row">
        <div class="driver-col">
          <label>Label</label>
          <input v-model="draftLabel" placeholder="Example: Horn" />
        </div>
        <div class="driver-col">
          <label>Sound file</label>
          <input type="file" :accept="SOURCE_FILE_ACCEPT" @change="(event) => onSelectFile(event, 'draft')" />
        </div>
      </div>
      <button :disabled="!props.appEnabled || Boolean(connectionWarning) || isSaving" @click="createNewButton">Create Button</button>
    </div>

    <div class="card driver-subcard">
      <h4>Outcome sounds</h4>
      <p class="muted">
        Current: accept {{ outcomeSounds.acceptUrl ? 'configured' : 'missing' }}, reject
        {{ outcomeSounds.rejectUrl ? 'configured' : 'missing' }}
      </p>
      <div class="row">
        <div class="driver-col">
          <label>Accept sound</label>
          <input type="file" :accept="SOURCE_FILE_ACCEPT" @change="(event) => onSelectFile(event, 'accept')" />
        </div>
        <div class="driver-col">
          <label>Reject sound</label>
          <input type="file" :accept="SOURCE_FILE_ACCEPT" @change="(event) => onSelectFile(event, 'reject')" />
        </div>
      </div>
      <button :disabled="!props.appEnabled || Boolean(connectionWarning) || isSaving" class="secondary" @click="saveOutcomeSounds">
        Save Outcome Sounds
      </button>
    </div>

    <div class="card driver-subcard">
      <h4>Existing buttons</h4>
      <p v-if="!buttons.length" class="muted">No buttons configured.</p>

      <div v-for="button in buttons" :key="button.id" class="button-row">
        <div class="row">
          <div class="driver-col">
            <label>Label</label>
            <input v-model="buttonDrafts[button.id].label" />
          </div>
          <div class="driver-col">
            <label>Replace sound (optional)</label>
            <input
              type="file"
              :accept="SOURCE_FILE_ACCEPT"
              @change="(event) => onSelectReplacementFile(event, button.id)"
            />
          </div>
          <div class="driver-col check-col">
            <label>Enabled</label>
            <input type="checkbox" v-model="buttonDrafts[button.id].isEnabled" />
          </div>
        </div>
        <div class="row button-row__actions">
          <button :disabled="!props.appEnabled || Boolean(connectionWarning) || isSaving" class="secondary" @click="saveButton(button.id)">Save</button>
          <button :disabled="!props.appEnabled || Boolean(connectionWarning) || isSaving" class="danger" @click="removeButton(button.id)">Delete</button>
        </div>
      </div>
    </div>

    <p v-if="panelError" class="error">{{ panelError }}</p>
    <p v-if="panelSuccess" class="success">{{ panelSuccess }}</p>
  </div>
</template>

<style scoped>
.driver-subcard {
  margin-top: 0.8rem;
}

.driver-col {
  flex: 1 1 230px;
}

.button-row {
  border-top: 1px solid #295067;
  margin-top: 0.8rem;
  padding-top: 0.8rem;
}

.button-row:first-of-type {
  border-top: 0;
  margin-top: 0;
  padding-top: 0;
}

.button-row__actions {
  margin-top: 0.5rem;
}

.check-col {
  align-items: flex-start;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.check-col input {
  margin-top: 0.55rem;
  width: auto;
}
</style>
