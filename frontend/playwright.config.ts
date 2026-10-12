import { defineConfig, devices } from "@playwright/test";

// Browser tests against the production build (`pnpm build` first), with the
// API and Supabase mocked per test (e2e/mock-backend.ts). Port 3100 so a
// dev server on 3000 doesn't collide.
const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // Tests run with reduced motion: nothing is mid-animation when an element is
    // clicked or axe measures contrast, and it exercises the same path people
    // who ask their OS for less motion get.
    reducedMotion: "reduce",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
