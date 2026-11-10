import { adminClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

/** Browser client: same-origin `/api/auth`, which the app proxies to the api. */
export const authClient = createAuthClient({ basePath: "/api/auth", plugins: [adminClient()] })
