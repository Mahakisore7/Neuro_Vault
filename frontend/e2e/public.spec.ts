import { expect, test } from "@playwright/test";

import { expectAccessible } from "./a11y";

// Signed-out pages. No mocks needed except where noted: they render without
// talking to the API.

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    for (const [name, path] of [
      ["landing", "/"],
      ["sign in", "/login"],
      ["sign up", "/signup"],
      ["forgot password", "/forgot-password"],
      ["not found", "/no-such-page"],
    ] as const) {
      test(`${name} page is accessible`, async ({ page }) => {
        await page.goto(path);
        await page.locator("main, form, h1").first().waitFor();
        await expectAccessible(page);
      });
    }
  });
}

test("sign in links to password reset", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByText("Forgot your password?")).toBeVisible();
});

test("forgot password validates the email before sending", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByRole("button", { name: "Send reset link" }).click();
  // The browser's own type="email" check stops the submit first.
  const valid = await page.getByLabel("Email").evaluate((el) => (el as HTMLInputElement).validity.valid);
  expect(valid).toBe(false);
  await expect(page.getByText("Check your email")).toHaveCount(0);
});

test("a reset page opened without a valid link says so and offers a new one", async ({ page }) => {
  await page.goto("/reset-password");
  await expect(page.getByText("This link has expired or was already used")).toBeVisible();
  await expect(page.getByRole("link", { name: "Send a new link" })).toHaveAttribute(
    "href",
    "/forgot-password",
  );
});

test("an expired email link landing on the home page is routed to the reset page", async ({
  page,
}) => {
  // What Supabase appends when a link was already used or has expired.
  await page.goto("/#error=access_denied&error_code=otp_expired");
  await expect(page).toHaveURL(/\/reset-password/);
  await expect(page.getByText("This link has expired or was already used")).toBeVisible();
});

test("sign up rejects mismatched passwords", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Password", { exact: true }).fill("longenough1");
  await page.getByLabel("Confirm password").fill("different99");
  await page.getByRole("button", { name: /create account|sign up/i }).click();
  await expect(page.getByText(/don.t match/i)).toBeVisible();
});

test("security headers are sent", async ({ request }) => {
  const res = await request.get("/login");
  const headers = res.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-powered-by"]).toBeUndefined();
});
