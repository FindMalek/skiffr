// Only for `pnpm auth:schema`: the better-auth CLI reads this to generate packages/db/src/schema/auth.ts.
import { createAuth } from "./src/index"

export const auth = createAuth({
  db: {} as never,
  secret: "x".repeat(32),
  dashboardUrl: "http://localhost:3002",
  trustedOrigins: [],
  secureCookies: false,
})
