// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ActiveRequestPanel from "../../components/ActiveRequestPanel.vue";

describe("ActiveRequestPanel", () => {
  it("shows idle state when there is no active request", () => {
    const wrapper = mount(ActiveRequestPanel, {
      props: {
        activeRequest: null,
        isMainDriver: false,
        isResolving: false,
        queueLength: 3,
      },
    });

    expect(wrapper.text()).toContain("No active request right now.");
    expect(wrapper.text()).toContain("Queued: 3");
  });

  it("emits accepted and rejected decisions for main drivers", async () => {
    const wrapper = mount(ActiveRequestPanel, {
      props: {
        activeRequest: {
          id: "r1",
          buttonId: "b1",
          buttonLabel: "Horn",
          requestedBySessionId: "abc",
          createdAt: Date.now(),
          activatedAt: Date.now(),
        },
        isMainDriver: true,
        isResolving: false,
        queueLength: 0,
      },
    });

    const buttons = wrapper.findAll("button");
    await buttons[0].trigger("click");
    await buttons[1].trigger("click");

    expect(wrapper.emitted("resolve")).toEqual([["accepted"], ["rejected"]]);
  });

  it("hides action buttons for non-main drivers", () => {
    const wrapper = mount(ActiveRequestPanel, {
      props: {
        activeRequest: {
          id: "r1",
          buttonId: "b1",
          buttonLabel: "Horn",
          requestedBySessionId: "abc",
          createdAt: Date.now(),
          activatedAt: Date.now(),
        },
        isMainDriver: false,
        isResolving: false,
        queueLength: 0,
      },
    });

    expect(wrapper.findAll("button")).toHaveLength(0);
    expect(wrapper.text()).toContain("Waiting for a main driver");
  });
});
