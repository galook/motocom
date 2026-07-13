<script setup lang="ts">
import { api } from "~/convex/_generated/api";
import {
  buildConnectivityHint,
  rewriteLoopbackUrlForClient,
  runMutation,
  toErrorMessage,
} from "~/utils/mutation";
import type { RoomButton, RoomTemplateSummary } from "~/types/soundboard";
import { createOperationId } from "~/utils/participantToken";

const props = withDefaults(defineProps<{
  roomId: string;
  participantToken: string;
  ownerToken: string;
  buttons: RoomButton[];
  outcomeSounds: {
    acceptUrl: string | null;
    rejectUrl: string | null;
  };
  appEnabled?: boolean;
}>(), {
  appEnabled: true,
});

function toTemplateSummaries(value: unknown): RoomTemplateSummary[] {
  return Array.isArray(value) ? value as RoomTemplateSummary[] : [];
}

const draftLabel = ref("");
const draftFile = ref<File | null>(null);
const acceptFile = ref<File | null>(null);
const rejectFile = ref<File | null>(null);
const templateName = ref("");
const selectedTemplateId = ref("");
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
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_MEDIA_DURATION_SECONDS = 20;
const UPLOAD_TIMEOUT_MS = 20_000;

const buttonDrafts = reactive<Record<string, { label: string; isEnabled: boolean }>>({});
const replacementFiles = reactive<Record<string, File | null>>({});
const dirtyButtonIds = reactive(new Set<string>());
const pendingCreateOperationId = ref("");
const pendingCreateStorageId = ref<string | null>(null);
const pendingCreateFingerprint = ref("");

