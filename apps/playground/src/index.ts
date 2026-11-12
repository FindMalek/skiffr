import { createApp } from "./app.ts"
import { warmBundles } from "./bundle.ts"
import { readConfig } from "./config.ts"
import { installProcessGuards } from "./guards.ts"
import { listen } from "./node-server.ts"

installProcessGuards()
const config = readConfig()
const { handle } = createApp({ config })
await warmBundles().catch(() => console.error("playground: client bundles failed"))
const { port } = await listen(handle, {
  port: config.port,
  host: process.env.HOST ?? "0.0.0.0",
  maxBody: config.maxBody,
  trustedProxies: config.trustedProxies,
})
const locked = config.locked && !config.token
console.log(
  `playground listening on ${port}, index ${config.publicUrl.origin}${locked ? ", inspect and admin are off until PLAYGROUND_TOKEN is set" : ""}`,
)
