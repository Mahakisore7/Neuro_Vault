import { expect, test } from "@playwright/test";

import { expectAccessible } from "./a11y";
import { ME, MockBackend, NOTE_IDS } from "./mock-backend";

// Signed-in screens, against an in-memory fake of the API (see
// mock-backend.ts). Each test gets a fresh fake, so they don't share state.

let backend: MockBackend;

test.beforeEach(async ({ page }) => {
  backend = new MockBackend(page);
  await backend.install();
});

const editor = (page: import("@playwright/test").Page) => page.locator(".ProseMirror");

test.describe("accessibility", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`dashboard and a note pass axe in ${scheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
      await expectAccessible(page);

      await page.goto(`/notes/${NOTE_IDS.normalization}`);
      await expect(editor(page)).toBeVisible();
      await expectAccessible(page);
    });
  }
});

test.describe("note editor saving", () => {
  test("leaving a note right after typing still saves the last edit", async ({ page }) => {
    await page.goto(`/notes/${NOTE_IDS.normalization}`);
    await editor(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Typed just before leaving.");
    // Well inside the 1.5s autosave delay: before the fix, this edit was lost.
    await page.getByRole("link", { name: "DBMS" }).click();
    await expect(page).toHaveURL(/\/notebooks\//);
    await expect
      .poll(() => backend.lastSavedContent(NOTE_IDS.normalization))
      .toContain("Typed just before leaving.");
  });

  test("text typed while a save is in flight is not overwritten by its response", async ({
    page,
  }) => {
    backend.patchDelayMs = 1500;
    await page.goto(`/notes/${NOTE_IDS.normalization}`);
    await editor(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" first");
    await page.keyboard.press("Control+s"); // starts a slow save of "… first"
    await expect(page.getByText("Saving…")).toBeVisible();
    await page.keyboard.type(" second"); // typed while that save is on the wire

    await expect(page.getByText("Saved")).toBeVisible({ timeout: 10_000 });
    // Before the fix, the first save's response reset the editor to "… first".
    await expect(editor(page)).toContainText("first second");
    await expect
      .poll(() => backend.lastSavedContent(NOTE_IDS.normalization), { timeout: 10_000 })
      .toContain("first second");
  });

  test("Ctrl+S saves immediately instead of waiting for the autosave", async ({ page }) => {
    await page.goto(`/notes/${NOTE_IDS.normalization}`);
    await editor(page).click();
    await page.keyboard.type("Quick ");
    await page.keyboard.press("Control+s");
    // Under the 1.5s autosave delay, so only the shortcut can have saved it.
    await expect
      .poll(() => backend.lastSavedContent(NOTE_IDS.normalization), { timeout: 1000 })
      .toContain("Quick");
  });
});

test("someone else's public note opens read-only", async ({ page }) => {
  await page.goto(`/notes/${NOTE_IDS.strangers}`);
  await expect(page.getByText(/read-only/i)).toBeVisible();
  await expect(editor(page)).toHaveAttribute("contenteditable", "false");
  await expect(page.getByLabel("Note title")).toHaveAttribute("readonly", "");
  await expect(page.getByRole("button", { name: "Bold" })).toHaveCount(0);
});

test("note page shows where the note lives", async ({ page }) => {
  await page.goto(`/notes/${NOTE_IDS.normalization}`);
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs.getByRole("link", { name: "Semester 5" })).toBeVisible();
  await expect(crumbs.getByRole("link", { name: "DBMS" })).toBeVisible();
});

test.describe("command palette", () => {
  test("Ctrl+K finds a note and opens it", async ({ page }) => {
    await page.goto("/dashboard");
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill("joins");
    await page.getByRole("option", { name: /SQL Joins/ }).click();
    await expect(page).toHaveURL(new RegExp(`/notes/${NOTE_IDS.joins}$`));
  });

  test("typing a command and pressing Enter runs it", async ({ page }) => {
    await page.goto("/dashboard");
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill("go trash");
    await expect(page.getByRole("option", { name: "Go to Trash" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/trash$/);
  });

  test("? opens the keyboard shortcuts", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await expectAccessible(page);
  });
});

test("Empty Trash confirms, then deletes everything in Trash in one request", async ({ page }) => {
  await page.goto("/trash");
  await expect(page.getByText("Old draft")).toBeVisible();
  await page.getByRole("button", { name: "Empty Trash" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Delete 2 notes forever?");
  await page.getByRole("alertdialog").getByRole("button", { name: "Empty Trash" }).click();
  await expect(page.getByText("Trash is empty")).toBeVisible();
  expect(backend.requests.filter((r) => r.method === "DELETE")).toEqual([
    { method: "DELETE", path: "/notes/trash", body: null },
  ]);
});

test.describe("profile", () => {
  test("export downloads a JSON file", async ({ page }) => {
    await page.goto("/profile");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export data" }).click();
    expect((await download).suggestedFilename()).toBe("neurovault-export-test.json");
  });

  test("delete account stays disabled until the email is typed", async ({ page }) => {
    await page.goto("/profile");
    await page.getByRole("button", { name: "Delete account…" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete your account?" });
    const confirm = dialog.getByRole("button", { name: "Delete account" });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/to confirm/).fill("wrong@example.test");
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/to confirm/).fill(ME.email);
    await expect(confirm).toBeEnabled();
    // Nothing was sent: the destructive request only happens on that click.
    expect(backend.requests.some((r) => r.method === "DELETE")).toBe(false);
  });

  test("profile page passes axe", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByRole("button", { name: "Export data" })).toBeVisible();
    await expectAccessible(page);
  });
});
