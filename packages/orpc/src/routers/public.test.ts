import { expect, test } from "bun:test"
import { call } from "@orpc/server"
import { createAuth } from "@skiffr/auth"
import type { Db } from "@skiffr/db"
import type { Context } from "../context"
import { publicRouter } from "./public"

const base = {
  db: {} as Db,
  secret: "x".repeat(40),
  dashboardUrl: "http://localhost:3002",
  trustedOrigins: ["http://localhost:3002"],
  secureCookies: false,
}

const providers = (auth: ReturnType<typeof createAuth>) =>
  call(publicRouter.authProviders, undefined, {
    context: { auth, config: { deployEnv: "test", githubAuth: false } } as unknown as Context,
  })

test("passwordReset is true only when the auth config can send the reset email", async () => {
  expect((await providers(createAuth(base))).passwordReset).toBe(false)
  expect((await providers(createAuth({ ...base, sendResetPassword: async () => {} }))).passwordReset).toBe(true)
})
