import { test, expect } from "./fixtures";
import {
  INVALID_MEDIA_FILE,
  TONE_FILE,
  addSignal,
  createRoom,
  selectControlTab,
  uniqueValue,
  unlockAudio,
} from "./helpers";

async function openGroup(page: import("@playwright/test").Page, testId: string): Promise<void> {
  const details = page.getByTestId(testId);
  if ((await details.getAttribute("open")) === null) {
    await details.locator("summary").click();
  }
  await expect(details).toHaveAttribute("open", "");
}

test.describe("main-driver soundboard management", () => {
  test("uploads a valid audio file and creates a signal", async ({ page }) => {
    await createRoom(page);
    const label = uniqueValue("Horn");
    await addSignal(page, label);

    const button = page.getByTestId("sound-button").filter({ hasText: label });
    await expect(button).toBeEnabled();
    await expect(button).toHaveAttribute("data-button-label", label);
    await expect(button).toContainText("Ready");
  });

  test("rejects unsupported media without creating a signal", async ({ page }) => {
    await createRoom(page);
    await unlockAudio(page);
    await selectControlTab(page, "manage");
    await page.getByTestId("driver-create-label").fill("Bad media");
    await page.getByTestId("driver-create-file").setInputFiles(INVALID_MEDIA_FILE);
    await page.getByTestId("driver-create-submit").click();

    await expect(page.getByTestId("driver-error")).toContainText("Unsupported file format");
    await expect(page.getByTestId("sound-button").filter({ hasText: "Bad media" })).toHaveCount(0);
  });

  test("rejects media above the upload size limit", async ({ page }) => {
    test.setTimeout(90_000);
    await createRoom(page);
    await unlockAudio(page);
    await selectControlTab(page, "manage");
    await page.getByTestId("driver-create-label").fill("Oversized media");
    await page.getByTestId("driver-create-file").setInputFiles({
      name: "too-large.wav",
      mimeType: "audio/wav",
      buffer: Buffer.alloc(8 * 1024 * 1024 + 1),
    });
    await page.getByTestId("driver-create-submit").click();

    await expect(page.getByTestId("driver-error")).toContainText("smaller than 8 MB");
  });

  test("renames and disables an existing signal", async ({ page }) => {
    await createRoom(page);
    const original = await addSignal(page, uniqueValue("Original"));
    const renamed = uniqueValue("Renamed");
    const row = page.getByTestId("driver-signal-row").filter({ hasText: original });

    await row.getByTestId("signal-edit-label").fill(renamed);
    await row.getByTestId("signal-enabled").uncheck();
    await row.getByTestId("signal-save").click();
    await expect(page.getByTestId("driver-success")).toContainText("Signal updated");

    const updatedButton = page.getByTestId("sound-button").filter({ hasText: renamed });
    await expect(updatedButton).toBeVisible();
    await expect(updatedButton).toBeDisabled();
    await expect(updatedButton).toContainText("Disabled");
    await expect(page.getByTestId("sound-button").filter({ hasText: original })).toHaveCount(0);
  });

  test("cancels and confirms signal deletion using the shared dialog", async ({ page }) => {
    await createRoom(page);
    const label = await addSignal(page, uniqueValue("Delete me"));
    const row = page.getByTestId("driver-signal-row").filter({ hasText: label });

    await row.getByTestId("signal-delete").click();
    const deleteDialog = page.getByRole("dialog", { name: "Delete signal?" });
    await expect(deleteDialog).toBeVisible();
    await expect(deleteDialog.getByRole("heading", { name: "Delete signal?" })).toBeVisible();
    await deleteDialog.getByTestId("confirm-cancel").click();
    await expect(deleteDialog).toBeHidden();
    await expect(row).toBeVisible();

    await row.getByTestId("signal-delete").click();
    await deleteDialog.getByTestId("confirm-submit").click();
    await expect(deleteDialog).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId("driver-success")).toContainText("Signal deleted");
    await expect(page.getByTestId("sound-button").filter({ hasText: label })).toHaveCount(0);
  });

  test("removes a signal directly from the board while Manage is open", async ({ page }) => {
    await createRoom(page);
    const label = await addSignal(page, uniqueValue("Grid delete"));
    const soundWrap = page.getByTestId("sound-button").filter({ hasText: label }).locator("..");

    await soundWrap.getByTestId("sound-remove").click();
    const deleteDialog = page.getByRole("dialog", { name: "Delete signal?" });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByTestId("confirm-cancel").click();
    await expect(page.getByTestId("sound-button").filter({ hasText: label })).toBeVisible();

    await soundWrap.getByTestId("sound-remove").click();
    await deleteDialog.getByTestId("confirm-submit").click();
    await expect(page.getByTestId("sound-button").filter({ hasText: label })).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.getByTestId("page-toast")).toContainText("Signal removed");
  });

  test("saves, applies, and deletes a reusable template", async ({ page }) => {
    test.setTimeout(120_000);
    await createRoom(page);
    const savedLabel = await addSignal(page, uniqueValue("Saved signal"));
    await openGroup(page, "driver-group-templates");
    const templateName = uniqueValue("Template");
    await page.getByTestId("template-name").fill(templateName);
    await page.getByTestId("template-save").click();
    await expect(page.getByTestId("driver-success")).toContainText(/Template .* saved|updated/);
    await expect(page.getByTestId("template-select")).toContainText(templateName);

    const row = page.getByTestId("driver-signal-row").filter({ hasText: savedLabel });
    const changedLabel = uniqueValue("Changed signal");
    await row.getByTestId("signal-edit-label").fill(changedLabel);
    await row.getByTestId("signal-save").click();
    await expect(page.getByTestId("sound-button").filter({ hasText: changedLabel })).toBeVisible();

    await page.getByTestId("template-apply").click();
    const applyDialog = page.getByRole("dialog", { name: "Replace this soundboard?" });
    await expect(applyDialog).toBeVisible();
    await applyDialog.getByTestId("confirm-submit").click();
    await expect(page.getByTestId("driver-success")).toContainText("Template applied", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("sound-button").filter({ hasText: savedLabel })).toBeVisible();
    await expect(page.getByTestId("sound-button").filter({ hasText: changedLabel })).toHaveCount(0);

    await page.getByTestId("template-delete").click();
    const deleteTemplateDialog = page.getByRole("dialog", { name: "Delete template?" });
    await expect(deleteTemplateDialog).toBeVisible();
    await deleteTemplateDialog.getByTestId("confirm-submit").click();
    await expect(page.getByTestId("driver-success")).toContainText("Template deleted");
    await expect(page.getByText("No templates saved yet.")).toBeVisible();
  });

  test("uploads accept and reject decision sounds", async ({ page }) => {
    test.setTimeout(90_000);
    await createRoom(page);
    await unlockAudio(page);
    await selectControlTab(page, "manage");
    await openGroup(page, "driver-group-outcomes");

    await page.getByTestId("outcome-accept-file").setInputFiles(TONE_FILE);
    await page.getByTestId("outcome-reject-file").setInputFiles(TONE_FILE);
    await page.getByTestId("outcome-save").click();
    await expect(page.getByTestId("driver-success")).toContainText("Decision sounds saved", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("driver-group-outcomes")).toContainText("Accept ready");
    await expect(page.getByTestId("driver-group-outcomes")).toContainText("Reject ready");
  });

  test("filters a large soundboard and clears an empty search", async ({ page }) => {
    test.setTimeout(180_000);
    await createRoom(page);
    const labels: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      labels.push(await addSignal(page, `Signal ${index + 1} ${Math.random().toString(36).slice(2, 5)}`));
    }

    const target = labels[5];
    await expect(page.getByTestId("sound-search")).toBeVisible();
    await page.getByTestId("sound-search").fill(target);
    await expect(page.getByTestId("sound-button")).toHaveCount(1);
    await expect(page.getByTestId("sound-button")).toContainText(target);

    await page.getByTestId("sound-search").fill("no such signal");
    await expect(page.getByTestId("empty-board")).toContainText("No matching signals");
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page.getByTestId("sound-button")).toHaveCount(7);
  });
});
