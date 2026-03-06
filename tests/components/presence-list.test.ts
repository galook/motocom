// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import PresenceList from "../../components/PresenceList.vue";

describe("PresenceList", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders participant counts and role badges", () => {
    vi.spyOn(Date, "now").mockReturnValue(100_000);

    const wrapper = mount(PresenceList, {
      props: {
        participants: [
          {
            sessionId: "s1",
            displayName: "Main",
            isMainDriver: true,
            lastSeenAt: 99_900,
            isActive: true,
          },
          {
            sessionId: "s2",
            displayName: "Rider",
            isMainDriver: false,
            lastSeenAt: 40_000,
            isActive: false,
          },
        ],
      },
    });

    expect(wrapper.text()).toContain("Active: 1 / 2");
    expect(wrapper.text()).toContain("Main driver");
    expect(wrapper.text()).toContain("inactive (1m ago)");
    expect(wrapper.text()).not.toContain("s1");
    expect(wrapper.text()).not.toContain("s2");
  });
});
