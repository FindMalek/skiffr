import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { trace: "retain-on-first-failure" },
  projects: [{ name: "extension", use: { channel: "chromium" } }],
})
