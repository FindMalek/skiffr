import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: process.env.CI ? 4 : undefined,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { trace: "retain-on-first-failure" },
  projects: [{ name: "extension", use: { channel: "chromium" } }],
})
