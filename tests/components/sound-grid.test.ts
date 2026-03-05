// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SoundGrid from "../../components/SoundGrid.vue";

describe("SoundGrid", () => {
  const buttons = [
    {
      id: "b1",
      label: "Horn",
      sortOrder: 0,
      isEnabled: true,
      soundUrl: "horn.mp3",
    },
    {
      id: "b2",
      label: "Stop",
      sortOrder: 1,
      isEnabled: false,
      soundUrl: "stop.mp3",
    },
  ];

  it("renders buttons and active state", () => {
    const wrapper = mount(SoundGrid, {
      props: {
        buttons,
        activeButtonId: "b1",
        disablePress: false,
        buttonStates: {
          b1: "pending",
        },
      },
    });

    expect(wrapper.text()).toContain("Horn");
    expect(wrapper.text()).toContain("Stop");
    expect(wrapper.findAll("button")[0].classes()).toContain("sound-cell--active");
    expect(wrapper.findAll("button")[0].classes()).toContain("sound-cell--pending");
    expect((wrapper.findAll("button")[1].element as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders accepted and rejected visual classes", () => {
    const wrapper = mount(SoundGrid, {
      props: {
        buttons: [
          {
            id: "b1",
            label: "Horn",
            sortOrder: 0,
            isEnabled: true,
            soundUrl: "horn.mp3",
          },
          {
            id: "b2",
            label: "Stop",
            sortOrder: 1,
            isEnabled: true,
            soundUrl: "stop.mp3",
          },
        ],
        activeButtonId: null,
        disablePress: false,
        buttonStates: {
          b1: "accepted",
          b2: "rejected",
        },
      },
    });

    expect(wrapper.findAll("button")[0].classes()).toContain("sound-cell--accepted");
    expect(wrapper.findAll("button")[1].classes()).toContain("sound-cell--rejected");
  });

  it("emits press when enabled button is clicked", async () => {
    const wrapper = mount(SoundGrid, {
      props: {
        buttons,
        activeButtonId: null,
        disablePress: false,
      },
    });

    await wrapper.findAll("button")[0].trigger("click");

    expect(wrapper.emitted("press")).toEqual([["b1"]]);
  });

  it("disables all buttons when disablePress is true", () => {
    const wrapper = mount(SoundGrid, {
      props: {
        buttons,
        activeButtonId: null,
        disablePress: true,
      },
    });

    expect(
      wrapper
        .findAll("button")
        .every((node) => (node.element as HTMLButtonElement).disabled),
    ).toBe(true);
  });

  it("emits remove when removable control is used", async () => {
    const wrapper = mount(SoundGrid, {
      props: {
        buttons,
        activeButtonId: null,
        disablePress: false,
        removable: true,
      },
    });

    await wrapper.find(".sound-cell-remove").trigger("click");

    expect(wrapper.emitted("remove")).toEqual([["b1"]]);
  });
});
