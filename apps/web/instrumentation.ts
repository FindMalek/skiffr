import type { Instrumentation } from "next"

/** Modules such as logger and glitchtip hook in here: Next runs `register` once when the server starts. */
const startups: Array<() => void | Promise<void>> = []

const requestErrorHandlers: Instrumentation.onRequestError[] = []

export async function register() {
  for (const start of startups) await start()
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  await Promise.all(requestErrorHandlers.map((handler) => handler(...args)))
}
