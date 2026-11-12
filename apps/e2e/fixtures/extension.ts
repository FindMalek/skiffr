import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { type BrowserContext, test as base, chromium, type Page, type Worker } from "@playwright/test"
import { type MockApi, startMockApi } from "../mock-api/server.ts"
import { type FixtureServer, startFixtureServer } from "../server/fixture-server.ts"
import { ATS_HOSTS } from "./adapters.ts"

const HERE = dirname(fileURLToPath(import.meta.url))

/** CI points this at the unzipped artifact from the extension job; locally it falls back to a fresh `wxt build`. */
export const EXTENSION_DIR = resolve(
  process.env.E2E_EXTENSION_DIR ?? join(HERE, "..", "..", "extension", ".output", "chrome-mv3"),
)

/** Job links are public web addresses, so a queued job cannot be on 127.0.0.1: this domain resolves to the fixture server. */
export const QUEUE_HOST = "jobs.skiffr.test"

interface WorkerFixtures {
  fixtureServer: FixtureServer
  mockApi: MockApi
}

interface TestFixtures {
  context: BrowserContext
  serviceWorker: Worker
  extensionId: string
  optionsPage: Page
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  fixtureServer: [
    // biome-ignore lint/correctness/noEmptyPattern: playwright needs the destructured first argument
    async ({}, use) => {
      const server = await startFixtureServer()
      await use(server)
      await server.stop()
    },
    { scope: "worker" },
  ],
  mockApi: [
    // biome-ignore lint/correctness/noEmptyPattern: playwright needs the destructured first argument
    async ({}, use) => {
      const api = await startMockApi()
      await use(api)
      await api.stop()
    },
    { scope: "worker" },
  ],
  // biome-ignore lint/correctness/noEmptyPattern: playwright needs the destructured first argument
  context: async ({}, use) => {
    if (!existsSync(join(EXTENSION_DIR, "manifest.json"))) {
      throw new Error(
        `No built extension at ${EXTENSION_DIR}. Run \`pnpm --filter extension build\` or set E2E_EXTENSION_DIR.`,
      )
    }
    const userDataDir = mkdtempSync(join(tmpdir(), "skiffr-e2e-"))
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      ignoreHTTPSErrors: true,
      args: [
        `--disable-extensions-except=${EXTENSION_DIR}`,
        `--load-extension=${EXTENSION_DIR}`,
        `--host-resolver-rules=${[QUEUE_HOST, ...ATS_HOSTS].map((host) => `MAP ${host} 127.0.0.1`).join(", ")}`,
      ],
    })
    await use(context)
    await context.close()
    rmSync(userDataDir, { recursive: true, force: true })
  },
  serviceWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
    await use(worker)
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host)
  },
  optionsPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/options.html`)
    await use(page)
  },
})

export { expect } from "@playwright/test"
