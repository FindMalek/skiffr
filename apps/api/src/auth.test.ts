import { beforeAll, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite-pgvector"
import { createAuth, NAME_MAX } from "@skiffr/auth"
import type { Db } from "@skiffr/db"
import * as schema from "@skiffr/db/schema"
import { strictDateSerializers } from "@skiffr/db/test-db"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"

const DASHBOARD = "http://localhost:3002"
const DRIZZLE = new URL("../../../packages/db/drizzle", import.meta.url).pathname
const PASSWORD = "a-long-enough-password"

const links: string[] = []
let auth: ReturnType<typeof createAuth>

beforeAll(async () => {
  const db = drizzle(new PGlite({ extensions: { vector }, serializers: strictDateSerializers }), { schema })
  await migrate(db, { migrationsFolder: DRIZZLE })
  auth = createAuth({
    db: db as unknown as Db,
    secret: "x".repeat(40),
    dashboardUrl: DASHBOARD,
    trustedOrigins: [DASHBOARD],
    secureCookies: false,
    rateLimit: false,
    sendResetPassword: async (_user, url) => void links.push(url),
  })
})

const post = (path: string, body: unknown, cookie?: string) =>
  auth.handler(
    new Request(`${DASHBOARD}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: DASHBOARD, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  )

const jar = (response: Response) =>
  (response.headers.getSetCookie() as string[]).map((value) => value.split(";")[0]).join("; ")

test("sign up refuses a name past the cap before anything is stored", async () => {
  const long = await post("/sign-up/email", { email: "long@test.dev", name: "n".repeat(5_000_000), password: PASSWORD })
  expect(long.status).toBe(400)
  expect(((await long.json()) as { code: string }).code).toBe("NAME_TOO_LONG")
  expect(
    (await post("/sign-up/email", { email: "ok@test.dev", name: "n".repeat(NAME_MAX), password: PASSWORD })).status,
  ).toBe(200)
})

test("a password reset ends the sessions that were signed in with the old password", async () => {
  const signUp = await post("/sign-up/email", { email: "ana@test.dev", name: "Ana", password: PASSWORD })
  const oldSession = jar(signUp)
  const session = () =>
    auth
      .handler(
        new Request(`${DASHBOARD}/api/auth/get-session?disableCookieCache=true`, { headers: { cookie: oldSession } }),
      )
      .then((r) => r.json())
  expect(await session()).toMatchObject({ user: { email: "ana@test.dev" } })

  await post("/request-password-reset", { email: "ana@test.dev", redirectTo: "/reset-password" })
  const token = new URL(links.at(-1) ?? "").pathname.split("/").at(-1)
  expect((await post("/reset-password", { newPassword: "a-brand-new-password", token })).status).toBe(200)

  expect(await session()).toBeNull()
  expect((await post("/sign-in/email", { email: "ana@test.dev", password: "a-brand-new-password" })).status).toBe(200)
})
