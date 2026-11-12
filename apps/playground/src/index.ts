import { createApp } from "./app.ts"
import { warmBundles } from "./bundle.ts"
import { readConfig } from "./config.ts"
import { listen } from "./node-server.ts"

const config = readConfig()
const { handle } = createApp({ config })
await warmBundles().catch((error) => console.error("client bundles failed", error))
const { port } = await listen(handle, { port: config.port, host: process.env.HOST ?? "0.0.0.0" })
console.log(`playground listening on ${port}, index ${config.publicUrl.origin}`)
