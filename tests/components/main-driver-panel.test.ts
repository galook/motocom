// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { computed, reactive, ref, watch } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runMutationMock = vi.fn();

vi.mock("~/utils/mutation", () => ({
  runMutation: (...args: unknown[]) => runMutationMock(...args),
  buildConnectivityHint: () => null,
  rewriteLoopbackUrlForClient: (url: string) => url,
  toErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

function createMutationQueue() {
  return [vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()];
}

async function mountPanel(overrides?: Record<string, unknown>) {
  const mutationQueue = createMutationQueue();
  (globalThis as any).useConvexMutation = vi.fn(() => ({ mutate: mutationQueue.shift() }));
  (globalThis as any).useRuntimeConfig = vi.fn(() => ({
    public: {
      convexUrl: "http://localhost:3210",
    },
  }));
  (globalThis as any).ref = ref;
  (globalThis as any).computed = computed;
  (globalThis as any).reactive = reactive;
  (globalThis as any).watch = watch;

  const component = (await import("../../components/MainDriverPanel.vue")).default;
  const wrapper = mount(component, {
    props: {
      roomId: "room1",
      sessionId: "session1",
      buttons: [],
      outcomeSounds: {
        acceptUrl: null,
        rejectUrl: null,
      },
      ...overrides,
    },
  });

  return wrapper;
}

describe("MainDriverPanel", () => {
  beforeEach(() => {
    runMutationMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows empty state when no buttons are configured", async () => {
    const wrapper = await mountPanel();

    expect(wrapper.text()).toContain("No buttons configured.");
  });

  it("validates create button inputs", async () => {
    const wrapper = await mountPanel();

    await wrapper.get("button").trigger("click");

    expect(wrapper.text()).toContain("New button needs both label and a source file (audio or video).");
    expect(runMutationMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported file types", async () => {
    const wrapper = await mountPanel();

    const textInput = wrapper.find('input[placeholder="Example: Horn"]');
    await textInput.setValue("Horn");

    const fileInput = wrapper.findAll('input[type="file"]')[0];
    const file = new File(["text"], "notes.txt", { type: "text/plain" });
    Object.defineProperty(fileInput.element, "files", {
      value: [file],
      writable: false,
    });
    await fileInput.trigger("change");

    await wrapper.get("button").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Unsupported file format");
    expect(runMutationMock).not.toHaveBeenCalled();
  });

  it("creates a button successfully", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ storageId: "storage-1" }),
    });
    (globalThis as any).fetch = fetchMock;

    runMutationMock
      .mockResolvedValueOnce({ uploadUrl: "https://upload.example" })
      .mockResolvedValueOnce({ buttonId: "btn1" });

    const wrapper = await mountPanel();

    const textInput = wrapper.find('input[placeholder="Example: Horn"]');
    await textInput.setValue("Horn");

    const fileInput = wrapper.findAll('input[type="file"]')[0];
    const file = new File(["audio"], "horn.mp3", { type: "audio/mpeg" });
    Object.defineProperty(fileInput.element, "files", {
      value: [file],
      writable: false,
    });
    await fileInput.trigger("change");

    await wrapper.get("button").trigger("click");
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith("https://upload.example", expect.any(Object));
    expect(runMutationMock).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("Button created.");
  });
});
