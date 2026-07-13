import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import {
  addSignal,
  assertMinimumTouchTargets,
  assertNoHorizontalOverflow,
  attachScreenshot,
  createRoom,
  gotoHome,
  selectControlTab,
  unlockAudio,
} from "./helpers";

async function expectAccessible(page: import("@playwright/test").Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      description: violation.description,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

test.describe("accessibility and responsive quality", () => {
  test("home page passes automated WCAG and best-practice checks", async ({ page }) => {
    await gotoHome(page);
    await expectAccessible(page);
  });

  test("create mode passes automated accessibility checks", async ({ page }) => {
    await gotoHome(page);
    await page.getByTestId("mode-create").click();
    await expectAccessible(page);
  });

  test("locked room passes automated accessibility checks", async ({ page }) => {
    await createRoom(page);
    await expectAccessible(page);
  });

  test("all control-center tabs pass automated accessibility checks", async ({ page }) => {
    test.setTimeout(120_000);
    await createRoom(page);
    await unlockAudio(page);

    for (const tab of ["room", "people", "activity", "manage"] as const) {
      await selectControlTab(page, tab);
      await expectAccessible(page);
    }
  });

  test("confirmation dialog is named, described, keyboard trapped, and dismissible", async ({ page }) => {
    await createRoom(page);
    const label = await addSignal(page, "Accessible delete");
    const row = page.getByTestId("driver-signal-row").filter({ hasText: label });
    const deleteButton = row.getByTestId("signal-delete");
    await deleteButton.focus();
    await deleteButton.click();

    const dialog = page.getByRole("dialog", { name: "Delete signal?" });
    const cancelButton = dialog.getByTestId("confirm-cancel");
    const confirmButton = dialog.getByTestId("confirm-submit");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-labelledby", /.+/);
    await expect(dialog).toHaveAttribute("aria-describedby", /.+/);
    await expect(cancelButton).toBeFocused();
    await expectAccessible(page);

    await page.keyboard.press("Shift+Tab");
    await expect(confirmButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(cancelButton).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(deleteButton).toBeFocused();
  });

  test("visible controls meet touch-target and overflow requirements", async ({ page }, testInfo) => {
    await gotoHome(page);
    await assertNoHorizontalOverflow(page);
    await assertMinimumTouchTargets(page);

    await createRoom(page);
    await unlockAudio(page);
    await selectControlTab(page, "manage");
    await assertNoHorizontalOverflow(page);
    await assertMinimumTouchTargets(page);
    await attachScreenshot(page, testInfo, `responsive-${testInfo.project.name}`);
  });

  test("status information remains understandable without relying on color", async ({ page }) => {
    await createRoom(page);
    await expect(page.getByTestId("audio-status")).toContainText("Enable audio");
    await expect(page.getByTestId("online-status")).toContainText("online");
    await expect(page.getByTestId("queue-status")).toContainText("queued");
    await unlockAudio(page);
    await expect(page.getByTestId("audio-status")).toContainText("Audio ready");
  });
});
