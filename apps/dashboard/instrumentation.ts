import { configFromEnv, createObservability, getObservability, setObservability } from "@skiffr/observability"
import type { Instrumentation } from "next"

/** Modules such as logger and glitchtip hook in here: Next runs `register` once when the server starts. */
const startups: Array<() => void | Promise<void>> = [
  () => {
    if (process.env.NEXT_RUNTIME !== "nodejs") return
    setObservability(
      createObservability(
        configFromEnv(process.env, { service: "skiffr-dashboard", environment: process.env.DEPLOY_ENV ?? "local" }),
      ),
    )
  },
]

/** Server render and route errors go to GlitchTip by class and route only, when GLITCHTIP_DSN is set. */
const requestErrorHandlers: Instrumentation.onRequestError[] = [
  (error, _request, context) =>
    getObservability().captureError(error, { job: "dashboard", route: context.routePath.replace(/[[\]]/g, ":") }),
]

export async function register() {
  for (const start of startups) await start()
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  await Promise.all(requestErrorHandlers.map((handler) => handler(...args)))
}