watch(
  () => props.buttons,
  (buttons) => {
    for (const button of buttons) {
      if (!buttonDrafts[button.id]) {
        buttonDrafts[button.id] = {
          label: button.label,
          isEnabled: button.isEnabled,
        };
      } else if (!dirtyButtonIds.has(button.id)) {
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
        dirtyButtonIds.delete(id);
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
const { mutate: discardUnattachedUpload } = useConvexMutation(
  api.uploads.discardUnattachedUpload,
);
const { mutate: createButton } = useConvexMutation(api.buttons.createButton);
const { mutate: updateButton } = useConvexMutation(api.buttons.updateButton);
const { mutate: deleteButton } = useConvexMutation(api.buttons.deleteButton);
const { mutate: setOutcomeSounds } = useConvexMutation(api.buttons.setOutcomeSounds);
const { mutate: saveRoomAsTemplate } = useConvexMutation(api.buttons.saveRoomAsTemplate);
const { mutate: applyTemplateToRoom } = useConvexMutation(api.buttons.applyTemplateToRoom);
const { mutate: deleteTemplate } = useConvexMutation(api.buttons.deleteTemplate);

const templateQueryArgs = computed(() => ({
  ownerToken: props.ownerToken,
}));
const { data: templateData, isPending: templatesPending } = useConvexQuery(
  api.buttons.listTemplates,
  templateQueryArgs,
);
const templates = computed<RoomTemplateSummary[]>(() => toTemplateSummaries(templateData.value));
const selectedTemplate = computed(
  () => templates.value.find((template) => template.id === selectedTemplateId.value) ?? null,
);

watch(
  templates,
  (nextTemplates) => {
    if (!nextTemplates.length) {
      selectedTemplateId.value = "";
      return;
    }

    if (!selectedTemplateId.value || !nextTemplates.find((template) => template.id === selectedTemplateId.value)) {
      selectedTemplateId.value = nextTemplates[0].id;
    }
  },
  { immediate: true },
);

const clearMessages = () => {
  panelError.value = "";
  panelSuccess.value = "";
};

const formatTemplateUpdatedAt = (timestamp: number) => (
  new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
);

const onSelectFile = (event: Event, target: "draft" | "accept" | "reject") => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;

  if (target === "draft") {
    draftFile.value = file;
    resetPendingCreate();
    return;
  }
  if (target === "accept") {
    acceptFile.value = file;
    return;
  }
  rejectFile.value = file;
};

const discardUpload = async (storageId: string | null | undefined) => {
  if (!storageId) {
    return;
  }
  try {
    await runMutation(discardUnattachedUpload, {
      roomId: props.roomId,
      participantToken: props.participantToken,
      storageId,
    }, {
      operationName: "Discard unused upload",
      convexUrl,
    });
  } catch {
    // The daily retention cleanup provides a second chance for abandoned files.
  }
};

const resetPendingCreate = () => {
  const storageId = pendingCreateStorageId.value;
  pendingCreateOperationId.value = "";
  pendingCreateStorageId.value = null;
  pendingCreateFingerprint.value = "";
  void discardUpload(storageId);
};

const clearCompletedCreate = () => {
  pendingCreateOperationId.value = "";
  pendingCreateStorageId.value = null;
  pendingCreateFingerprint.value = "";
};

const onDraftLabelInput = () => {
  resetPendingCreate();
};

const markButtonDirty = (buttonId: string) => {
  dirtyButtonIds.add(buttonId);
};

const onSelectReplacementFile = (event: Event, buttonId: string) => {
  const input = event.target as HTMLInputElement;
  replacementFiles[buttonId] = input.files?.[0] ?? null;
  markButtonDirty(buttonId);
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

const inferredContentType = (file: File): string => {
  if (file.type.startsWith("audio/") || file.type.startsWith("video/")) {
    return file.type;
  }
  const extension = inferExtension(file.name);
  const byExtension: Record<string, string> = {
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    aac: "audio/aac",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    webm: "audio/webm",
    mp4: "video/mp4",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
    "3gp": "video/3gpp",
    "3gpp": "video/3gpp",
  };
  return extension ? byExtension[extension] ?? "application/octet-stream" : "application/octet-stream";
};

const mediaDurationSeconds = async (file: File): Promise<number | null> => {
  if (!process.client) {
    return null;
  }
  const media = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
  const objectUrl = URL.createObjectURL(file);
  media.preload = "metadata";
  media.src = objectUrl;

  try {
    return await new Promise<number | null>((resolve) => {
      const timeout = window.setTimeout(() => resolve(null), 3_000);
      media.onloadedmetadata = () => {
        window.clearTimeout(timeout);
        resolve(Number.isFinite(media.duration) ? media.duration : null);
      };
      media.onerror = () => {
        window.clearTimeout(timeout);
        resolve(null);
      };
    });
  } finally {
    media.removeAttribute("src");
    media.load();
    URL.revokeObjectURL(objectUrl);
  }
};

const uploadFile = async (file: File) => {
  if (!props.appEnabled) {
    throw new Error(APP_LOCKED_MESSAGE);
  }
  if (!isSupportedSourceFile(file)) {
    throw new Error(UNSUPPORTED_MEDIA_MESSAGE);
  }
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`Media must be smaller than ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  }
  const duration = await mediaDurationSeconds(file);
  if (duration != null && duration > MAX_MEDIA_DURATION_SECONDS) {
    throw new Error(`Media must be ${MAX_MEDIA_DURATION_SECONDS} seconds or shorter.`);
  }
  if (connectionWarning.value) {
    throw new Error(connectionWarning.value);
  }

  const uploadUrlResult = await runMutation<
    { roomId: string; participantToken: string },
    { uploadUrl: string }
  >(generateUploadUrl, {
    roomId: props.roomId,
    participantToken: props.participantToken,
  }, {
    operationName: "Get upload URL",
    convexUrl,
  });

  const uploadUrl = rewriteLoopbackUrlForClient(uploadUrlResult.uploadUrl, undefined, convexUrl);
  const abortController = new AbortController();
  const timeoutHandle = window.setTimeout(() => abortController.abort(), UPLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": inferredContentType(file),
      },
      body: file,
      signal: abortController.signal,
    });
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new Error("File upload timed out. Check the connection and try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutHandle);
  }

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
    const fingerprint = [
      draftLabel.value.trim(),
      draftFile.value.name,
      draftFile.value.size,
      draftFile.value.lastModified,
    ].join("|");
    if (pendingCreateFingerprint.value !== fingerprint) {
      pendingCreateFingerprint.value = fingerprint;
      pendingCreateOperationId.value = createOperationId();
      pendingCreateStorageId.value = null;
    }
    const fileStorageId = pendingCreateStorageId.value ?? await uploadFile(draftFile.value);
    pendingCreateStorageId.value = fileStorageId;
    await runMutation(createButton, {
      roomId: props.roomId,
      participantToken: props.participantToken,
      operationId: pendingCreateOperationId.value,
      label: draftLabel.value.trim(),
      fileStorageId,
      sortOrder: props.buttons.length ? props.buttons[props.buttons.length - 1].sortOrder + 1 : 0,
    }, {
      operationName: "Create button",
      convexUrl,
    });

    draftLabel.value = "";
    draftFile.value = null;
    clearCompletedCreate();
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
  let fileStorageId: string | undefined;
  try {
    if (replacementFiles[buttonId]) {
      fileStorageId = await uploadFile(replacementFiles[buttonId] as File);
    }

    await runMutation(updateButton, {
      roomId: props.roomId,
      buttonId,
      participantToken: props.participantToken,
      label: draft.label,
      isEnabled: draft.isEnabled,
      fileStorageId,
    }, {
      operationName: "Update button",
      convexUrl,
    });

    replacementFiles[buttonId] = null;
    dirtyButtonIds.delete(buttonId);
    panelSuccess.value = "Button updated.";
  } catch (error) {
    void discardUpload(fileStorageId);
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
  const targetButton = props.buttons.find((button) => button.id === buttonId);
  if (process.client) {
    const confirmed = window.confirm(`Delete "${targetButton?.label ?? "this button"}"?`);
    if (!confirmed) {
      return;
    }
  }

  isSaving.value = true;
  try {
    await runMutation(deleteButton, {
      roomId: props.roomId,
      buttonId,
      participantToken: props.participantToken,
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
  let acceptStorageId: string | undefined;
  let rejectStorageId: string | undefined;
  try {
    acceptStorageId = await uploadFile(acceptFile.value);
    rejectStorageId = await uploadFile(rejectFile.value);

    await runMutation(setOutcomeSounds, {
      roomId: props.roomId,
      participantToken: props.participantToken,
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
    void discardUpload(acceptStorageId);
    void discardUpload(rejectStorageId);
    panelError.value = toErrorMessage(error);
  } finally {
    isSaving.value = false;
  }
};

const saveCurrentAsTemplate = async () => {
  clearMessages();
  if (!props.appEnabled) {
    panelError.value = APP_LOCKED_MESSAGE;
    return;
  }
  if (connectionWarning.value) {
    panelError.value = connectionWarning.value;
    return;
  }

  const normalizedName = templateName.value.trim();
  if (!normalizedName) {
    panelError.value = "Template name is required.";
    return;
  }

  isSaving.value = true;
  try {
    const result = await runMutation<
      { roomId: string; participantToken: string; ownerToken: string; templateName: string },
      { templateId: string; replaced: boolean; buttonCount: number }
    >(saveRoomAsTemplate, {
      roomId: props.roomId,
      participantToken: props.participantToken,
      ownerToken: props.ownerToken,
      templateName: normalizedName,
    }, {
      operationName: "Save template",
      convexUrl,
    });

    selectedTemplateId.value = String(result.templateId);
    panelSuccess.value = result.replaced
      ? `Template "${normalizedName}" updated.`
      : `Template "${normalizedName}" saved.`;
  } catch (error) {
    panelError.value = toErrorMessage(error);
  } finally {
    isSaving.value = false;
  }
};

const applyTemplate = async () => {
  clearMessages();
  if (!props.appEnabled) {
    panelError.value = APP_LOCKED_MESSAGE;
    return;
  }
  if (connectionWarning.value) {
    panelError.value = connectionWarning.value;
    return;
  }
  if (!selectedTemplateId.value) {
    panelError.value = "Select a template first.";
    return;
  }

  if (process.client) {
    const templateLabel = selectedTemplate.value?.name ?? "this template";
    const confirmed = window.confirm(
      `Apply "${templateLabel}" to this room? This replaces all current buttons.`,
    );
    if (!confirmed) {
      return;
    }
  }

  isSaving.value = true;
  try {
    const result = await runMutation<
      { roomId: string; templateId: string; participantToken: string; ownerToken: string },
      { appliedButtonCount: number }
    >(applyTemplateToRoom, {
      roomId: props.roomId,
      templateId: selectedTemplateId.value,
      participantToken: props.participantToken,
      ownerToken: props.ownerToken,
    }, {
      operationName: "Apply template",
      convexUrl,
    });

    panelSuccess.value = `Template applied (${result.appliedButtonCount} buttons).`;
  } catch (error) {
    panelError.value = toErrorMessage(error);
  } finally {
    isSaving.value = false;
  }
};

const removeTemplate = async () => {
  clearMessages();
  if (!props.appEnabled) {
    panelError.value = APP_LOCKED_MESSAGE;
    return;
  }
  if (connectionWarning.value) {
    panelError.value = connectionWarning.value;
    return;
  }
  if (!selectedTemplateId.value) {
    panelError.value = "Select a template first.";
    return;
  }

  if (process.client) {
    const templateLabel = selectedTemplate.value?.name ?? "this template";
    const confirmed = window.confirm(`Delete template "${templateLabel}"?`);
    if (!confirmed) {
      return;
    }
  }

  isSaving.value = true;
  try {
    await runMutation(deleteTemplate, {
      templateId: selectedTemplateId.value,
      ownerToken: props.ownerToken,
    }, {
      operationName: "Delete template",
      convexUrl,
    });
    panelSuccess.value = "Template deleted.";
  } catch (error) {
    panelError.value = toErrorMessage(error);
  } finally {
    isSaving.value = false;
  }
};

onUnmounted(() => {
  const storageId = pendingCreateStorageId.value;
  clearCompletedCreate();
  void discardUpload(storageId);
});
</script>

<template>
  <div class="driver-panel">
    <div class="driver-panel__intro">
      <div>
        <span class="driver-panel__kicker">Main driver</span>
        <h3>Manage soundboard</h3>
        <p class="muted">Add signals, reuse templates, and configure decision sounds.</p>
      </div>
      <span class="driver-panel__count">{{ buttons.length }} signals</span>
    </div>

    <div v-if="!props.appEnabled" class="driver-notice">{{ APP_LOCKED_MESSAGE }}</div>
    <p v-if="connectionWarning" class="error">{{ connectionWarning }}</p>

    <details class="driver-group" open>
      <summary>
        <span class="driver-group__icon">＋</span>
        <span><strong>Create signal</strong><small>Add a new large soundboard button</small></span>
        <span class="driver-group__chevron">⌄</span>
      </summary>
      <div class="driver-group__body">
        <div class="row">
          <div class="driver-col">
            <label>Label</label>
            <input v-model="draftLabel" maxlength="48" placeholder="Example: Horn" @input="onDraftLabelInput" />
          </div>
          <div class="driver-col">
            <label>Sound file</label>
            <input type="file" :accept="SOURCE_FILE_ACCEPT" @change="(event) => onSelectFile(event, 'draft')" />
            <span class="field-help">Audio or video, up to 8 MB and 20 seconds.</span>
          </div>
        </div>
        <button class="driver-primary" :disabled="!props.appEnabled || Boolean(connectionWarning) || isSaving" @click="createNewButton">
          {{ isSaving ? 'Working…' : 'Create Button' }}
        </button>
      </div>
    </details>

    <details class="driver-group">
      <summary>
        <span class="driver-group__icon driver-group__icon--blue">▣</span>
        <span><strong>Templates</strong><small>Reuse a complete setup in future rooms</small></span>
        <span class="driver-group__chevron">⌄</span>
      </summary>
      <div class="driver-group__body">
        <div class="row">
          <div class="driver-col">
            <label>Template name</label>
            <input v-model="templateName" maxlength="80" placeholder="Example: Weekend Ride" />
          </div>
          <div class="driver-col template-actions">
            <label>&nbsp;</label>
            <button
              :disabled="!props.appEnabled || Boolean(connectionWarning) || isSaving || !templateName.trim()"
              @click="saveCurrentAsTemplate"
            >
              Save Current Setup as Template
            </button>
          </div>
        </div>

        <p v-if="templatesPending" class="muted">Loading templates...</p>
        <p v-else-if="!templates.length" class="empty-helper">No templates saved yet.</p>
        <template v-else>
          <div class="row template-picker">
            <div class="driver-col">
              <label>Saved templates</label>
              <select v-model="selectedTemplateId">
                <option v-for="template in templates" :key="template.id" :value="template.id">
                  {{ template.name }} · {{ template.buttonCount }} buttons ·
                  {{ template.hasOutcomeSounds ? "with outcomes" : "no outcomes" }}
                </option>
              </select>
              <p v-if="selectedTemplate" class="muted template-meta">
                Updated {{ formatTemplateUpdatedAt(selectedTemplate.updatedAt) }}
              </p>
            </div>
          </div>
          <div class="row template-action-row">
            <button
              :disabled="!props.appEnabled || Boolean(connectionWarning) || isSaving || !selectedTemplateId"
              class="secondary"
              @click="applyTemplate"
            >
              Apply Template to This Room
            </button>
            <button
              :disabled="!props.appEnabled || Boolean(connectionWarning) || isSaving || !selectedTemplateId"
              class="danger"
              @click="removeTemplate"
            >
              Delete Template
            </button>
          </div>
        </template>
      </div>
    </details>

    <details class="driver-group">
      <summary>
        <span class="driver-group__icon driver-group__icon--amber">✓</span>
        <span><strong>Decision sounds</strong><small>Audio played after accept or reject</small></span>
        <span class="driver-group__chevron">⌄</span>
      </summary>
      <div class="driver-group__body">
        <div class="outcome-status">
          <span class="badge" :class="outcomeSounds.acceptUrl ? 'ok' : 'off'">Accept {{ outcomeSounds.acceptUrl ? 'ready' : 'missing' }}</span>
          <span class="badge" :class="outcomeSounds.rejectUrl ? 'ok' : 'off'">Reject {{ outcomeSounds.rejectUrl ? 'ready' : 'missing' }}</span>
        </div>
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
    </details>

    <details class="driver-group" :open="buttons.length > 0">
      <summary>
        <span class="driver-group__icon driver-group__icon--slate">≡</span>
        <span><strong>Existing signals</strong><small>Edit, disable, replace, or remove buttons</small></span>
        <span class="driver-group__chevron">⌄</span>
      </summary>
      <div class="driver-group__body">
        <p v-if="!buttons.length" class="empty-helper">No buttons configured.</p>

        <div v-for="button in buttons" :key="button.id" class="button-row">
          <div class="button-row__heading">
            <strong>{{ button.label }}</strong>
            <span class="badge" :class="buttonDrafts[button.id].isEnabled ? 'ok' : 'off'">
              {{ buttonDrafts[button.id].isEnabled ? 'Enabled' : 'Disabled' }}
            </span>
          </div>
          <div class="row">
            <div class="driver-col">
              <label>Label</label>
              <input
                v-model="buttonDrafts[button.id].label"
                maxlength="48"
                @input="markButtonDirty(button.id)"
              />
            </div>
            <div class="driver-col">
              <label>Replace sound (optional)</label>
              <input
                type="file"
                :accept="SOURCE_FILE_ACCEPT"
                @change="(event) => onSelectReplacementFile(event, button.id)"
              />
            </div>
            <label class="toggle-field">
              <input
                type="checkbox"
                v-model="buttonDrafts[button.id].isEnabled"
                @change="markButtonDirty(button.id)"
              />
              <span class="toggle-field__track"><i></i></span>
              <span>Enabled</span>
            </label>
          </div>
          <div class="row button-row__actions">
            <button :disabled="!props.appEnabled || Boolean(connectionWarning) || isSaving" class="secondary" @click="saveButton(button.id)">Save</button>
            <button :disabled="!props.appEnabled || Boolean(connectionWarning) || isSaving" class="ghost danger-text" @click="removeButton(button.id)">Delete</button>
          </div>
        </div>
      </div>
    </details>

    <p v-if="panelError" class="error driver-message">{{ panelError }}</p>
    <p v-if="panelSuccess" class="success driver-message">{{ panelSuccess }}</p>
  </div>
</template>

<style scoped>
.driver-panel {
  display: grid;
  gap: 0.7rem;
}

.driver-panel__intro {
  align-items: center;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  margin-bottom: 0.25rem;
}

.driver-panel__intro p {
  font-size: 0.82rem;
  margin: 0.2rem 0 0;
}

.driver-panel__kicker {
  color: var(--accent);
  display: block;
  font-size: 0.68rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.driver-panel__count {
  background: var(--accent-soft);
  border-radius: 999px;
  color: var(--accent);
  flex: 0 0 auto;
  font-size: 0.72rem;
  font-weight: 850;
  padding: 0.38rem 0.65rem;
}

.driver-notice {
  background: var(--warn-soft);
  border: 1px solid #efd5a8;
  border-radius: 12px;
  color: #855617;
  font-size: 0.8rem;
  font-weight: 700;
  padding: 0.7rem;
}

.driver-group {
  background: #fff;
  border: 1px solid var(--panel-border);
  border-radius: 14px;
  overflow: hidden;
}

.driver-group summary {
  align-items: center;
  cursor: pointer;
  display: grid;
  gap: 0.65rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  list-style: none;
  min-height: 66px;
  padding: 0.7rem 0.8rem;
  user-select: none;
}

.driver-group summary::-webkit-details-marker {
  display: none;
}

.driver-group summary:hover {
  background: var(--panel-soft);
}

.driver-group summary > span:nth-child(2) {
  display: flex;
  flex-direction: column;
}

.driver-group summary strong {
  font-size: 0.88rem;
}

.driver-group summary small {
  color: var(--text-muted);
  font-size: 0.72rem;
  font-weight: 600;
  margin-top: 0.1rem;
}

.driver-group__icon {
  align-items: center;
  background: var(--accent-soft);
  border-radius: 10px;
  color: var(--accent);
  display: inline-flex;
  font-size: 1rem;
  font-weight: 900;
  height: 36px;
  justify-content: center;
  width: 36px;
}

.driver-group__icon--blue {
  background: var(--blue-soft);
  color: var(--blue);
}

.driver-group__icon--amber {
  background: var(--warn-soft);
  color: var(--warn);
}

.driver-group__icon--slate {
  background: #edf2f7;
  color: #61748a;
}

.driver-group__chevron {
  color: var(--text-muted);
  font-size: 1.1rem;
  transition: transform 0.16s ease;
}

.driver-group[open] .driver-group__chevron {
  transform: rotate(180deg);
}

.driver-group__body {
  border-top: 1px solid var(--panel-border);
  display: grid;
  gap: 0.75rem;
  padding: 0.85rem;
}

.driver-col {
  flex: 1 1 230px;
  min-width: 0;
}

.template-actions {
  align-self: flex-end;
}

.template-action-row,
.template-picker {
  margin-top: 0.1rem;
}

.template-meta {
  font-size: 0.75rem;
  margin: 0.35rem 0 0;
}

.field-help {
  color: var(--text-muted);
  display: block;
  font-size: 0.7rem;
  margin-top: 0.3rem;
}

.driver-primary {
  justify-self: start;
}

.empty-helper {
  background: var(--panel-soft);
  border: 1px dashed var(--panel-border-strong);
  border-radius: 12px;
  color: var(--text-muted);
  font-size: 0.8rem;
  margin: 0;
  padding: 0.8rem;
  text-align: center;
}

.outcome-status {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.button-row {
  background: var(--panel-soft);
  border: 1px solid var(--panel-border);
  border-radius: 13px;
  padding: 0.8rem;
}

.button-row + .button-row {
  margin-top: 0.2rem;
}

.button-row__heading {
  align-items: center;
  display: flex;
  gap: 0.7rem;
  justify-content: space-between;
  margin-bottom: 0.65rem;
}

.button-row__heading strong {
  font-size: 0.86rem;
}

.button-row__actions {
  margin-top: 0.1rem;
}

.button-row__actions button {
  min-width: 88px;
}

.danger-text {
  color: var(--danger);
}

.toggle-field {
  align-items: center;
  align-self: flex-end;
  cursor: pointer;
  display: inline-flex;
  flex: 0 0 auto;
  gap: 0.45rem;
  margin: 0 0 0.25rem;
}

.toggle-field > input {
  height: 1px;
  opacity: 0;
  position: absolute;
  width: 1px;
}

.toggle-field__track {
  background: #cbd4df;
  border-radius: 999px;
  display: inline-flex;
  height: 24px;
  padding: 3px;
  transition: background 0.15s ease;
  width: 42px;
}

.toggle-field__track i {
  background: #fff;
  border-radius: 999px;
  box-shadow: 0 1px 3px rgb(30 45 64 / 20%);
  height: 18px;
  transform: translateX(0);
  transition: transform 0.15s ease;
  width: 18px;
}

.toggle-field > input:checked + .toggle-field__track {
  background: var(--accent);
}

.toggle-field > input:checked + .toggle-field__track i {
  transform: translateX(18px);
}

.toggle-field > input:focus-visible + .toggle-field__track {
  box-shadow: var(--focus-ring);
}

.driver-message {
  margin: 0;
}

@media (max-width: 620px) {
  .driver-panel__intro {
    align-items: flex-start;
  }

  .driver-group summary {
    padding-left: 0.65rem;
    padding-right: 0.65rem;
  }

  .driver-group__body {
    padding: 0.7rem;
  }

  .template-actions label {
    display: none;
  }

  .template-actions button,
  .driver-primary {
    width: 100%;
  }

  .toggle-field {
    margin-top: 0.25rem;
  }
}
</style>
